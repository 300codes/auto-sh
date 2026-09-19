import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createUserFixture } from '@open-mercato/core/helpers/integration/authFixtures'
import { deleteAttachmentIfExists, uploadAttachmentFixture } from '@open-mercato/core/helpers/integration/attachmentsFixtures'
import { createOrganizationInDb, setUserAclInDb, withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { buildResultManifest } from '../lib/fixtures/builders'
import { createFakeDeployAdapter, type FakeDeployAdapter } from '../lib/fixtures/flow/fakes'
import {
  deliveryFlowErrorBodySchema,
  deliveryReportFlowSectionSchema,
  publicationListResponseSchema,
  type BaselineContentV1,
  type ClientApproval,
  type DeliveryReportFlowSection,
  type FlowStageId,
  type PublicationResultV1,
  type SourceRevision,
  type StageArtifactV1,
  type TaskPackageV1,
} from '../lib/contracts'

/**
 * TC-DELIVERY-FLOW-07-publications: the publication seam (route F14) against the real database.
 *
 * Owner: OSS stream (FLOW-07 seam, FLOW-08 regression; Progress 5.4, 6.2 automated evidence). The jest chain test
 * runs the same handlers over an in-memory store; this spec proves on Postgres that a publication and its derived v1
 * `deployment` evidence land together, that only a verified publication unlocks the release decision, that an identical
 * replay writes nothing, that neither a foreign tenant nor a second organization of the same tenant sees the list or the
 * write, and that a pinned project cannot publish until every approval stage is approved and current (F15 shows the same
 * gate in the report `flow` section). Addendum FLOW-07 negatives: no consent, consent on another revision, a missing
 * lock header and a publication naming its own deployment evidence as the URL check are refused without a write.
 *
 * Publication bodies come from the deterministic fake deploy adapter (the same seam the WordPress host calls); the URL
 * check is a passed `scan` evidence on the published revision (F14 accepts only `test`, `screenshot`, `scan` and `review`
 * as verification evidence). Both projects use the `wordpress-theme` profile, the profile of the WordPress host.
 *
 * ENVIRONMENT: mixes API fixtures with DB fixtures (`withClient` reads DATABASE_URL), so the app and the fixtures must
 * share one database. Decisions, evidence, stage rows and publications are append-only without a delete route, so
 * teardown hard-deletes the rows of the projects this spec created, by project id, including their index rows.
 */

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'fixtures')
const baselineContent = JSON.parse(readFileSync(path.join(FIXTURES_DIR, 'baseline-content.v1.json'), 'utf-8')) as BaselineContentV1
const scopeArtifactFixture = JSON.parse(readFileSync(path.join(FIXTURES_DIR, 'flow', 'stage-artifact.scope.v1.json'), 'utf-8')) as StageArtifactV1
const API = '/api/delivery_os'
const LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)
const BASE_REVISION: SourceRevision = { kind: 'snapshot', contentHash: '7'.repeat(64), externalWorkspaceId: 'wp-local-1' }
const TARGET = { kind: 'wordpress', environment: 'preview', ref: 'psi-fryzjer-preview' } as const
const MANUAL_CHECK_ID = 'MC-visual-001'
const FOREIGN_PASSWORD = 'Secret123!'
const TEST_TIMEOUT_MS = 180_000
const INDEX_TABLES = ['entity_indexes', 'search_tokens']
const PROJECT_TABLES = [
  'delivery_publications',
  'delivery_flow_stage_decisions',
  'delivery_flow_stage_artifacts',
  'delivery_intakes',
  'delivery_evidence',
  'delivery_decisions',
  'delivery_tasks',
  'delivery_baselines',
]

type Json = Record<string, unknown>
type CallResult = { status: number; body: Json }
type Call = (method: string, path: string, options?: { body?: unknown; lock?: string; headers?: Record<string, string> }) => Promise<CallResult>
type ArtifactRef = { artifactId: string; version: number; contentHash: string }
type Seed = { projectId: string; attachmentId: string; baselineId: string; taskId: string }

const createdProjectIds: string[] = []
const createdAttachmentIds: string[] = []
const createdResourceIds = new Set<string>()
const createdUserIds: string[] = []

