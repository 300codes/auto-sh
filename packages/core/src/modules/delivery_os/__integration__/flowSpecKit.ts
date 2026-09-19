import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createUserFixture } from '@open-mercato/core/helpers/integration/authFixtures'
import { deleteAttachmentIfExists, uploadAttachmentFixture } from '@open-mercato/core/helpers/integration/attachmentsFixtures'
import { createOrganizationInDb, setUserAclInDb, withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { buildResultManifest } from '../lib/fixtures/builders'
import type { BaselineContentV1, ClientApproval, IntakeV1, ScopingProposalV1, StageArtifactV1, TaskPackageV1 } from '../lib/contracts'

/**
 * Spec-local helpers shared by the TC-DELIVERY-FLOW-* specs (F1 flow on the real database). Not a spec file, so the
 * integration discovery ignores it. Modelled on TC-DELIVERY-OSS-001.spec.ts: fixtures are read with `readFileSync`
 * (relative JSON imports fail under Playwright), rows are hard-deleted by project id in teardown together with their
 * query-index rows, and every helper takes the spec's own registry so nothing leaks between spec files.
 */

export const API = '/api/delivery_os'
export const LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'
export const PROFILE = { profileId: 'wordpress-theme', profileVersion: 1 } as const
export const TEMPLATE = { templateId: 'delivery-default', templateVersion: 1 } as const
export const SNAPSHOT_BASE = { kind: 'snapshot', contentHash: 'a'.repeat(64), externalWorkspaceId: 'wp-local-workspace' } as const
export const FOREIGN_PASSWORD = 'Secret123!'
export const CLIENT_APPROVAL: ClientApproval = {
  approverName: 'Anna Kowalska',
  approverRole: 'Owner',
  evidence: { kind: 'meeting', reference: 'Review call 2026-09-19', attachment: null, recordedAt: '2026-09-19T10:00:00.000Z' },
}
export const FLOW_GATE_DETAIL_CODES = ['stage_not_approved', 'stage_dependency_stale']

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)
const INDEX_TABLES = ['entity_indexes', 'search_tokens']
const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'fixtures')

export type Json = Record<string, unknown>
export type CallResult = { status: number; body: Json }
export type Call = (method: string, path: string, options?: { body?: unknown; lock?: string; headers?: Record<string, string> }) => Promise<CallResult>
export type ArtifactRef = { artifactId: string; version: number; contentHash: string }
export type StageId = 'scope' | 'ux' | 'key_visual' | 'design_system_ui'
export type ForeignUser = { userId: string; token: string; organizationId: string; tenantId: string }

export type Registry = {
  projectIds: string[]
  attachmentIds: string[]
  resourceIds: Set<string>
  userIds: string[]
  organizationIds: string[]
  staffProjectIds: string[]
}

export function createRegistry(): Registry {
  return { projectIds: [], attachmentIds: [], resourceIds: new Set<string>(), userIds: [], organizationIds: [], staffProjectIds: [] }
}

export function loadFixture<T>(relative: string): T {
  return JSON.parse(readFileSync(path.join(FIXTURES_DIR, relative), 'utf-8')) as T
}

export const baselineContent = loadFixture<BaselineContentV1>('baseline-content.v1.json')

export function intakeFixture(): IntakeV1 {
  return loadFixture<IntakeV1>('flow/intake.v1.json')
}

export function scopingProposalFixture(): ScopingProposalV1 {
  return loadFixture<ScopingProposalV1>('flow/scoping-proposal.v1.json')
}

export function scopeArtifact(projectId: string, summary?: string): StageArtifactV1 {
  const fixture = loadFixture<StageArtifactV1>('flow/stage-artifact.scope.v1.json')
  if (fixture.stageId !== 'scope') throw new Error('[internal] scope fixture expected')
  return { ...fixture, projectId, source: 'manual', content: { ...fixture.content, summary: summary ?? fixture.content.summary } }
}

export function designArtifact(
  projectId: string,
  stageId: Exclude<StageId, 'scope'>,
  dependsOn: Array<ArtifactRef & { stageId: StageId }>,
  summary?: string,
): StageArtifactV1 {
  return {
    schemaVersion: 'delivery.stage-artifact/v1',
    projectId,
    stageId,
    source: 'manual',
    dependsOn,
    attachments: [],
    producedBy: null,
    content: { summary: summary ?? `${stageId} package`, figmaRefs: [], screens: [], notes: null, resolvedThreadKeys: [] },
  } as StageArtifactV1
}

