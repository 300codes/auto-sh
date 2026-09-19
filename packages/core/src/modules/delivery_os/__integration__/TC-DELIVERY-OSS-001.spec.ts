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
import { deliveryReportV1Schema, type BaselineContentV1, type TaskPackageV1 } from '../lib/contracts'

/**
 * TC-DELIVERY-OSS-001: frozen v1 manual flow of delivery_os against the real database.
 *
 * Owner: OSS stream (Progress 6.2, FLOW-08 v1 regression). The jest route tests run the same handlers over an
 * in-memory store; this spec proves what only Postgres can: tenant/organisation scoping filters, the
 * (project, content_hash) unique index, row locks behind the platform optimistic-lock conflict, JSONB attempt
 * register writes and the report query.
 *
 * ENVIRONMENT: mixes API fixtures with DB fixtures (`withClient` reads DATABASE_URL like the other DB fixtures), so the
 * app and the fixtures must share one database (`yarn test:integration*` harness or the local dev stack with its
 * `apps/mercato/.env`). v1 decisions, baselines and evidence are append-only and have no delete route, so teardown
 * hard-deletes the rows of the projects this spec created, by project id; `afterAll` repeats it for a test that failed
 * while seeding and asserts nothing is left.
 *
 * Two documented contracts shape the assertions: a lock-header write on R3/R4/R12/R13 whose target is out of scope answers
 * the platform "record gone" 409 echoing the caller's own token, byte-identical to a never-existing id (spec changelog,
 * T036); and claiming an attempt is a trusted in-process worker step with no HTTP route, so the cancel/reconcile test
 * flips the attempt to `claimed` in the JSONB register.
 */

const baselineContent = JSON.parse(
  readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'fixtures', 'baseline-content.v1.json'), 'utf-8'),
) as BaselineContentV1
const API = '/api/delivery_os'
const LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)
const COMMIT_A = 'a'.repeat(40)
const COMMIT_B = 'b'.repeat(40)
const FOREIGN_PASSWORD = 'Secret123!'

type Json = Record<string, unknown>
type CallResult = { status: number; body: Json }
type Call = (method: string, path: string, options?: { body?: unknown; lock?: string; headers?: Record<string, string> }) => Promise<CallResult>

const createdProjectIds: string[] = []
const createdAttachmentIds: string[] = []
const createdResourceIds = new Set<string>()
const createdUserIds: string[] = []

const INDEX_TABLES = ['entity_indexes', 'search_tokens']

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

async function projectVersion(call: Call, projectId: string): Promise<string> {
  const detail = await call('GET', `${API}/projects/${projectId}`)
  expect(detail.status).toBe(200)
  return detail.body.updatedAt as string
}

function draftSpecFor(attachmentId: string, sha256: string, planSummary = baselineContent.planSummary) {
  return {
    requirements: baselineContent.requirements,
    acceptanceCriteria: baselineContent.acceptanceCriteria,
    screens: baselineContent.screens.map((screen) => ({ ...screen, attachmentId, sha256 })),
    tokens: baselineContent.tokens,
    architectureSummary: baselineContent.architectureSummary,
    planSummary,
    acTestMap: baselineContent.acTestMap,
    manualChecks: baselineContent.manualChecks,
    declaredTests: baselineContent.declaredTests,
    attachments: [{ attachmentId, sha256 }],
  }
}

type SeededTask = {
  projectId: string
  attachmentId: string
  sha256: string
  baselineId: string
  contentHash: string
  taskId: string
  taskUpdatedAt: string
}

async function seedReadyTask(request: APIRequestContext, token: string, call: Call, label: string): Promise<SeededTask> {
  const project = await call('POST', `${API}/projects`, {
    body: { name: `TC-DELIVERY-OSS-001 ${label} ${Date.now()}`, inputMode: 'from_brief', targetProfileId: 'react-vite', brief: 'Real-database v1 regression' },
  })
  expect(project.status, 'R2 create project').toBe(201)
  const projectId = project.body.id as string
  createdProjectIds.push(projectId)

  const upload = await uploadAttachmentFixture(request, token, {
    entityId: 'delivery_os:delivery_project',
    recordId: projectId,
    fileName: `tc-delivery-oss-001-${label}.png`,
    mimeType: 'image/png',
    buffer: PNG_1X1,
  })
  createdAttachmentIds.push(upload.id)
  const sha256 = createHash('sha256').update(PNG_1X1).digest('hex')

  const draft = await call('PUT', `${API}/projects`, {
    body: { id: projectId, draftSpec: draftSpecFor(upload.id, sha256) },
    lock: await projectVersion(call, projectId),
  })
  expect(draft.status, 'R3 draft').toBe(200)

  const baseline = await call('POST', `${API}/projects/${projectId}/baselines`, {
    body: { source: 'manual' },
    lock: await projectVersion(call, projectId),
  })
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
    body: { source: 'manual', baselineId, title: `Service catalogue ${label}`, acIds: ['AC-001', 'AC-002'], allowedPaths: ['src/**'] },
  })
  expect(task.status, 'R10 task').toBe(201)
  const ready = await call('PUT', `${API}/tasks`, { body: { id: task.body.id, status: 'ready' }, lock: String(task.body.updatedAt) })
  expect(ready.status, 'R12 ready').toBe(200)
  expect(ready.body.status).toBe('ready')

  return { projectId, attachmentId: upload.id, sha256, baselineId, contentHash, taskId: String(task.body.id), taskUpdatedAt: String(ready.body.updatedAt) }
}