function caller(request: APIRequestContext, token: string): Call {
  return async (method, path, options = {}) => {
    const headers: Record<string, string> = { ...(options.headers ?? {}) }
    if (options.lock) headers[LOCK_HEADER] = options.lock
    const response = await apiRequest(request, method, path, { token, data: options.body, headers })
    return { status: response.status(), body: (await readJsonSafe<Json>(response)) ?? {} }
  }
}

async function sql<T = Json>(text: string, values: unknown[] = []): Promise<T[]> {
  return withClient(async (client) => (await client.query<T>(text, values)).rows)
}

async function countRows(table: string, projectId: string, extra = ''): Promise<number> {
  const rows = await sql<{ total: string }>(`select count(*) as total from ${table} where project_id = $1 ${extra}`, [projectId])
  return Number(rows[0]?.total ?? 0)
}

async function projectVersion(call: Call, projectId: string): Promise<string> {
  const detail = await call('GET', `${API}/projects/${projectId}`)
  expect(detail.status).toBe(200)
  return detail.body.updatedAt as string
}

function expectFlowError(result: CallResult, status: number, code: string, label: string): void {
  expect({ status: result.status, code: result.body.code }, `${label}: ${JSON.stringify(result.body)}`).toEqual({ status, code })
  expect(deliveryFlowErrorBodySchema.safeParse(result.body).success, `${label} answers the flow error body`).toBe(true)
}

async function createProject(call: Call, label: string): Promise<string> {
  const project = await call('POST', `${API}/projects`, {
    body: { name: `TC-DELIVERY-FLOW-07 ${label} ${Date.now()}`, inputMode: 'from_brief', targetProfileId: 'wordpress-theme', brief: 'Publication seam on the real database' },
  })
  expect(project.status, 'R2 create project').toBe(201)
  const projectId = project.body.id as string
  createdProjectIds.push(projectId)
  return projectId
}

async function seedReadyTask(request: APIRequestContext, token: string, call: Call, projectId: string, label: string): Promise<Seed> {
  const upload = await uploadAttachmentFixture(request, token, {
    entityId: 'delivery_os:delivery_project',
    recordId: projectId,
    fileName: `tc-delivery-flow-07-${label}.png`,
    mimeType: 'image/png',
    buffer: PNG_1X1,
  })
  createdAttachmentIds.push(upload.id)
  const sha256 = createHash('sha256').update(PNG_1X1).digest('hex')
  const draftSpec = {
    requirements: baselineContent.requirements,
    acceptanceCriteria: baselineContent.acceptanceCriteria,
    screens: baselineContent.screens.map((screen) => ({ ...screen, attachmentId: upload.id, sha256 })),
    tokens: baselineContent.tokens,
    architectureSummary: baselineContent.architectureSummary,
    planSummary: baselineContent.planSummary,
    acTestMap: baselineContent.acTestMap,
    manualChecks: baselineContent.manualChecks,
    declaredTests: baselineContent.declaredTests,
    attachments: [{ attachmentId: upload.id, sha256 }],
  }
  const draft = await call('PUT', `${API}/projects`, { body: { id: projectId, draftSpec }, lock: await projectVersion(call, projectId) })
  expect(draft.status, 'R3 draft').toBe(200)

  const baseline = await call('POST', `${API}/projects/${projectId}/baselines`, { body: { source: 'manual' }, lock: await projectVersion(call, projectId) })
  expect(baseline.status, 'R7 manual baseline').toBe(201)
  const { baselineId, contentHash, version } = baseline.body as { baselineId: string; contentHash: string; version: number }
  for (const kind of ['requirements', 'design']) {
    const decision = await call('POST', `${API}/baselines/${baselineId}/decisions`, {
      body: { kind, verdict: 'approved', subjectHash: contentHash, subjectVersion: version },
      lock: await projectVersion(call, projectId),
    })
    expect(decision.status, `R8 ${kind} decision`).toBe(201)
  }

  const task = await call('POST', `${API}/projects/${projectId}/tasks`, {
    body: { source: 'manual', baselineId, title: `Salon home page ${label}`, acIds: baselineContent.acceptanceCriteria.map((criterion) => criterion.id) },
  })
  expect(task.status, 'R10 task').toBe(201)
  const ready = await call('PUT', `${API}/tasks`, { body: { id: task.body.id, status: 'ready' }, lock: String(task.body.updatedAt) })
  expect(ready.status, 'R12 ready').toBe(200)
  return { projectId, attachmentId: upload.id, baselineId, taskId: String(task.body.id) }
}