export function withStage(stageId: StageId, ref: ArtifactRef): ArtifactRef & { stageId: StageId } {
  return { stageId, ...ref }
}

export function caller(request: APIRequestContext, token: string): Call {
  return async (method, requestPath, options = {}) => {
    const headers: Record<string, string> = { ...(options.headers ?? {}) }
    if (options.lock) headers[LOCK_HEADER] = options.lock
    const response = await apiRequest(request, method, requestPath, { token, data: options.body, headers })
    return { status: response.status(), body: (await readJsonSafe<Json>(response)) ?? {} }
  }
}

export async function sql<T = Json>(text: string, values: unknown[] = []): Promise<T[]> {
  return withClient(async (client) => (await client.query<T>(text, values)).rows)
}

export function expectError(result: CallResult, status: number, code: string, label: string): void {
  expect({ status: result.status, code: result.body.code }, `${label}: ${JSON.stringify(result.body)}`).toEqual({ status, code })
}

export function expectGateRefusal(result: CallResult, label: string): void {
  expectError(result, 422, 'baseline_not_approved', label)
  const details = result.body.details as Array<{ code: string; path: string }>
  expect(Array.isArray(details) && details.length > 0, `${label}: details[]`).toBe(true)
  for (const detail of details) {
    expect(FLOW_GATE_DETAIL_CODES, `${label}: detail ${detail.path}`).toContain(detail.code)
    expect(detail.path).toMatch(/^stages\./)
  }
}

export async function createProject(call: Call, registry: Registry, label: string, extra: Json = {}): Promise<{ id: string; updatedAt: string; createdAt: string }> {
  const created = await call('POST', `${API}/projects`, {
    body: { name: `${label} ${Date.now()}`, inputMode: 'from_brief', targetProfileId: PROFILE.profileId, brief: 'F1 flow on the real database', ...extra },
  })
  expect(created.status, `R2 create project: ${JSON.stringify(created.body)}`).toBe(201)
  const id = created.body.id as string
  registry.projectIds.push(id)
  return { id, updatedAt: created.body.updatedAt as string, createdAt: created.body.createdAt as string }
}

export async function projectVersion(call: Call, projectId: string): Promise<string> {
  const detail = await call('GET', `${API}/projects/${projectId}`)
  expect(detail.status, `R5 project detail: ${JSON.stringify(detail.body)}`).toBe(200)
  return detail.body.updatedAt as string
}

export async function pinProject(call: Call, projectId: string, lock: string | null, body: Json = { ...TEMPLATE }): Promise<CallResult> {
  return call('POST', `${API}/projects/${projectId}/flow/pin`, { body, lock: lock ?? undefined })
}

export async function createPinnedProject(call: Call, registry: Registry, label: string): Promise<string> {
  const project = await createProject(call, registry, label)
  const pinned = await pinProject(call, project.id, project.updatedAt)
  expect(pinned.status, `F4 pin: ${JSON.stringify(pinned.body)}`).toBe(201)
  return project.id
}

export async function getFlow(call: Call, projectId: string): Promise<Json> {
  const status = await call('GET', `${API}/projects/${projectId}/flow`)
  expect(status.status, `F6 flow: ${JSON.stringify(status.body)}`).toBe(200)
  return status.body
}

export function stageCurrencies(flow: Json): Record<string, string | null> {
  const stages = flow.stages as Array<{ stageId: string; currency: string | null }>
  return Object.fromEntries(stages.map((stage) => [stage.stageId, stage.currency]))
}

export function postArtifact(call: Call, projectId: string, stageId: string, body: unknown, lock: string | null): Promise<CallResult> {
  return call('POST', `${API}/projects/${projectId}/stages/${stageId}/artifacts`, { body, lock: lock ?? undefined })
}