function reserveBody(commitSha: string) {
  return { mode: 'manual_handoff', baseRevision: { kind: 'git', commitSha } }
}

async function reserve(call: Call, taskId: string, lock: string, key: string, commitSha = COMMIT_A): Promise<CallResult> {
  return call('POST', `${API}/tasks/${taskId}/attempts`, { body: reserveBody(commitSha), lock, headers: { 'Idempotency-Key': key } })
}

async function taskVersion(call: Call, taskId: string): Promise<{ updatedAt: string; status: string }> {
  const detail = await call('GET', `${API}/tasks/${taskId}`)
  expect(detail.status).toBe(200)
  return { updatedAt: detail.body.updatedAt as string, status: detail.body.status as string }
}

async function deliverResult(call: Call, taskId: string, attemptId: string) {
  const taskPackage = await call('GET', `${API}/tasks/${taskId}/package?attemptId=${attemptId}`)
  expect(taskPackage.status, 'R15 package').toBe(200)
  const manifest = buildResultManifest(taskPackage.body as TaskPackageV1, { changedPaths: ['src/ServiceList.tsx'] })
  const accepted = await call('POST', `${API}/tasks/${taskId}/results`, { body: { attemptId, manifest } })
  return { taskPackage, manifest, accepted }
}

async function deliveryRowCounts(projectIds: string[]): Promise<number> {
  const indexedIds = [...new Set([...projectIds, ...createdResourceIds])]
  const indexRows = await sql<{ total: string }>(
    `select
       (select count(*) from entity_indexes where entity_type like 'delivery_os:%' and entity_id = any($1::text[]))
     + (select count(*) from search_tokens where entity_type like 'delivery_os:%' and entity_id = any($1::text[]))
     + (select count(*) from entity_indexes where entity_type = 'auth:user' and entity_id = any($2::text[]))
     + (select count(*) from search_tokens where entity_type = 'auth:user' and entity_id = any($2::text[])) as total`,
    [indexedIds, createdUserIds],
  )
  const rows = await sql<{ total: string }>(
    `select
       (select count(*) from delivery_projects where id = any($1::uuid[]))
     + (select count(*) from delivery_baselines where project_id = any($1::uuid[]))
     + (select count(*) from delivery_decisions where project_id = any($1::uuid[]))
     + (select count(*) from delivery_tasks where project_id = any($1::uuid[]))
     + (select count(*) from delivery_evidence where project_id = any($1::uuid[]))
     + (select count(*) from delivery_intakes where project_id = any($1::uuid[]))
     + (select count(*) from delivery_flow_stage_artifacts where project_id = any($1::uuid[]))
     + (select count(*) from delivery_flow_stage_decisions where project_id = any($1::uuid[]))
     + (select count(*) from action_logs where resource_kind like 'delivery_os%'
          and (resource_id = any($1::text[]) or parent_resource_id = any($1::text[]))) as total`,
    [projectIds],
  )
  return Number(rows[0]?.total ?? 0) + Number(indexRows[0]?.total ?? 0)
}