async function deliverResult(call: Call, seed: Seed, label: string): Promise<SourceRevision> {
  const detail = await call('GET', `${API}/tasks/${seed.taskId}`)
  expect(detail.status).toBe(200)
  const reserved = await call('POST', `${API}/tasks/${seed.taskId}/attempts`, {
    body: { mode: 'manual_handoff', baseRevision: BASE_REVISION },
    lock: String(detail.body.updatedAt),
    headers: { 'Idempotency-Key': `tc-delivery-flow-07-${label}-${randomUUID()}` },
  })
  expect(reserved.status, `R14 reserve: ${JSON.stringify(reserved.body)}`).toBe(201)
  const attemptId = reserved.body.attemptId as string
  const taskPackage = await call('GET', `${API}/tasks/${seed.taskId}/package?attemptId=${attemptId}`)
  expect(taskPackage.status, 'R15 package').toBe(200)
  const manifest = buildResultManifest(taskPackage.body as TaskPackageV1)
  const accepted = await call('POST', `${API}/tasks/${seed.taskId}/results`, { body: { attemptId, manifest } })
  expect(accepted.status, `R16 result: ${JSON.stringify(accepted.body)}`).toBe(201)
  return manifest.resultRevision
}

async function deployConsent(call: Call, seed: Seed, revision: SourceRevision): Promise<string> {
  const consent = await call('POST', `${API}/projects/${seed.projectId}/deploy-decisions`, {
    body: { baselineId: seed.baselineId, sourceRevision: revision, verdict: 'approved' },
    lock: await projectVersion(call, seed.projectId),
  })
  expect(consent.status, `R20 deploy consent: ${JSON.stringify(consent.body)}`).toBe(201)
  return consent.body.decisionId as string
}

function publicationBody(adapter: FakeDeployAdapter, seed: Seed, revision: SourceRevision, deployDecisionId: string, evidenceId: string | null = null): PublicationResultV1 {
  return adapter.publish({
    projectId: seed.projectId,
    baselineId: seed.baselineId,
    sourceRevision: revision,
    deployDecisionId,
    target: TARGET,
    verified: evidenceId !== null,
    evidenceId,
  })
}

async function publish(call: Call, projectId: string, body: PublicationResultV1): Promise<CallResult> {
  return call('POST', `${API}/projects/${projectId}/publications`, { body, lock: await projectVersion(call, projectId) })
}

async function publicationTotal(call: Call, projectId: string): Promise<number> {
  const listed = await call('GET', `${API}/projects/${projectId}/publications`)
  expect(listed.status, 'F14 list').toBe(200)
  return publicationListResponseSchema.parse(listed.body).total
}

function otherRevision(revision: SourceRevision): SourceRevision {
  return revision.kind === 'git' ? { ...revision, commitSha: 'b'.repeat(40) } : { ...revision, contentHash: 'b'.repeat(64) }
}

function revisionRef(revision: SourceRevision): string {
  return revision.kind === 'git' ? `git:${revision.commitSha}` : `snapshot:${revision.contentHash}:${revision.externalWorkspaceId}`
}

async function reportFlowSection(call: Call, projectId: string, revision: SourceRevision, label: string): Promise<DeliveryReportFlowSection> {
  const report = await call('GET', `${API}/projects/${projectId}/report?revision=${encodeURIComponent(revisionRef(revision))}`)
  expect(report.status, `R22 report ${label}: ${JSON.stringify(report.body)}`).toBe(200)
  return deliveryReportFlowSectionSchema.parse(report.body.flow)
}

function clientApproval(): ClientApproval {
  return {
    approverName: 'Anna Client',
    approverRole: 'Owner',
    evidence: { kind: 'meeting', reference: 'Review call with the client', attachment: null, recordedAt: new Date().toISOString() },
  }
}

function stageArtifact(projectId: string, stageId: FlowStageId, dependsOn: Array<ArtifactRef & { stageId: FlowStageId }>, summary: string): StageArtifactV1 {
  if (stageId === 'scope') return { ...scopeArtifactFixture, projectId, source: 'manual' } as StageArtifactV1
  return {
    schemaVersion: 'delivery.stage-artifact/v1',
    projectId,
    stageId,
    source: 'manual',
    dependsOn,
    attachments: [],
    producedBy: null,
    content: { summary, figmaRefs: [], screens: [], notes: null, resolvedThreadKeys: [] },
  } as StageArtifactV1
}