export async function recordArtifact(call: Call, projectId: string, artifact: StageArtifactV1): Promise<ArtifactRef> {
  const created = await postArtifact(call, projectId, artifact.stageId, artifact, await projectVersion(call, projectId))
  expect(created.status, `F7 ${artifact.stageId} artifact: ${JSON.stringify(created.body)}`).toBe(201)
  return { artifactId: created.body.artifactId as string, version: created.body.version as number, contentHash: created.body.contentHash as string }
}

export function approvalFor(ref: ArtifactRef, overrides: Json = {}): Json {
  return { artifactId: ref.artifactId, subjectHash: ref.contentHash, subjectVersion: ref.version, verdict: 'approved', ...overrides }
}

export function postDecision(
  call: Call,
  projectId: string,
  stageId: string,
  body: unknown,
  options: { key: string | null; lock: string | null },
): Promise<CallResult> {
  const headers: Record<string, string> = options.key === null ? {} : { 'Idempotency-Key': options.key }
  return call('POST', `${API}/projects/${projectId}/stages/${stageId}/decisions`, { body, lock: options.lock ?? undefined, headers })
}

export async function approveStage(call: Call, projectId: string, stageId: StageId, ref: ArtifactRef, extra: Json = {}): Promise<Json> {
  const key = `tc-flow-${stageId}-${randomUUID()}`
  const decided = await postDecision(call, projectId, stageId, approvalFor(ref, extra), { key, lock: await projectVersion(call, projectId) })
  expect(decided.status, `F8 approve ${stageId}: ${JSON.stringify(decided.body)}`).toBe(201)
  return decided.body
}

export type ApprovedChain = { scope: ArtifactRef; ux: ArtifactRef; keyVisual: ArtifactRef; designSystemUi: ArtifactRef }

/** Records and approves all four approval stages in template order (client approval on key_visual and design_system_ui). */
export async function approveAllStages(call: Call, projectId: string): Promise<ApprovedChain> {
  const scope = await recordArtifact(call, projectId, scopeArtifact(projectId))
  await approveStage(call, projectId, 'scope', scope)
  const ux = await recordArtifact(call, projectId, designArtifact(projectId, 'ux', [withStage('scope', scope)]))
  await approveStage(call, projectId, 'ux', ux)
  const keyVisual = await recordArtifact(call, projectId, designArtifact(projectId, 'key_visual', [withStage('scope', scope), withStage('ux', ux)]))
  await approveStage(call, projectId, 'key_visual', keyVisual, { clientApproval: CLIENT_APPROVAL })
  const designSystemUi = await recordArtifact(
    call,
    projectId,
    designArtifact(projectId, 'design_system_ui', [withStage('scope', scope), withStage('ux', ux), withStage('key_visual', keyVisual)]),
  )
  await approveStage(call, projectId, 'design_system_ui', designSystemUi, { clientApproval: CLIENT_APPROVAL })
  return { scope, ux, keyVisual, designSystemUi }
}

export function listArtifacts(call: Call, projectId: string, stageId: string, query = ''): Promise<CallResult> {
  return call('GET', `${API}/projects/${projectId}/stages/${stageId}/artifacts${query}`)
}

export function listDecisions(call: Call, projectId: string, stageId: string, query = ''): Promise<CallResult> {
  return call('GET', `${API}/projects/${projectId}/stages/${stageId}/decisions${query}`)
}

export type LegacyBaseline = { projectId: string; attachmentId: string; baselineId: string; contentHash: string; version: number }

function draftSpecFor(attachmentId: string, sha256: string) {
  return {
    requirements: baselineContent.requirements,
    acceptanceCriteria: baselineContent.acceptanceCriteria,
    screens: baselineContent.screens.map((screen) => ({ ...screen, attachmentId, sha256 })),
    tokens: baselineContent.tokens,
    architectureSummary: baselineContent.architectureSummary,
    planSummary: baselineContent.planSummary,
    acTestMap: baselineContent.acTestMap,
    manualChecks: baselineContent.manualChecks,
    declaredTests: baselineContent.declaredTests,
    attachments: [{ attachmentId, sha256 }],
  }
}