async function deleteProjectsInDb(projectIds: string[]): Promise<void> {
  if (projectIds.length === 0) return
  await withClient(async (client) => {
    const owned = await client.query<{ id: string }>(
      `select id::text as id from delivery_projects where id = any($1::uuid[])
       union all select id::text from delivery_baselines where project_id = any($1::uuid[])
       union all select id::text from delivery_decisions where project_id = any($1::uuid[])
       union all select id::text from delivery_tasks where project_id = any($1::uuid[])
       union all select id::text from delivery_evidence where project_id = any($1::uuid[])`,
      [projectIds],
    )
    const resourceIds = owned.rows.map((row) => row.id)
    for (const id of resourceIds) createdResourceIds.add(id)
    const indexedIds = [...new Set([...projectIds, ...createdResourceIds])]
    for (const table of INDEX_TABLES) {
      await client.query(`delete from ${table} where entity_type like 'delivery_os:%' and entity_id = any($1::text[])`, [indexedIds])
    }
    await client.query(
      `delete from action_logs where resource_kind like 'delivery_os%' and (resource_id = any($1::text[]) or parent_resource_id = any($1::text[]))`,
      [resourceIds],
    )
    for (const table of ['delivery_flow_stage_decisions', 'delivery_flow_stage_artifacts', 'delivery_intakes', 'delivery_evidence', 'delivery_decisions', 'delivery_tasks', 'delivery_baselines']) {
      await client.query(`delete from ${table} where project_id = any($1::uuid[])`, [projectIds])
    }
    await client.query('delete from delivery_projects where id = any($1::uuid[])', [projectIds])
  })
}

async function cleanupSeeds(request: APIRequestContext, token: string | null, seeds: Array<SeededTask | null>): Promise<void> {
  const projectIds = seeds.filter((seed): seed is SeededTask => Boolean(seed)).map((seed) => seed.projectId)
  await deleteProjectsInDb(projectIds).catch(() => undefined)
  for (const seed of seeds) {
    if (seed) await deleteAttachmentIfExists(request, token, seed.attachmentId)
  }
}

type ForeignUser = { userId: string; token: string; organizationId: string; tenantId: string | null }

async function deleteForeignFixtures(users: ForeignUser[], organizationIds: string[], tenantIds: string[]): Promise<void> {
  const userIds = users.map((user) => user.userId)
  createdUserIds.push(...userIds)
  await withClient(async (client) => {
    if (userIds.length > 0) {
      for (const table of ['sessions', 'user_acls', 'user_roles', 'password_resets']) {
        await client.query(`delete from ${table} where user_id = any($1::uuid[])`, [userIds])
      }
      await client.query('delete from action_logs where resource_id = any($1::text[])', [userIds])
      for (const table of INDEX_TABLES) {
        await client.query(`delete from ${table} where entity_type = 'auth:user' and entity_id = any($1::text[])`, [userIds])
      }
      await client.query('delete from users where id = any($1::uuid[])', [userIds])
    }
    if (organizationIds.length > 0) await client.query('delete from organizations where id = any($1::uuid[])', [organizationIds])
    if (tenantIds.length > 0) await client.query('delete from tenants where id = any($1::uuid[])', [tenantIds])
  })
}

/** Creates a user homed in `organizationId` with `delivery_os.*`; the ACL row is written before the first login so no RBAC cache entry predates it. */
async function createForeignUser(
  request: APIRequestContext,
  superadminToken: string,
  input: { tenantId: string; organizationId: string; label: string },
  created: ForeignUser[],
): Promise<ForeignUser> {
  const email = `tc-delivery-oss-001-${input.label}-${Date.now()}@example.com`
  const userId = await createUserFixture(request, superadminToken, { email, password: FOREIGN_PASSWORD, organizationId: input.organizationId, roles: [] })
  const user: ForeignUser = { userId, token: '', organizationId: input.organizationId, tenantId: input.tenantId }
  created.push(user)
  await setUserAclInDb({ userId, tenantId: input.tenantId, features: ['delivery_os.*'], organizations: [input.organizationId] })
  user.token = await getAuthToken(request, email, FOREIGN_PASSWORD)
  expect(getTokenScope(user.token).organizationId).toBe(input.organizationId)
  return user
}