async function recordArtifact(call: Call, projectId: string, artifact: StageArtifactV1): Promise<ArtifactRef> {
  const created = await call('POST', `${API}/projects/${projectId}/stages/${artifact.stageId}/artifacts`, {
    body: artifact,
    lock: await projectVersion(call, projectId),
  })
  expect(created.status, `F6 ${artifact.stageId} artifact: ${JSON.stringify(created.body)}`).toBe(201)
  return { artifactId: created.body.artifactId as string, version: created.body.version as number, contentHash: created.body.contentHash as string }
}

async function approveStage(call: Call, projectId: string, stageId: FlowStageId, ref: ArtifactRef): Promise<void> {
  const needsClient = stageId === 'key_visual' || stageId === 'design_system_ui'
  const decision = await call('POST', `${API}/projects/${projectId}/stages/${stageId}/decisions`, {
    body: {
      artifactId: ref.artifactId,
      subjectHash: ref.contentHash,
      subjectVersion: ref.version,
      verdict: 'approved',
      ...(needsClient ? { clientApproval: clientApproval() } : {}),
    },
    lock: await projectVersion(call, projectId),
    headers: { 'Idempotency-Key': `tc-delivery-flow-07-${stageId}-${randomUUID()}` },
  })
  expect(decision.status, `F7 ${stageId} approval: ${JSON.stringify(decision.body)}`).toBe(201)
}

async function deleteProjectsInDb(projectIds: string[]): Promise<void> {
  if (projectIds.length === 0) return
  await withClient(async (client) => {
    const owned = await client.query<{ id: string }>(
      `select id::text as id from delivery_projects where id = any($1::uuid[])
       ${PROJECT_TABLES.map((table) => `union all select id::text from ${table} where project_id = any($1::uuid[])`).join('\n       ')}`,
      [projectIds],
    )
    for (const row of owned.rows) createdResourceIds.add(row.id)
    const resourceIds = [...new Set([...projectIds, ...createdResourceIds])]
    for (const table of INDEX_TABLES) {
      await client.query(`delete from ${table} where entity_type like 'delivery_os:%' and entity_id = any($1::text[])`, [resourceIds])
    }
    await client.query(
      `delete from action_logs where resource_kind like 'delivery_os%' and (resource_id = any($1::text[]) or parent_resource_id = any($1::text[]))`,
      [resourceIds],
    )
    for (const table of PROJECT_TABLES) await client.query(`delete from ${table} where project_id = any($1::uuid[])`, [projectIds])
    await client.query('delete from delivery_projects where id = any($1::uuid[])', [projectIds])
  })
}

async function leftoverRows(projectIds: string[]): Promise<number> {
  const resourceIds = [...new Set([...projectIds, ...createdResourceIds])]
  const rows = await sql<{ total: string }>(
    `select
       (select count(*) from delivery_projects where id = any($1::uuid[]))
     ${PROJECT_TABLES.map((table) => `+ (select count(*) from ${table} where project_id = any($1::uuid[]))`).join('\n     ')}
     + (select count(*) from action_logs where resource_kind like 'delivery_os%' and (resource_id = any($2::text[]) or parent_resource_id = any($2::text[])))
     + (select count(*) from entity_indexes where entity_type like 'delivery_os:%' and entity_id = any($2::text[]))
     + (select count(*) from search_tokens where entity_type like 'delivery_os:%' and entity_id = any($2::text[]))
     + (select count(*) from entity_indexes where entity_type = 'auth:user' and entity_id = any($3::text[]))
     + (select count(*) from search_tokens where entity_type = 'auth:user' and entity_id = any($3::text[])) as total`,
    [projectIds, resourceIds, createdUserIds],
  )
  return Number(rows[0]?.total ?? 0)
}

type ForeignFixture = { userIds: string[]; organizationIds: string[]; tenantIds: string[] }