/** v1 seed on an (initially unpinned) wordpress-theme project: attachment → draft → manual baseline → requirements + design approved. */
export async function seedApprovedBaseline(request: APIRequestContext, token: string, call: Call, registry: Registry, label: string): Promise<LegacyBaseline> {
  const project = await createProject(call, registry, label)
  const projectId = project.id
  const upload = await uploadAttachmentFixture(request, token, {
    entityId: 'delivery_os:delivery_project',
    recordId: projectId,
    fileName: `tc-delivery-flow-${label}.png`,
    mimeType: 'image/png',
    buffer: PNG_1X1,
  })
  registry.attachmentIds.push(upload.id)
  const sha256 = createHash('sha256').update(PNG_1X1).digest('hex')

  const draft = await call('PUT', `${API}/projects`, {
    body: { id: projectId, draftSpec: draftSpecFor(upload.id, sha256) },
    lock: await projectVersion(call, projectId),
  })
  expect(draft.status, `R3 draft: ${JSON.stringify(draft.body)}`).toBe(200)
  const baseline = await call('POST', `${API}/projects/${projectId}/baselines`, { body: { source: 'manual' }, lock: await projectVersion(call, projectId) })
  expect(baseline.status, `R7 manual baseline: ${JSON.stringify(baseline.body)}`).toBe(201)
  const { baselineId, contentHash, version } = baseline.body as { baselineId: string; contentHash: string; version: number }
  for (const kind of ['requirements', 'design']) {
    const decision = await call('POST', `${API}/baselines/${baselineId}/decisions`, {
      body: { kind, verdict: 'approved', subjectHash: contentHash, subjectVersion: version },
      lock: await projectVersion(call, projectId),
    })
    expect(decision.status, `R8 ${kind} decision: ${JSON.stringify(decision.body)}`).toBe(201)
  }
  return { projectId, attachmentId: upload.id, baselineId, contentHash, version }
}

export type SeededTask = { taskId: string; updatedAt: string }

export async function createTask(call: Call, projectId: string, baselineId: string, title: string, acIds: string[] = ['AC-001', 'AC-002']): Promise<SeededTask> {
  const task = await call('POST', `${API}/projects/${projectId}/tasks`, {
    body: { source: 'manual', baselineId, title, acIds, allowedPaths: ['templates/**'] },
  })
  expect(task.status, `R10 task: ${JSON.stringify(task.body)}`).toBe(201)
  return { taskId: String(task.body.id), updatedAt: String(task.body.updatedAt) }
}

export function setTaskReady(call: Call, taskId: string, lock: string): Promise<CallResult> {
  return call('PUT', `${API}/tasks`, { body: { id: taskId, status: 'ready' }, lock })
}

export async function createReadyTask(call: Call, projectId: string, baselineId: string, title: string, acIds?: string[]): Promise<SeededTask> {
  const task = await createTask(call, projectId, baselineId, title, acIds)
  const ready = await setTaskReady(call, task.taskId, task.updatedAt)
  expect(ready.status, `R12 ready: ${JSON.stringify(ready.body)}`).toBe(200)
  return { taskId: task.taskId, updatedAt: String(ready.body.updatedAt) }
}

export async function taskVersion(call: Call, taskId: string): Promise<{ updatedAt: string; status: string }> {
  const detail = await call('GET', `${API}/tasks/${taskId}`)
  expect(detail.status, `R11 task detail: ${JSON.stringify(detail.body)}`).toBe(200)
  return { updatedAt: detail.body.updatedAt as string, status: detail.body.status as string }
}

export function reserveBody(): Json {
  return { mode: 'manual_handoff', baseRevision: { ...SNAPSHOT_BASE } }
}

export function reserve(call: Call, taskId: string, lock: string | null, key = `tc-flow-reserve-${randomUUID()}`): Promise<CallResult> {
  return call('POST', `${API}/tasks/${taskId}/attempts`, { body: reserveBody(), lock: lock ?? undefined, headers: { 'Idempotency-Key': key } })
}

export function cancelAttempt(call: Call, taskId: string, attemptId: string, lock: string): Promise<CallResult> {
  return call('POST', `${API}/tasks/${taskId}/attempts/${attemptId}/cancel`, { body: {}, lock })
}

export function reconcileAttempt(call: Call, taskId: string, attemptId: string, lock: string, resolution: 'stopped' | 'not_started' | 'unknown'): Promise<CallResult> {
  return call('POST', `${API}/tasks/${taskId}/attempts/${attemptId}/reconcile`, {
    body: { resolution, externalEvidence: { note: 'Operator confirmed the workspace state', observedAt: new Date().toISOString() } },
    lock,
  })
}