test.describe('TC-DELIVERY-OSS-001: delivery_os v1 manual flow on the real database', () => {
  test.afterAll(async ({ request }) => {
    await deleteProjectsInDb(createdProjectIds)
    for (const table of INDEX_TABLES) {
      await sql(`delete from ${table} where entity_type = 'auth:user' and entity_id = any($1::text[])`, [createdUserIds])
    }
    const token = await getAuthToken(request, 'admin')
    for (const attachmentId of createdAttachmentIds) await deleteAttachmentIfExists(request, token, attachmentId)
    const leftAttachments = await sql<{ total: string }>('select count(*) as total from attachments where id = any($1::uuid[])', [createdAttachmentIds])
    expect(leftAttachments[0]?.total, 'no attachment of this spec is left behind').toBe('0')
    expect(await deliveryRowCounts(createdProjectIds), 'no delivery_os row of this spec is left behind').toBe(0)
  })

  test('manual flow: baseline with a real attachment → verified task → report proof → publication gates', async ({ request }) => {
    test.slow()
    let token: string | null = null
    let seed: SeededTask | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const call = caller(request, token)
      seed = await seedReadyTask(request, token, call, 'flow')
      const { projectId, taskId, baselineId } = seed

      const project = await call('GET', `${API}/projects/${projectId}`)
      expect(project.body.activeBaselineId, 'both decisions make the baseline active').toBe(baselineId)
      const attachmentRows = await sql<{ attachment_ids: string[] }>('select attachment_ids from delivery_baselines where id = $1', [baselineId])
      expect(attachmentRows[0]?.attachment_ids, 'the JSON column keeps the uploaded attachment').toContain(seed.attachmentId)

      const key = `tc-delivery-oss-001-flow-${randomUUID()}`
      const first = await reserve(call, taskId, seed.taskUpdatedAt, key)
      expect(first.status, 'R14 reserve').toBe(201)
      const attemptId = first.body.attemptId as string
      const replay = await call('POST', `${API}/tasks/${taskId}/attempts`, { body: reserveBody(COMMIT_A), headers: { 'Idempotency-Key': key } })
      expect(replay.status, 'R14 replay with the same key').toBe(200)
      expect(replay.body.attemptId).toBe(attemptId)
      const conflicting = await call('POST', `${API}/tasks/${taskId}/attempts`, { body: reserveBody(COMMIT_B), headers: { 'Idempotency-Key': key } })
      expect(conflicting.status, 'R14 same key, different body').toBe(409)
      expect(conflicting.body.code).toBe('idempotency_conflict')
      const register = await sql<{ attempts: number }>('select jsonb_array_length(execution_attempts) as attempts from delivery_tasks where id = $1', [taskId])
      expect(register[0]?.attempts, 'one attempt in the JSONB register').toBe(1)

      const before = await sql('select updated_at, execution_attempts from delivery_tasks where id = $1', [taskId])
      const packageOne = await call('GET', `${API}/tasks/${taskId}/package?attemptId=${attemptId}`)
      const packageTwo = await call('GET', `${API}/tasks/${taskId}/package?attemptId=${attemptId}`)
      expect(packageOne.status, 'R15 package').toBe(200)
      expect(packageTwo.body).toEqual(packageOne.body)
      expect(await sql('select updated_at, execution_attempts from delivery_tasks where id = $1', [taskId]), 'GET package writes nothing').toEqual(before)

      const manifest = buildResultManifest(packageOne.body as TaskPackageV1, { changedPaths: ['src/ServiceList.tsx'] })
      const accepted = await call('POST', `${API}/tasks/${taskId}/results`, { body: { attemptId, manifest } })
      expect(accepted.status, 'R16 result').toBe(201)
      expect(accepted.body).toMatchObject({ duplicate: false, taskStatus: 'awaiting_review' })
      const duplicate = await call('POST', `${API}/tasks/${taskId}/results`, { body: { attemptId, manifest } })
      expect(duplicate.status, 'R16 duplicate').toBe(200)
      expect(duplicate.body).toMatchObject({ duplicate: true, evidenceId: accepted.body.evidenceId })
      const resultRows = await sql<{ total: string }>(`select count(*) as total from delivery_evidence where task_id = $1 and kind = 'result_manifest'`, [taskId])
      expect(resultRows[0]?.total, 'one result_manifest row after the duplicate').toBe('1')

      const review = await call('POST', `${API}/projects/${projectId}/evidence`, {
        body: { baselineId, kind: 'review', taskId, sourceRevision: manifest.resultRevision, payload: { verdict: 'approved', summary: 'All acceptance criteria proven', findings: [], reviewer: { kind: 'human' } } },
      })
      expect(review.status, 'R19 review').toBe(201)
      expect(review.body.taskStatus).toBe('verified')
      expect((await taskVersion(call, taskId)).status).toBe('verified')

      const revision = `git:${(manifest.resultRevision as { commitSha: string }).commitSha}`
      const report = await call('GET', `${API}/projects/${projectId}/report?revision=${encodeURIComponent(revision)}`)
      expect(report.status, 'R22 report').toBe(200)
      const reportBody = deliveryReportV1Schema.parse(report.body)
      const proofRow = reportBody.rows.find((row) => row.acId === 'AC-001' && row.taskId === taskId)
      expect(proofRow, 'report row for AC-001').toBeTruthy()
      expect(proofRow).toMatchObject({ acStatus: 'passed', testStatus: 'passed', evidenceId: accepted.body.evidenceId })
      expect(reportBody.gates.publishable.ok).toBe(true)

      const deployConsent = await call('POST', `${API}/projects/${projectId}/deploy-decisions`, {
        body: { baselineId, sourceRevision: manifest.resultRevision, verdict: 'approved' },
        lock: await projectVersion(call, projectId),
      })
      expect(deployConsent.status, 'R20 deploy consent').toBe(201)

      const now = new Date().toISOString()
      const deployment = await call('POST', `${API}/projects/${projectId}/evidence`, {
        body: {
          baselineId,
          kind: 'deployment',
          sourceRevision: manifest.resultRevision,
          payload: { url: 'https://preview.example.test', environment: 'preview', buildId: 'tc-oss-001', deployedAt: now, uploadStatus: 'succeeded', verification: null },
        },
      })
      expect(deployment.status, 'R19 unverified deployment').toBe(201)
      const release = await call('POST', `${API}/projects/${projectId}/release-decisions`, {
        body: { deploymentEvidenceId: deployment.body.evidenceId, verdict: 'approved' },
        lock: await projectVersion(call, projectId),
      })
      expect(release.status, 'R21 release without verified deployment').toBe(422)
      expect(release.body.code).toBe('deployment_unverified')
      const releaseRows = await sql<{ total: string }>(`select count(*) as total from delivery_decisions where project_id = $1 and kind = 'release'`, [projectId])
      expect(releaseRows[0]?.total, 'no release decision row').toBe('0')
    } finally {
      await cleanupSeeds(request, token, [seed])
    }
  })

  test('foreign organisation and foreign tenant users get 404 on every id of the owner', async ({ request }) => {
    test.slow()
    let token: string | null = null
    let seed: SeededTask | null = null
    const foreignUsers: ForeignUser[] = []
    const organizationIds: string[] = []
    const tenantIds: string[] = []
    try {
      token = await getAuthToken(request, 'admin')
      const superadminToken = await getAuthToken(request, 'superadmin')
      const call = caller(request, token)
      seed = await seedReadyTask(request, token, call, 'scope')
      const { projectId, taskId, baselineId, contentHash } = seed
      const reserved = await reserve(call, taskId, seed.taskUpdatedAt, `tc-delivery-oss-001-scope-${randomUUID()}`)
      expect(reserved.status).toBe(201)
      const attemptId = reserved.body.attemptId as string
      const { manifest, accepted } = await deliverResult(call, taskId, attemptId)
      expect(accepted.status).toBe(201)
      const deployment = await call('POST', `${API}/projects/${projectId}/evidence`, {
        body: {
          baselineId,
          kind: 'deployment',
          sourceRevision: manifest.resultRevision,
          payload: { url: 'https://preview.example.test', environment: 'preview', buildId: 'tc-oss-001-scope', deployedAt: new Date().toISOString(), uploadStatus: 'succeeded', verification: null },
        },
      })
      expect(deployment.status).toBe(201)
      const deploymentEvidenceId = deployment.body.evidenceId as string

      const ownerScope = getTokenScope(token)
      const siblingOrg = await createOrganizationInDb({ name: `TC-DELIVERY-OSS-001 org B ${Date.now()}`, tenantId: ownerScope.tenantId })
      organizationIds.push(siblingOrg)
      const foreignTenant = (await sql<{ id: string }>(
        `insert into tenants (id, name, is_active, created_at, updated_at) values (gen_random_uuid(), $1, true, now(), now()) returning id`,
        [`TC-DELIVERY-OSS-001 tenant C ${Date.now()}`],
      ))[0].id
      tenantIds.push(foreignTenant)
      const foreignTenantOrg = await createOrganizationInDb({ name: `TC-DELIVERY-OSS-001 org C ${Date.now()}`, tenantId: foreignTenant })
      organizationIds.push(foreignTenantOrg)

      const siblingUser = await createForeignUser(request, superadminToken, { tenantId: ownerScope.tenantId, organizationId: siblingOrg, label: 'org-b' }, foreignUsers)
      const tenantUser = await createForeignUser(request, superadminToken, { tenantId: foreignTenant, organizationId: foreignTenantOrg, label: 'tenant-c' }, foreignUsers)

      const ownerBefore = await sql(
        `select (select updated_at from delivery_projects where id = $1) as project, (select updated_at from delivery_tasks where id = $2) as task,
                (select execution_attempts from delivery_tasks where id = $2) as attempts,
                (select count(*) from delivery_decisions where project_id = $1) as decisions, (select count(*) from delivery_evidence where project_id = $1) as evidence`,
        [projectId, taskId],
      )
      const staleProject = await projectVersion(call, projectId)
      const taskLock = (await taskVersion(call, taskId)).updatedAt

      for (const foreign of [siblingUser, tenantUser]) {
        const foreignCall = caller(request, foreign.token)
        const ownList = await foreignCall('GET', `${API}/projects?pageSize=100`)
        expect(ownList.status, 'R1 list is allowed').toBe(200)
        expect((ownList.body.items as Json[]).map((item) => item.id)).not.toContain(projectId)

        const probes: Array<[string, () => Promise<CallResult>]> = [
          ['R5 project detail', () => foreignCall('GET', `${API}/projects/${projectId}`)],
          ['R3 project update', () => foreignCall('PUT', `${API}/projects`, { body: { id: projectId, brief: 'foreign write' } })],
          ['R4 project delete', () => foreignCall('DELETE', `${API}/projects?id=${projectId}`)],
          ['R6 baselines list', () => foreignCall('GET', `${API}/projects/${projectId}/baselines`)],
          ['R7 baseline create', () => foreignCall('POST', `${API}/projects/${projectId}/baselines`, { body: { source: 'manual' }, lock: staleProject })],
          ['R8 decision on baseline', () => foreignCall('POST', `${API}/baselines/${baselineId}/decisions`, { body: { kind: 'requirements', verdict: 'approved', subjectHash: contentHash, subjectVersion: 1 }, lock: staleProject })],
          ['R9 tasks list', () => foreignCall('GET', `${API}/projects/${projectId}/tasks`)],
          ['R10 task create', () => foreignCall('POST', `${API}/projects/${projectId}/tasks`, { body: { source: 'manual', baselineId, title: 'foreign', acIds: ['AC-001'] } })],
          ['R11 task detail', () => foreignCall('GET', `${API}/tasks/${taskId}`)],
          ['R12 task update', () => foreignCall('PUT', `${API}/tasks`, { body: { id: taskId, title: 'foreign' } })],
          ['R13 task delete', () => foreignCall('DELETE', `${API}/tasks?id=${taskId}`)],
          ['R14 reserve', () => foreignCall('POST', `${API}/tasks/${taskId}/attempts`, { body: reserveBody(COMMIT_A), lock: taskLock, headers: { 'Idempotency-Key': `foreign-${randomUUID()}` } })],
          ['R15 package', () => foreignCall('GET', `${API}/tasks/${taskId}/package?attemptId=${attemptId}`)],
          ['R16 results', () => foreignCall('POST', `${API}/tasks/${taskId}/results`, { body: { attemptId, manifest } })],
          ['R17 cancel', () => foreignCall('POST', `${API}/tasks/${taskId}/attempts/${attemptId}/cancel`, { body: {}, lock: taskLock })],
          ['R18 reconcile', () => foreignCall('POST', `${API}/tasks/${taskId}/attempts/${attemptId}/reconcile`, { body: { resolution: 'unknown', externalEvidence: { note: 'foreign', observedAt: new Date().toISOString() } }, lock: taskLock })],
          ['R19 evidence', () => foreignCall('POST', `${API}/projects/${projectId}/evidence`, { body: { baselineId, kind: 'scan', sourceRevision: manifest.resultRevision, payload: { checkId: 'dependency-audit', scanner: 'npm audit', status: 'passed', rawReportHash: 'd'.repeat(64) } } })],
          ['R20 deploy decision', () => foreignCall('POST', `${API}/projects/${projectId}/deploy-decisions`, { body: { baselineId, sourceRevision: manifest.resultRevision, verdict: 'approved' }, lock: staleProject })],
          ['R21 release decision', () => foreignCall('POST', `${API}/projects/${projectId}/release-decisions`, { body: { deploymentEvidenceId, verdict: 'approved' }, lock: staleProject })],
          ['R22 report', () => foreignCall('GET', `${API}/projects/${projectId}/report`)],
        ]
        for (const [label, probe] of probes) {
          const result = await probe()
          expect(result.status, `${label} as ${foreign.organizationId === siblingOrg ? "org B" : "tenant C"} user: ${JSON.stringify(result.body)}`).toBe(404)
          expect(JSON.stringify(result.body), `${label} leaks nothing`).not.toContain(projectId)
        }

        const lockedWrites: Array<[string, (id: string) => Promise<CallResult>, string]> = [
          ['R3 project update', (id) => foreignCall('PUT', `${API}/projects`, { body: { id, brief: 'foreign write' }, lock: staleProject }), projectId],
          ['R4 project delete', (id) => foreignCall('DELETE', `${API}/projects?id=${id}`, { lock: staleProject }), projectId],
          ['R12 task update', (id) => foreignCall('PUT', `${API}/tasks`, { body: { id, title: 'foreign' }, lock: taskLock }), taskId],
          ['R13 task delete', (id) => foreignCall('DELETE', `${API}/tasks?id=${id}`, { lock: taskLock }), taskId],
        ]
        for (const [label, write, ownerId] of lockedWrites) {
          const foreignAnswer = await write(ownerId)
          const missingAnswer = await write(randomUUID())
          expect(foreignAnswer.status, `${label} with a lock header: ${JSON.stringify(foreignAnswer.body)}`).toBe(409)
          expect(foreignAnswer.body, `${label} answers exactly like a never-existing id`).toEqual(missingAnswer.body)
          expect(foreignAnswer.body.code).toBe('optimistic_lock_conflict')
          expect(foreignAnswer.body.currentUpdatedAt, `${label} echoes the caller's own token`).toBe(foreignAnswer.body.expectedUpdatedAt)
          expect(JSON.stringify(foreignAnswer.body)).not.toContain(ownerId)
        }
      }

      const ownerAfter = await sql(
        `select (select updated_at from delivery_projects where id = $1) as project, (select updated_at from delivery_tasks where id = $2) as task,
                (select execution_attempts from delivery_tasks where id = $2) as attempts,
                (select count(*) from delivery_decisions where project_id = $1) as decisions, (select count(*) from delivery_evidence where project_id = $1) as evidence`,
        [projectId, taskId],
      )
      expect(ownerAfter, 'owner rows untouched by the foreign probes').toEqual(ownerBefore)
      const strayProjects = await sql<{ total: string }>('select count(*) as total from delivery_projects where organization_id = any($1::uuid[])', [organizationIds])
      expect(strayProjects[0]?.total, 'no probe created a project in a foreign scope').toBe('0')
    } finally {
      await cleanupSeeds(request, token, [seed])
      await deleteForeignFixtures(foreignUsers, organizationIds, tenantIds).catch(() => undefined)
    }
  })

  test('stale versions answer the platform 409 and the baseline unique index answers duplicate, never 5xx', async ({ request }) => {
    test.slow()
    let token: string | null = null
    let seed: SeededTask | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const call = caller(request, token)
      seed = await seedReadyTask(request, token, call, 'lock')
      const { projectId, taskId, baselineId } = seed

      const staleProject = await projectVersion(call, projectId)
      const fresh = await call('PUT', `${API}/projects`, { body: { id: projectId, brief: 'first writer' }, lock: staleProject })
      expect(fresh.status).toBe(200)
      const staleWrite = await call('PUT', `${API}/projects`, { body: { id: projectId, brief: 'second writer' }, lock: staleProject })
      expect(staleWrite.status, 'stale project update').toBe(409)
      expect(staleWrite.body).toMatchObject({ code: 'optimistic_lock_conflict' })
      expect(typeof staleWrite.body.error).toBe('string')
      const briefRows = await sql<{ brief: string | null }>('select brief from delivery_projects where id = $1', [projectId])
      expect(briefRows[0]?.brief, 'the stale write did not land').toBe('first writer')

      const staleTask = seed.taskUpdatedAt
      const taskWrite = await call('PUT', `${API}/tasks`, { body: { id: taskId, title: 'renamed' }, lock: staleTask })
      expect(taskWrite.status).toBe(200)
      const staleTaskWrite = await call('PUT', `${API}/tasks`, { body: { id: taskId, title: 'stale rename' }, lock: staleTask })
      expect(staleTaskWrite.status, 'stale task update').toBe(409)
      expect(staleTaskWrite.body).toMatchObject({ code: 'optimistic_lock_conflict' })

      const replay = await call('POST', `${API}/projects/${projectId}/baselines`, { body: { source: 'manual' }, lock: await projectVersion(call, projectId) })
      expect(replay.status, 'identical content is a duplicate').toBe(200)
      expect(replay.body).toMatchObject({ baselineId, duplicate: true })

      const redraft = await call('PUT', `${API}/projects`, {
        body: { id: projectId, draftSpec: draftSpecFor(seed.attachmentId, seed.sha256, 'Second plan summary for a new version.') },
        lock: await projectVersion(call, projectId),
      })
      expect(redraft.status).toBe(200)
      const version = await projectVersion(call, projectId)
      const racers = await Promise.all([0, 1, 2].map(() => call('POST', `${API}/projects/${projectId}/baselines`, { body: { source: 'manual' }, lock: version })))
      for (const racer of racers) {
        expect(racer.status, `parallel freeze answered ${JSON.stringify(racer.body)}`).toBeLessThan(500)
        if (racer.status === 409) expect(racer.body.code).toBe('optimistic_lock_conflict')
        else expect([200, 201]).toContain(racer.status)
      }
      expect(racers.filter((racer) => racer.status === 201), 'exactly one new baseline').toHaveLength(1)
      const winner = racers.find((racer) => racer.status === 201)!.body.baselineId
      for (const racer of racers.filter((entry) => entry.status === 200)) expect(racer.body).toMatchObject({ baselineId: winner, duplicate: true })
      const perHash = await sql<{ content_hash: string; total: string }>(
        'select content_hash, count(*) as total from delivery_baselines where project_id = $1 group by content_hash',
        [projectId],
      )
      expect(perHash, 'one row per (project, content_hash)').toHaveLength(2)
      expect(perHash.every((row) => row.total === '1')).toBe(true)
    } finally {
      await cleanupSeeds(request, token, [seed])
    }
  })

  test('a claimed attempt is cancelled, refuses a new reservation and is reconciled as stopped', async ({ request }) => {
    test.slow()
    let token: string | null = null
    let seed: SeededTask | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const call = caller(request, token)
      seed = await seedReadyTask(request, token, call, 'cancel')
      const { taskId } = seed
      const reserved = await reserve(call, taskId, seed.taskUpdatedAt, `tc-delivery-oss-001-cancel-${randomUUID()}`)
      expect(reserved.status).toBe(201)
      const attemptId = reserved.body.attemptId as string

      await sql(
        `update delivery_tasks set execution_attempts = (
           select jsonb_agg(case when entry->>'attemptId' = $2
             then entry || jsonb_build_object('state', 'claimed', 'claimedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'workerRef', 'tc-delivery-oss-001-worker')
             else entry end order by ordinality)
           from jsonb_array_elements(execution_attempts) with ordinality as register(entry, ordinality))
         where id = $1`,
        [taskId, attemptId],
      )

      const lock = (await taskVersion(call, taskId)).updatedAt
      const missingLock = await call('POST', `${API}/tasks/${taskId}/attempts/${attemptId}/cancel`, { body: {} })
      expect(missingLock.status).toBe(428)
      const cancelled = await call('POST', `${API}/tasks/${taskId}/attempts/${attemptId}/cancel`, { body: { reason: 'Operator stopped the run' }, lock })
      expect(cancelled.status, `cancel answered ${JSON.stringify(cancelled.body)}`).toBe(200)
      expect(cancelled.body).toMatchObject({ attemptId, state: 'cancel_requested', stopConfirmation: 'stop_unconfirmed', taskStatus: 'executing' })
      const register = await sql<{ state: string; worker: string }>(
        `select entry->>'state' as state, entry->>'workerRef' as worker from delivery_tasks, jsonb_array_elements(execution_attempts) entry where id = $1`,
        [taskId],
      )
      expect(register).toEqual([{ state: 'cancel_requested', worker: 'tc-delivery-oss-001-worker' }])

      const blocked = await reserve(call, taskId, String(cancelled.body.taskUpdatedAt), `tc-delivery-oss-001-cancel-${randomUUID()}`)
      expect(blocked.status, 'no new reservation before reconcile').toBe(409)
      expect(blocked.body.code).toBe('attempt_active')

      const reconciled = await call('POST', `${API}/tasks/${taskId}/attempts/${attemptId}/reconcile`, {
        body: { resolution: 'stopped', externalEvidence: { note: 'Worker process confirmed stopped', observedAt: new Date().toISOString() } },
        lock: String(cancelled.body.taskUpdatedAt),
      })
      expect(reconciled.status, `reconcile answered ${JSON.stringify(reconciled.body)}`).toBe(200)
      expect(reconciled.body).toMatchObject({ attemptId, resolution: 'stopped', taskStatus: 'ready' })
      const closed = await sql<{ state: string; outcome: string; stop: string }>(
        `select entry->>'state' as state, entry->>'outcome' as outcome, entry->>'stopConfirmation' as stop from delivery_tasks, jsonb_array_elements(execution_attempts) entry where id = $1`,
        [taskId],
      )
      expect(closed).toEqual([{ state: 'closed', outcome: 'cancelled', stop: 'stopped' }])

      const again = await reserve(call, taskId, String(reconciled.body.taskUpdatedAt), `tc-delivery-oss-001-cancel-${randomUUID()}`)
      expect(again.status, 'a new reservation after reconcile').toBe(201)
      expect(again.body.attemptId).not.toBe(attemptId)
    } finally {
      await cleanupSeeds(request, token, [seed])
    }
  })
})