/** A user homed in a new organization of `tenantId` with `delivery_os.*`; the ACL row is written before the first login so no RBAC cache entry predates it. */
async function createScopedUser(request: APIRequestContext, superadminToken: string, fixture: ForeignFixture, tenantId: string, label: string): Promise<string> {
  const organizationId = await createOrganizationInDb({ name: `TC-DELIVERY-FLOW-07 org ${label} ${Date.now()}`, tenantId })
  fixture.organizationIds.push(organizationId)
  const email = `tc-delivery-flow-07-${label}-${Date.now()}@example.com`
  const userId = await createUserFixture(request, superadminToken, { email, password: FOREIGN_PASSWORD, organizationId, roles: [] })
  fixture.userIds.push(userId)
  createdUserIds.push(userId)
  await setUserAclInDb({ userId, tenantId, features: ['delivery_os.*'], organizations: [organizationId] })
  const token = await getAuthToken(request, email, FOREIGN_PASSWORD)
  expect(getTokenScope(token)).toMatchObject({ tenantId, organizationId })
  return token
}

async function createForeignTenantUser(request: APIRequestContext, superadminToken: string, fixture: ForeignFixture): Promise<string> {
  const tenantId = (await sql<{ id: string }>(
    `insert into tenants (id, name, is_active, created_at, updated_at) values (gen_random_uuid(), $1, true, now(), now()) returning id`,
    [`TC-DELIVERY-FLOW-07 tenant ${Date.now()}`],
  ))[0].id
  fixture.tenantIds.push(tenantId)
  return createScopedUser(request, superadminToken, fixture, tenantId, 'tenant-c')
}

async function deleteForeignFixture(fixture: ForeignFixture): Promise<void> {
  await withClient(async (client) => {
    if (fixture.userIds.length > 0) {
      for (const table of ['sessions', 'user_acls', 'user_roles', 'password_resets']) {
        await client.query(`delete from ${table} where user_id = any($1::uuid[])`, [fixture.userIds])
      }
      await client.query('delete from action_logs where resource_id = any($1::text[])', [fixture.userIds])
      for (const table of INDEX_TABLES) {
        await client.query(`delete from ${table} where entity_type = 'auth:user' and entity_id = any($1::text[])`, [fixture.userIds])
      }
      await client.query('delete from users where id = any($1::uuid[])', [fixture.userIds])
    }
    if (fixture.organizationIds.length > 0) await client.query('delete from organizations where id = any($1::uuid[])', [fixture.organizationIds])
    if (fixture.tenantIds.length > 0) await client.query('delete from tenants where id = any($1::uuid[])', [fixture.tenantIds])
  })
}

async function cleanup(request: APIRequestContext, token: string | null, projectIds: string[], attachmentIds: string[]): Promise<void> {
  await deleteProjectsInDb(projectIds).catch(() => undefined)
  for (const attachmentId of attachmentIds) await deleteAttachmentIfExists(request, token, attachmentId)
}