/** Reserve → package → result manifest → human review approved: the task ends `verified` and the report is publishable on the result revision. */
export async function deliverVerifiedResult(call: Call, projectId: string, baselineId: string, task: SeededTask): Promise<{ attemptId: string; manifest: ReturnType<typeof buildResultManifest> }> {
  const reserved = await reserve(call, task.taskId, task.updatedAt)
  expect(reserved.status, `R14 reserve: ${JSON.stringify(reserved.body)}`).toBe(201)
  const attemptId = reserved.body.attemptId as string
  const taskPackage = await call('GET', `${API}/tasks/${task.taskId}/package?attemptId=${attemptId}`)
  expect(taskPackage.status, `R15 package: ${JSON.stringify(taskPackage.body)}`).toBe(200)
  const manifest = buildResultManifest(taskPackage.body as unknown as TaskPackageV1, { changedPaths: ['templates/index.html'] })
  const accepted = await call('POST', `${API}/tasks/${task.taskId}/results`, { body: { attemptId, manifest } })
  expect(accepted.status, `R16 result: ${JSON.stringify(accepted.body)}`).toBe(201)
  const review = await call('POST', `${API}/projects/${projectId}/evidence`, {
    body: {
      baselineId,
      kind: 'review',
      taskId: task.taskId,
      sourceRevision: manifest.resultRevision,
      payload: { verdict: 'approved', summary: 'All acceptance criteria proven', findings: [], reviewer: { kind: 'human' } },
    },
  })
  expect(review.status, `R19 review: ${JSON.stringify(review.body)}`).toBe(201)
  expect(review.body.taskStatus).toBe('verified')
  return { attemptId, manifest }
}

export function deployConsent(call: Call, projectId: string, baselineId: string, sourceRevision: unknown, lock: string): Promise<CallResult> {
  return call('POST', `${API}/projects/${projectId}/deploy-decisions`, { body: { baselineId, sourceRevision, verdict: 'approved' }, lock })
}

/** Creates a user homed in `organizationId` with the given features; the ACL row is written before the first login so no RBAC cache entry predates it. */
export async function createScopedUser(
  request: APIRequestContext,
  superadminToken: string,
  registry: Registry,
  input: { tenantId: string; organizationId: string; label: string; features?: string[] },
): Promise<ForeignUser> {
  const email = `tc-delivery-flow-${input.label}-${Date.now()}-${randomUUID().slice(0, 8)}@example.com`
  const userId = await createUserFixture(request, superadminToken, { email, password: FOREIGN_PASSWORD, organizationId: input.organizationId, roles: [] })
  registry.userIds.push(userId)
  await setUserAclInDb({ userId, tenantId: input.tenantId, features: input.features ?? ['delivery_os.*'], organizations: [input.organizationId] })
  const token = await getAuthToken(request, email, FOREIGN_PASSWORD)
  expect(getTokenScope(token).organizationId).toBe(input.organizationId)
  return { userId, token, organizationId: input.organizationId, tenantId: input.tenantId }
}

/** A sibling organisation in the owner's tenant plus a user carrying `features` (default `delivery_os.*`) there. */
export async function createSiblingOrgUser(
  request: APIRequestContext,
  ownerToken: string,
  registry: Registry,
  label: string,
  features?: string[],
): Promise<ForeignUser> {
  const superadminToken = await getAuthToken(request, 'superadmin')
  const ownerScope = getTokenScope(ownerToken)
  const organizationId = await createOrganizationInDb({ name: `TC-DELIVERY-FLOW ${label} org B ${Date.now()}`, tenantId: ownerScope.tenantId })
  registry.organizationIds.push(organizationId)
  return createScopedUser(request, superadminToken, registry, { tenantId: ownerScope.tenantId, organizationId, label: `${label}-org-b`, features })
}

/** A user in the owner's own organisation carrying only the given features (for 403 probes). */
export async function createOwnerOrgUser(request: APIRequestContext, ownerToken: string, registry: Registry, label: string, features: string[]): Promise<ForeignUser> {
  const superadminToken = await getAuthToken(request, 'superadmin')
  const ownerScope = getTokenScope(ownerToken)
  return createScopedUser(request, superadminToken, registry, { tenantId: ownerScope.tenantId, organizationId: ownerScope.organizationId, label, features })
}