test.describe('TC-DELIVERY-FLOW-07: publications on the real database', () => {
  test.afterAll(async ({ request }) => {
    await deleteProjectsInDb(createdProjectIds)
    for (const table of INDEX_TABLES) {
      await sql(`delete from ${table} where entity_type = 'auth:user' and entity_id = any($1::text[])`, [createdUserIds])
    }
    const token = await getAuthToken(request, 'admin')
    for (const attachmentId of createdAttachmentIds) await deleteAttachmentIfExists(request, token, attachmentId)
    const leftAttachments = await sql<{ total: string }>('select count(*) as total from attachments where id = any($1::uuid[])', [createdAttachmentIds])
    expect(leftAttachments[0]?.total, 'no attachment of this spec is left behind').toBe('0')
    expect(await leftoverRows(createdProjectIds), 'no delivery_os row of this spec is left behind').toBe(0)
  })

  test('legacy WordPress project: refused without consent, on another revision, without a lock and with its own deployment evidence; consent → unverified → URL check → verified → release, replay, second organization and foreign tenant', async ({ request }) => {
    test.setTimeout(TEST_TIMEOUT_MS)
    let token: string | null = null
    const projectIds: string[] = []
    const attachmentIds: string[] = []
    const foreign: ForeignFixture = { userIds: [], organizationIds: [], tenantIds: [] }
    try {
      token = await getAuthToken(request, 'admin')
      const call = caller(request, token)
      const adapter = createFakeDeployAdapter()
      const projectId = await createProject(call, 'legacy')
      projectIds.push(projectId)
      const seed = await seedReadyTask(request, token, call, projectId, 'legacy')
      attachmentIds.push(seed.attachmentId)
      const revision = await deliverResult(call, seed, 'legacy')

      const noConsent = await publish(call, projectId, publicationBody(adapter, seed, revision, randomUUID()))
      expectFlowError(noConsent, 422, 'deploy_decision_missing', 'F14 before any deploy consent')
      expect(await publicationTotal(call, projectId), 'a publication without consent is not listed').toBe(0)
      expect(await countRows('delivery_evidence', projectId, `and kind = 'deployment'`), 'a publication without consent writes no evidence').toBe(0)

      const consentId = await deployConsent(call, seed, revision)

      const staleRevision = await publish(call, projectId, publicationBody(adapter, seed, otherRevision(revision), consentId))
      expectFlowError(staleRevision, 422, 'revision_mismatch', 'F14 on another revision than the consent names')
      expect(await publicationTotal(call, projectId), 'a publication of another revision is not listed').toBe(0)
      expect(await countRows('delivery_evidence', projectId, `and kind = 'deployment'`), 'a publication of another revision writes no evidence').toBe(0)

      const noLock = await call('POST', `${API}/projects/${projectId}/publications`, { body: publicationBody(adapter, seed, revision, consentId) })
      expectFlowError(noLock, 428, 'optimistic_lock_required', 'F14 new publication without the lock header')
      expect(await publicationTotal(call, projectId), 'a publication without the lock header is not listed').toBe(0)
      expect(await countRows('delivery_evidence', projectId, `and kind = 'deployment'`), 'a publication without the lock header writes no evidence').toBe(0)

      const unverified = await publish(call, projectId, publicationBody(adapter, seed, revision, consentId))
      expect(unverified.status, `F14 unverified: ${JSON.stringify(unverified.body)}`).toBe(201)
      expect(unverified.body.duplicate).toBe(false)
      const derived = await sql<{ kind: string }>('select kind from delivery_evidence where id = $1 and project_id = $2', [unverified.body.deploymentEvidenceId, projectId])
      expect(derived, 'the derived v1 deployment evidence landed with the publication').toEqual([{ kind: 'deployment' }])

      const blockedRelease = await call('POST', `${API}/projects/${projectId}/release-decisions`, {
        body: { deploymentEvidenceId: unverified.body.deploymentEvidenceId, verdict: 'approved' },
        lock: await projectVersion(call, projectId),
      })
      expect(blockedRelease.status, 'R21 on an unverified publication').toBe(422)
      expect(blockedRelease.body.code).toBe('deployment_unverified')
      expect(await countRows('delivery_decisions', projectId, `and kind = 'release'`), 'no release decision row').toBe(0)

      const selfVerified = await publish(call, projectId, publicationBody(adapter, seed, revision, consentId, unverified.body.deploymentEvidenceId as string))
      expectFlowError(selfVerified, 422, 'unsupported_evidence_kind', 'F14 verified by its own deployment evidence')
      expect(deliveryFlowErrorBodySchema.parse(selfVerified.body).details[0]?.path, 'the verification evidence is named').toBe('verification.evidenceId')
      expect(await publicationTotal(call, projectId), 'a self-verified publication is not listed').toBe(1)
      expect(await countRows('delivery_evidence', projectId, `and kind = 'deployment'`), 'a self-verified publication writes no evidence').toBe(1)

      const urlCheck = await call('POST', `${API}/projects/${projectId}/evidence`, {
        body: {
          baselineId: seed.baselineId,
          kind: 'scan',
          sourceRevision: revision,
          payload: { checkId: 'publication-url-check', scanner: 'http-url-check', status: 'passed', rawReportHash: 'c'.repeat(64) },
        },
      })
      expect(urlCheck.status, `R19 URL check: ${JSON.stringify(urlCheck.body)}`).toBe(201)
      const verifiedBody = publicationBody(adapter, seed, revision, consentId, urlCheck.body.evidenceId as string)
      const verified = await publish(call, projectId, verifiedBody)
      expect(verified.status, `F14 verified: ${JSON.stringify(verified.body)}`).toBe(201)
      expect(verified.body.deploymentEvidenceId).not.toBe(unverified.body.deploymentEvidenceId)

      const review = await call('POST', `${API}/projects/${projectId}/evidence`, {
        body: {
          baselineId: seed.baselineId,
          kind: 'review',
          taskId: seed.taskId,
          sourceRevision: revision,
          payload: { verdict: 'approved', summary: 'Checked', findings: [], manualCheckId: MANUAL_CHECK_ID, reviewer: { kind: 'human' } },
        },
      })
      expect(review.status, `R19 review: ${JSON.stringify(review.body)}`).toBe(201)
      const release = await call('POST', `${API}/projects/${projectId}/release-decisions`, {
        body: { deploymentEvidenceId: verified.body.deploymentEvidenceId, verdict: 'approved' },
        lock: await projectVersion(call, projectId),
      })
      expect(release.status, `R21 on the verified publication: ${JSON.stringify(release.body)}`).toBe(201)

      const listed = await call('GET', `${API}/projects/${projectId}/publications`)
      expect(listed.status, 'F14 list').toBe(200)
      const list = publicationListResponseSchema.parse(listed.body)
      expect(list.total).toBe(2)
      expect(list.items.map((item) => [item.publicationId, item.verification.status]), 'newest first').toEqual([
        [verified.body.publicationId, 'verified'],
        [unverified.body.publicationId, 'unverified'],
      ])

      const replay = await call('POST', `${API}/projects/${projectId}/publications`, { body: verifiedBody })
      expect(replay.status, 'identical replay without a lock header').toBe(200)
      expect(replay.body).toMatchObject({ duplicate: true, publicationId: verified.body.publicationId, deploymentEvidenceId: verified.body.deploymentEvidenceId })
      expect(await countRows('delivery_publications', projectId), 'the replay wrote no publication').toBe(2)
      expect(await countRows('delivery_evidence', projectId, `and kind = 'deployment'`), 'the replay wrote no deployment evidence').toBe(2)

      const ownerLock = await projectVersion(call, projectId)
      const ownerBefore = await sql(
        `select (select updated_at from delivery_projects where id = $1) as project, (select count(*) from delivery_publications where project_id = $1) as publications`,
        [projectId],
      )
      const superadminToken = await getAuthToken(request, 'superadmin')
      const outsiders: Array<[string, Call]> = [
        ['a second-organization user of the same tenant', caller(request, await createScopedUser(request, superadminToken, foreign, getTokenScope(token).tenantId, 'org-b'))],
        ['a foreign-tenant user', caller(request, await createForeignTenantUser(request, superadminToken, foreign))],
      ]
      for (const [who, foreignCall] of outsiders) {
        const probes: Array<[string, () => Promise<CallResult>]> = [
          ['F14 list', () => foreignCall('GET', `${API}/projects/${projectId}/publications`)],
          ['F14 record', () => foreignCall('POST', `${API}/projects/${projectId}/publications`, { body: verifiedBody })],
          ['F14 record with a lock header', () => foreignCall('POST', `${API}/projects/${projectId}/publications`, { body: publicationBody(adapter, seed, revision, consentId), lock: ownerLock })],
        ]
        for (const [label, probe] of probes) {
          const result = await probe()
          expect(result.status, `${label} as ${who}: ${JSON.stringify(result.body)}`).toBe(404)
          expect(JSON.stringify(result.body), `${label} leaks nothing to ${who}`).not.toContain(projectId)
          expect(JSON.stringify(result.body), `${label} leaks no publication id to ${who}`).not.toContain(String(verified.body.publicationId))
        }
      }
      const ownerAfter = await sql(
        `select (select updated_at from delivery_projects where id = $1) as project, (select count(*) from delivery_publications where project_id = $1) as publications`,
        [projectId],
      )
      expect(ownerAfter, 'owner rows untouched by the second-organization and foreign-tenant probes').toEqual(ownerBefore)
    } finally {
      await cleanup(request, token, projectIds, attachmentIds)
      await deleteForeignFixture(foreign).catch(() => undefined)
    }
  })

  test('pinned project: F14 answers 422 stage_not_approved until the re-versioned stages are approved again', async ({ request }) => {
    test.setTimeout(TEST_TIMEOUT_MS)
    let token: string | null = null
    const projectIds: string[] = []
    const attachmentIds: string[] = []
    try {
      token = await getAuthToken(request, 'admin')
      const call = caller(request, token)
      const adapter = createFakeDeployAdapter()
      const projectId = await createProject(call, 'pinned')
      projectIds.push(projectId)
      const pin = await call('POST', `${API}/projects/${projectId}/flow/pin`, {
        body: { templateId: 'delivery-default', templateVersion: 1 },
        lock: await projectVersion(call, projectId),
      })
      expect(pin.status, `F4 pin: ${JSON.stringify(pin.body)}`).toBe(201)

      const scope = await recordArtifact(call, projectId, stageArtifact(projectId, 'scope', [], ''))
      await approveStage(call, projectId, 'scope', scope)
      const ux = await recordArtifact(call, projectId, stageArtifact(projectId, 'ux', [{ stageId: 'scope', ...scope }], 'UX wireframes'))
      await approveStage(call, projectId, 'ux', ux)
      const keyVisual = await recordArtifact(call, projectId, stageArtifact(projectId, 'key_visual', [{ stageId: 'ux', ...ux }], 'Key visual'))
      await approveStage(call, projectId, 'key_visual', keyVisual)
      const ui = await recordArtifact(call, projectId, stageArtifact(projectId, 'design_system_ui', [{ stageId: 'key_visual', ...keyVisual }], 'Design system and UI'))
      await approveStage(call, projectId, 'design_system_ui', ui)

      const seed = await seedReadyTask(request, token, call, projectId, 'pinned')
      attachmentIds.push(seed.attachmentId)
      const revision = await deliverResult(call, seed, 'pinned')
      const consentId = await deployConsent(call, seed, revision)

      const keyVisualV2 = await recordArtifact(
        call,
        projectId,
        stageArtifact(projectId, 'key_visual', [{ stageId: 'ux', ...ux }], 'Key visual after client feedback'),
      )
      await approveStage(call, projectId, 'key_visual', keyVisualV2)
      const body = publicationBody(adapter, seed, revision, consentId)

      const staleUi = await publish(call, projectId, body)
      expectFlowError(staleUi, 422, 'stage_not_approved', 'F14 with the UI approved on the old key visual')
      expect(staleUi.body.details, 'the UI stage is named as stale').toEqual(
        expect.arrayContaining([expect.objectContaining({ path: 'stages.design_system_ui', code: 'stage_dependency_stale' })]),
      )
      const closedFlow = await reportFlowSection(call, projectId, revision, 'with a stale UI stage')
      expect(closedFlow.gate.ok, `F15 flow.gate while the UI stage is stale: ${JSON.stringify(closedFlow.gate)}`).toBe(false)
      expect(closedFlow.gate.blocking.map((blocker) => blocker.stageId), 'the stale UI stage blocks the report gate').toContain('design_system_ui')
      expect(closedFlow.stages.find((stage) => stage.stageId === 'design_system_ui')?.currency, 'F15 names the UI stage stale').toBe('stale')

      const uiV2 = await recordArtifact(
        call,
        projectId,
        stageArtifact(projectId, 'design_system_ui', [{ stageId: 'key_visual', ...keyVisualV2 }], 'Design system and UI on the new key visual'),
      )
      const pendingUi = await publish(call, projectId, body)
      expectFlowError(pendingUi, 422, 'stage_not_approved', 'F14 before the last approval')
      expect(await countRows('delivery_publications', projectId), 'a refused publication writes nothing').toBe(0)
      expect(await countRows('delivery_evidence', projectId, `and kind = 'deployment'`), 'a refused publication writes no evidence').toBe(0)

      await approveStage(call, projectId, 'design_system_ui', uiV2)
      const openFlow = await reportFlowSection(call, projectId, revision, 'after the UI re-approval')
      expect(openFlow.gate, 'F15 flow.gate after the UI re-approval').toEqual({ ok: true, blocking: [] })
      expect(openFlow.stages.map((stage) => stage.currency), 'every approval stage is current').toEqual(['approved', 'approved', 'approved', 'approved'])
      const published = await publish(call, projectId, body)
      expect(published.status, `F14 after the last approval: ${JSON.stringify(published.body)}`).toBe(201)
      expect(published.body.duplicate).toBe(false)
      expect(await countRows('delivery_publications', projectId)).toBe(1)
      expect(await countRows('delivery_evidence', projectId, `and kind = 'deployment'`)).toBe(1)
    } finally {
      await cleanup(request, token, projectIds, attachmentIds)
    }
  })
})