export async function deliveryRowCounts(registry: Registry): Promise<number> {
  const projectIds = registry.projectIds
  const indexedIds = [...new Set([...projectIds, ...registry.resourceIds])]
  const indexRows = await sql<{ total: string }>(
    `select
       (select count(*) from entity_indexes where entity_type like 'delivery_os:%' and entity_id = any($1::text[]))
     + (select count(*) from search_tokens where entity_type like 'delivery_os:%' and entity_id = any($1::text[]))
     + (select count(*) from entity_indexes where entity_type = 'auth:user' and entity_id = any($2::text[]))
     + (select count(*) from search_tokens where entity_type = 'auth:user' and entity_id = any($2::text[])) as total`,
    [indexedIds, registry.userIds],
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
     + (select count(*) from delivery_staff_links where project_id = any($1::uuid[]))
     + (select count(*) from delivery_comment_threads where project_id = any($1::uuid[]))
     + (select count(*) from delivery_comment_replies where thread_id in (select id from delivery_comment_threads where project_id = any($1::uuid[])))
     + (select count(*) from users where id = any($2::uuid[]))
     + (select count(*) from organizations where id = any($3::uuid[]))
     + (select count(*) from action_logs where resource_kind like 'delivery_os%'
          and (resource_id = any($4::text[]) or parent_resource_id = any($4::text[]))) as total`,
    [projectIds, registry.userIds, registry.organizationIds, indexedIds],
  )
  return Number(rows[0]?.total ?? 0) + Number(indexRows[0]?.total ?? 0) + (await staffRowCounts(registry))
}

export async function deleteProjectsInDb(registry: Registry): Promise<void> {
  const projectIds = registry.projectIds
  if (projectIds.length === 0) return
  await withClient(async (client) => {
    const owned = await client.query<{ id: string }>(
      `select id::text as id from delivery_projects where id = any($1::uuid[])
       union all select id::text from delivery_baselines where project_id = any($1::uuid[])
       union all select id::text from delivery_decisions where project_id = any($1::uuid[])
       union all select id::text from delivery_tasks where project_id = any($1::uuid[])
       union all select id::text from delivery_evidence where project_id = any($1::uuid[])
       union all select id::text from delivery_intakes where project_id = any($1::uuid[])
       union all select id::text from delivery_flow_stage_artifacts where project_id = any($1::uuid[])
       union all select id::text from delivery_flow_stage_decisions where project_id = any($1::uuid[])
       union all select id::text from delivery_staff_links where project_id = any($1::uuid[])
       union all select id::text from delivery_comment_threads where project_id = any($1::uuid[])
       union all select id::text from delivery_comment_replies where thread_id in (select id from delivery_comment_threads where project_id = any($1::uuid[]))`,
      [projectIds],
    )
    const resourceIds = owned.rows.map((row) => row.id)
    for (const id of resourceIds) registry.resourceIds.add(id)
    const indexedIds = [...new Set([...projectIds, ...registry.resourceIds])]
    for (const table of INDEX_TABLES) {
      await client.query(`delete from ${table} where entity_type like 'delivery_os:%' and entity_id = any($1::text[])`, [indexedIds])
    }
    await client.query(
      `delete from action_logs where resource_kind like 'delivery_os%' and (resource_id = any($1::text[]) or parent_resource_id = any($1::text[]))`,
      [indexedIds],
    )
    await client.query('delete from delivery_comment_replies where thread_id in (select id from delivery_comment_threads where project_id = any($1::uuid[]))', [projectIds])
    for (const table of ['delivery_comment_threads', 'delivery_staff_links', 'delivery_flow_stage_decisions', 'delivery_flow_stage_artifacts', 'delivery_intakes', 'delivery_evidence', 'delivery_decisions', 'delivery_tasks', 'delivery_baselines']) {
      await client.query(`delete from ${table} where project_id = any($1::uuid[])`, [projectIds])
    }
    await client.query('delete from delivery_projects where id = any($1::uuid[])', [projectIds])
  })
}

export async function deleteUsersAndOrgsInDb(registry: Registry): Promise<void> {
  const userIds = registry.userIds
  const organizationIds = registry.organizationIds
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
  })
}

/** Full teardown for a spec: rows by project id, attachments via the API, users and organisations; idempotent. */
export async function cleanupRegistry(request: APIRequestContext, token: string | null, registry: Registry): Promise<void> {
  await deleteProjectsInDb(registry).catch(() => undefined)
  await deleteStaffProjectsInDb(registry).catch(() => undefined)
  const adminToken = token ?? (await getAuthToken(request, 'admin'))
  for (const attachmentId of registry.attachmentIds) await deleteAttachmentIfExists(request, adminToken, attachmentId)
  await deleteUsersAndOrgsInDb(registry).catch(() => undefined)
}

export async function expectNothingLeft(request: APIRequestContext, registry: Registry): Promise<void> {
  await cleanupRegistry(request, null, registry)
  const leftAttachments = await sql<{ total: string }>('select count(*) as total from attachments where id = any($1::uuid[])', [registry.attachmentIds])
  expect(leftAttachments[0]?.total, 'no attachment of this spec is left behind').toBe('0')
  expect(await deliveryRowCounts(registry), 'no row of this spec is left behind').toBe(0)
}

export const STAFF_API = '/api/staff/timesheets'
export const STAFF_FEATURES = ['delivery_os.*', 'staff.*']

export type StaffStatus = { id: string; name: string; isDefault: boolean; isDone: boolean }
export type StaffTask = { id: string; title: string; description: string | null; taskStatusId: string; updatedAt: string }
export type StaffComment = { id: string; body: string; authorUserId: string | null }

function staffOwnedIdsSql(): string {
  return `select id::text as id from staff_time_projects where id = any($1::uuid[])
     union all select id::text from staff_time_task_statuses where time_project_id = any($1::uuid[])
     union all select id::text from staff_time_tasks where time_project_id = any($1::uuid[])
     union all select c.id::text from staff_time_task_comments c join staff_time_tasks t on t.id = c.task_id where t.time_project_id = any($1::uuid[])
     union all select id::text from staff_time_project_members where time_project_id = any($1::uuid[])
     union all select tt.id::text from staff_time_task_tags tt join staff_time_tasks t on t.id = tt.task_id where t.time_project_id = any($1::uuid[])`
}

/** Staff projects, their board, cards, card comments and members, plus the query-index and audit rows they produced. */
export async function staffRowCounts(registry: Registry): Promise<number> {
  if (registry.staffProjectIds.length === 0) return 0
  const rows = await sql<{ total: string }>(
    `with owned as (${staffOwnedIdsSql()})
     select (select count(*) from owned)
          + (select count(*) from entity_indexes where entity_type like 'staff:%' and entity_id in (select id from owned))
          + (select count(*) from search_tokens where entity_type like 'staff:%' and entity_id in (select id from owned))
          + (select count(*) from action_logs where resource_kind like 'staff.%' and (resource_id in (select id from owned) or parent_resource_id in (select id from owned))) as total`,
    [registry.staffProjectIds],
  )
  return Number(rows[0]?.total ?? 0)
}

/** Hard-deletes every staff row this spec created (the staff API only soft-deletes and refuses a project with cards). */
export async function deleteStaffProjectsInDb(registry: Registry): Promise<void> {
  const staffProjectIds = registry.staffProjectIds
  if (staffProjectIds.length === 0) return
  await withClient(async (client) => {
    const owned = (await client.query<{ id: string }>(staffOwnedIdsSql(), [staffProjectIds])).rows.map((row) => row.id)
    for (const table of INDEX_TABLES) {
      await client.query(`delete from ${table} where entity_type like 'staff:%' and entity_id = any($1::text[])`, [owned])
    }
    await client.query(
      `delete from action_logs where resource_kind like 'staff.%' and (resource_id = any($1::text[]) or parent_resource_id = any($1::text[]))`,
      [owned],
    )
    for (const table of ['staff_time_task_comments', 'staff_time_task_tags']) {
      await client.query(`delete from ${table} where task_id in (select id from staff_time_tasks where time_project_id = any($1::uuid[]))`, [staffProjectIds])
    }
    for (const table of ['staff_time_tasks', 'staff_time_task_statuses', 'staff_time_project_members']) {
      await client.query(`delete from ${table} where time_project_id = any($1::uuid[])`, [staffProjectIds])
    }
    await client.query('delete from staff_time_projects where id = any($1::uuid[])', [staffProjectIds])
  })
}

/** A staff time project through the public staff API; its create command seeds the default board in the same transaction. */
export async function createStaffProject(call: Call, registry: Registry, label: string): Promise<string> {
  const code = `TCF-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`.toUpperCase()
  const created = await call('POST', `${STAFF_API}/time-projects`, { body: { name: `TC-DELIVERY-FLOW ${label}`, code, customerId: randomUUID() } })
  expect(created.status, `staff project: ${JSON.stringify(created.body)}`).toBe(201)
  const id = created.body.id as string
  registry.staffProjectIds.push(id)
  return id
}

export async function listStaffStatuses(call: Call, staffProjectId: string): Promise<StaffStatus[]> {
  const listed = await call('GET', `${STAFF_API}/task-statuses?timeProjectId=${staffProjectId}&pageSize=100`)
  expect(listed.status, `staff statuses: ${JSON.stringify(listed.body)}`).toBe(200)
  return (listed.body.items as Json[]).map((item) => ({
    id: String(item.id),
    name: String(item.name),
    isDefault: Boolean(item.is_default ?? item.isDefault),
    isDone: Boolean(item.is_done ?? item.isDone),
  }))
}

export async function listStaffTasks(call: Call, staffProjectId: string): Promise<StaffTask[]> {
  const listed = await call('GET', `${STAFF_API}/tasks?timeProjectId=${staffProjectId}&pageSize=100`)
  expect(listed.status, `staff tasks: ${JSON.stringify(listed.body)}`).toBe(200)
  return (listed.body.items as Json[]).map((item) => ({
    id: String(item.id),
    title: String(item.title),
    description: (item.description as string | null) ?? null,
    taskStatusId: String(item.task_status_id ?? item.taskStatusId),
    updatedAt: new Date(String(item.updated_at ?? item.updatedAt)).toISOString(),
  }))
}

export async function listStaffComments(call: Call, staffTaskId: string): Promise<StaffComment[]> {
  const listed = await call('GET', `${STAFF_API}/tasks/${staffTaskId}/comments`)
  expect(listed.status, `staff comments: ${JSON.stringify(listed.body)}`).toBe(200)
  return (listed.body.items as Json[]).map((item) => ({ id: String(item.id), body: String(item.body), authorUserId: (item.authorUserId as string | null) ?? null }))
}

export function putStaffLink(call: Call, projectId: string, staffProjectId: string, lock: string | null): Promise<CallResult> {
  return call('PUT', `${API}/projects/${projectId}/staff-link`, { body: { staffProjectId }, lock: lock ?? undefined })
}

export async function linkStaffProject(call: Call, projectId: string, staffProjectId: string): Promise<Json> {
  const linked = await putStaffLink(call, projectId, staffProjectId, await projectVersion(call, projectId))
  expect(linked.status, `F10 link: ${JSON.stringify(linked.body)}`).toBe(200)
  return linked.body
}

/** The frozen `comment-import.v1.json` fixture re-targeted at a project; `overrides` replaces top-level batch fields. */
export function commentBatch(projectId: string, overrides: Json = {}): Json {
  return { ...loadFixture<Json>('flow/comment-import.v1.json'), projectId, ...overrides }
}

export function importComments(call: Call, projectId: string, batch: unknown, key: string): Promise<CallResult> {
  return call('POST', `${API}/projects/${projectId}/comment-imports`, { body: batch, headers: { 'Idempotency-Key': key } })
}

export function listCommentThreads(call: Call, projectId: string, query = ''): Promise<CallResult> {
  return call('GET', `${API}/projects/${projectId}/comment-threads${query}`)
}

export function triageThread(call: Call, projectId: string, threadId: string, body: unknown, lock: string | null): Promise<CallResult> {
  return call('POST', `${API}/projects/${projectId}/comment-threads/${threadId}/triage`, { body, lock: lock ?? undefined })
}
