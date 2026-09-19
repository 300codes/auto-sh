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
import { type BaselineContentV1, type TaskPackageV1 } from '../lib/contracts'

/**
 * TC-DELIVERY-007: Cancel and reconcile ACL + state transitions.
 *
 * Covers:
 *  1. Cancel requires `delivery_os.attempts.manage`            — 403 without it
 *  2. Reconcile requires `delivery_os.attempts.reconcile`      — 403 without it
 *  3. Late result after cancel                                 — 409
 *  4. Unknown resolution value on reconcile                    — 422
 *  5. Completed→verified direct transition is blocked          — documented
 *
 * ACL features confirmed from `packages/core/src/modules/delivery_os/acl.ts`:
 *   - `delivery_os.attempts.manage`    — reserve, cancel, export
 *   - `delivery_os.attempts.reconcile` — reconcile
 *
 * ENVIRONMENT: shares the same app+database as TC-DELIVERY-OSS-001. All seeded projects are
 * hard-deleted in afterAll. Foreign fixture users and orgs are removed. Run with the
 * integration harness: `yarn test:integration`.
 */

const baselineContent = JSON.parse(
  readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'fixtures', 'baseline-content.v1.json'),
    'utf-8',
  ),
) as BaselineContentV1

const API = '/api/delivery_os'
const LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)
const COMMIT_A = 'a'.repeat(40)
const FIXTURE_PASSWORD = 'Secret123!'

type Json = Record<string, unknown>
type CallResult = { status: number; body: Json }
type Call = (method: string, path: string, options?: { body?: unknown; lock?: string; headers?: Record<string, string> }) => Promise<CallResult>

const createdProjectIds: string[] = []
const createdAttachmentIds: string[] = []
const createdResourceIds = new Set<string>()
const createdUserIds: string[] = []

const INDEX_TABLES = ['entity_indexes', 'search_tokens']

function caller(request: APIRequestContext, token: string): Call {
  return async (method, urlPath, options = {}) => {
    const headers: Record<string, string> = { ...(options.headers ?? {}) }
    if (options.lock) headers[LOCK_HEADER] = options.lock
    const response = await apiRequest(request, method, urlPath, { token, data: options.body, headers })
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

async function taskVersion(call: Call, taskId: string): Promise<{ updatedAt: string; status: string }> {
  const detail = await call('GET', `${API}/tasks/${taskId}`)
  expect(detail.status).toBe(200)
  return { updatedAt: detail.body.updatedAt as string, status: detail.body.status as string }
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
    body: { name: `TC-DELIVERY-007 ${label} ${Date.now()}`, inputMode: 'from_brief', targetProfileId: 'react-vite', brief: 'ACL and state transition regression' },
  })
  expect(project.status, 'create project').toBe(201)
  const projectId = project.body.id as string
  createdProjectIds.push(projectId)

  const upload = await uploadAttachmentFixture(request, token, {
    entityId: 'delivery_os:delivery_project',
    recordId: projectId,
    fileName: `tc-delivery-007-${label}.png`,
    mimeType: 'image/png',
    buffer: PNG_1X1,
  })
  createdAttachmentIds.push(upload.id)
  const sha256 = createHash('sha256').update(PNG_1X1).digest('hex')

  const draft = await call('PUT', `${API}/projects`, {
    body: { id: projectId, draftSpec: draftSpecFor(upload.id, sha256) },
    lock: await projectVersion(call, projectId),
  })
  expect(draft.status, 'draft').toBe(200)

  const baseline = await call('POST', `${API}/projects/${projectId}/baselines`, {
    body: { source: 'manual' },
    lock: await projectVersion(call, projectId),
  })
  expect(baseline.status, 'manual baseline').toBe(201)
  const { baselineId, contentHash, version } = baseline.body as { baselineId: string; contentHash: string; version: number }

  for (const kind of ['requirements', 'design']) {
    const decision = await call('POST', `${API}/baselines/${baselineId}/decisions`, {
      body: { kind, verdict: 'approved', subjectHash: contentHash, subjectVersion: version },
      lock: await projectVersion(call, projectId),
    })
    expect(decision.status, `${kind} decision`).toBe(201)
  }

  const task = await call('POST', `${API}/projects/${projectId}/tasks`, {
    body: { source: 'manual', baselineId, title: `Service catalogue ${label}`, acIds: ['AC-001', 'AC-002'], allowedPaths: ['src/**'] },
  })
  expect(task.status, 'task create').toBe(201)
  const ready = await call('PUT', `${API}/tasks`, { body: { id: task.body.id, status: 'ready' }, lock: String(task.body.updatedAt) })
  expect(ready.status, 'task ready').toBe(200)

  return {
    projectId,
    attachmentId: upload.id,
    sha256,
    baselineId,
    contentHash,
    taskId: String(task.body.id),
    taskUpdatedAt: String(ready.body.updatedAt),
  }
}

function reserveBody(commitSha: string) {
  return { mode: 'manual_handoff', baseRevision: { kind: 'git', commitSha } }
}

async function reserveAttempt(call: Call, taskId: string, taskUpdatedAt: string): Promise<string> {
  const key = `tc-delivery-007-${randomUUID()}`
  const response = await call('POST', `${API}/tasks/${taskId}/attempts`, {
    body: reserveBody(COMMIT_A),
    lock: taskUpdatedAt,
    headers: { 'Idempotency-Key': key },
  })
  expect(response.status, `reserve attempt: ${JSON.stringify(response.body)}`).toBe(201)
  return response.body.attemptId as string
}

async function flipAttemptToClaimed(taskId: string, attemptId: string): Promise<void> {
  await sql(
    `update delivery_tasks set execution_attempts = (
       select jsonb_agg(case when entry->>'attemptId' = $2
         then entry || jsonb_build_object('state', 'claimed', 'claimedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'workerRef', 'tc-delivery-007-worker')
         else entry end order by ordinality)
       from jsonb_array_elements(execution_attempts) with ordinality as register(entry, ordinality))
     where id = $1`,
    [taskId, attemptId],
  )
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

type FixtureUser = { userId: string; token: string; organizationId: string; tenantId: string }

async function deleteFixtureUsers(users: FixtureUser[]): Promise<void> {
  const userIds = users.map((user) => user.userId)
  createdUserIds.push(...userIds)
  await withClient(async (client) => {
    if (userIds.length === 0) return
    for (const table of ['sessions', 'user_acls', 'user_roles', 'password_resets']) {
      await client.query(`delete from ${table} where user_id = any($1::uuid[])`, [userIds])
    }
    await client.query('delete from action_logs where resource_id = any($1::text[])', [userIds])
    for (const table of INDEX_TABLES) {
      await client.query(`delete from ${table} where entity_type = 'auth:user' and entity_id = any($1::text[])`, [userIds])
    }
    await client.query('delete from users where id = any($1::uuid[])', [userIds])
  })
}

/**
 * Creates a user in the same tenant+org as the superadmin token's scope,
 * with only the explicitly listed ACL features (no wildcard).
 *
 * The ACL row is written before the first login so no RBAC cache entry predates it.
 */
async function createRestrictedUser(
  request: APIRequestContext,
  superadminToken: string,
  input: { tenantId: string; organizationId: string; features: string[]; label: string },
  created: FixtureUser[],
): Promise<FixtureUser> {
  const email = `tc-delivery-007-${input.label}-${Date.now()}@example.com`
  const userId = await createUserFixture(request, superadminToken, {
    email,
    password: FIXTURE_PASSWORD,
    organizationId: input.organizationId,
    roles: [],
  })
  await setUserAclInDb({ userId, tenantId: input.tenantId, features: input.features, organizations: [input.organizationId] })
  const token = await getAuthToken(request, email, FIXTURE_PASSWORD)
  const user: FixtureUser = { userId, token, organizationId: input.organizationId, tenantId: input.tenantId }
  created.push(user)
  return user
}

test.describe('TC-DELIVERY-007: cancel and reconcile ACL + state transitions', () => {
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

  test('cancel requires delivery_os.attempts.manage: user without that feature gets 403', async ({ request }) => {
    test.slow()
    let token: string | null = null
    let seed: SeededTask | null = null
    const fixtureUsers: FixtureUser[] = []
    try {
      token = await getAuthToken(request, 'admin')
      const superadminToken = await getAuthToken(request, 'superadmin')
      const call = caller(request, token)
      seed = await seedReadyTask(request, token, call, 'acl-cancel')
      const { taskId } = seed

      const attemptId = await reserveAttempt(call, taskId, seed.taskUpdatedAt)
      await flipAttemptToClaimed(taskId, attemptId)

      const ownerScope = getTokenScope(token)
      // Create a user with delivery_os.results.import and delivery_os.projects.view
      // but NOT delivery_os.attempts.manage — cancel should be 403
      const restrictedUser = await createRestrictedUser(
        request,
        superadminToken,
        {
          tenantId: ownerScope.tenantId,
          organizationId: ownerScope.organizationId,
          features: ['delivery_os.projects.view', 'delivery_os.results.import'],
          label: 'no-manage',
        },
        fixtureUsers,
      )
      const restrictedCall = caller(request, restrictedUser.token)

      const lock = (await taskVersion(call, taskId)).updatedAt
      const response = await restrictedCall('POST', `${API}/tasks/${taskId}/attempts/${attemptId}/cancel`, {
        body: { reason: 'TC-DELIVERY-007 ACL test' },
        lock,
      })
      expect(response.status, `cancel without manage feature: ${JSON.stringify(response.body)}`).toBe(403)

      // Verify the attempt state was not changed
      const register = await sql<{ state: string }>(
        `select entry->>'state' as state from delivery_tasks, jsonb_array_elements(execution_attempts) entry where id = $1`,
        [taskId],
      )
      expect(register[0]?.state, 'attempt state must remain claimed after the denied cancel').toBe('claimed')
    } finally {
      await cleanupSeeds(request, token, [seed])
      await deleteFixtureUsers(fixtureUsers).catch(() => undefined)
    }
  })

  test('reconcile requires delivery_os.attempts.reconcile: user without that feature gets 403', async ({ request }) => {
    test.slow()
    let token: string | null = null
    let seed: SeededTask | null = null
    const fixtureUsers: FixtureUser[] = []
    try {
      token = await getAuthToken(request, 'admin')
      const superadminToken = await getAuthToken(request, 'superadmin')
      const call = caller(request, token)
      seed = await seedReadyTask(request, token, call, 'acl-reconcile')
      const { taskId } = seed

      const attemptId = await reserveAttempt(call, taskId, seed.taskUpdatedAt)
      await flipAttemptToClaimed(taskId, attemptId)

      // Cancel the attempt with the admin user first so reconcile has a valid target
      const lock = (await taskVersion(call, taskId)).updatedAt
      const cancelled = await call('POST', `${API}/tasks/${taskId}/attempts/${attemptId}/cancel`, {
        body: { reason: 'TC-DELIVERY-007 setup cancel' },
        lock,
      })
      expect(cancelled.status, `cancel: ${JSON.stringify(cancelled.body)}`).toBe(200)

      const ownerScope = getTokenScope(token)
      // Create a user with delivery_os.attempts.manage but NOT delivery_os.attempts.reconcile
      const restrictedUser = await createRestrictedUser(
        request,
        superadminToken,
        {
          tenantId: ownerScope.tenantId,
          organizationId: ownerScope.organizationId,
          features: ['delivery_os.projects.view', 'delivery_os.attempts.manage'],
          label: 'no-reconcile',
        },
        fixtureUsers,
      )
      const restrictedCall = caller(request, restrictedUser.token)

      const reconcileLock = String(cancelled.body.taskUpdatedAt)
      const response = await restrictedCall('POST', `${API}/tasks/${taskId}/attempts/${attemptId}/reconcile`, {
        body: {
          resolution: 'stopped',
          externalEvidence: { note: 'TC-DELIVERY-007 ACL reconcile test', observedAt: new Date().toISOString() },
        },
        lock: reconcileLock,
      })
      expect(response.status, `reconcile without reconcile feature: ${JSON.stringify(response.body)}`).toBe(403)

      // Verify attempt is still cancel_requested, not closed
      const register = await sql<{ state: string }>(
        `select entry->>'state' as state from delivery_tasks, jsonb_array_elements(execution_attempts) entry where id = $1`,
        [taskId],
      )
      expect(register[0]?.state, 'attempt state must remain cancel_requested after the denied reconcile').toBe('cancel_requested')
    } finally {
      await cleanupSeeds(request, token, [seed])
      await deleteFixtureUsers(fixtureUsers).catch(() => undefined)
    }
  })

  test('late result after cancel: POST results for a cancel_requested attempt answers 409', async ({ request }) => {
    test.slow()
    let token: string | null = null
    let seed: SeededTask | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const call = caller(request, token)
      seed = await seedReadyTask(request, token, call, 'late-result')
      const { taskId } = seed

      const attemptId = await reserveAttempt(call, taskId, seed.taskUpdatedAt)
      await flipAttemptToClaimed(taskId, attemptId)

      const lock = (await taskVersion(call, taskId)).updatedAt
      const cancelled = await call('POST', `${API}/tasks/${taskId}/attempts/${attemptId}/cancel`, {
        body: { reason: 'TC-DELIVERY-007 late result setup' },
        lock,
      })
      expect(cancelled.status, `cancel: ${JSON.stringify(cancelled.body)}`).toBe(200)
      expect(cancelled.body.state).toBe('cancel_requested')

      // Attempt to deliver a result after cancel — the attempt is cancel_requested and not
      // accepting results. The domain must reject this with a 409.
      const taskPackage = await call('GET', `${API}/tasks/${taskId}/package?attemptId=${attemptId}`)
      // Package read may still work on a cancel_requested attempt (read-only endpoint)
      const manifest = taskPackage.status === 200
        ? buildResultManifest(taskPackage.body as TaskPackageV1)
        : { attemptId, schemaVersion: 'delivery.result-manifest/v1', projectId: seed.projectId, taskId, baselineId: seed.baselineId }

      const lateResult = await call('POST', `${API}/tasks/${taskId}/results`, { body: { attemptId, manifest } })
      expect(lateResult.status, `late result after cancel: ${JSON.stringify(lateResult.body)}`).toBe(409)
      // The code is one of: attempt_closed, attempt_cancelled, attempt_not_active
      // — the exact code depends on which guard fires first, all are semantically correct.
      expect(['attempt_closed', 'attempt_cancelled', 'attempt_not_active']).toContain(lateResult.body.code)

      // Verify no evidence row was written
      const evidenceRows = await sql<{ total: string }>(
        `select count(*) as total from delivery_evidence where task_id = $1 and kind = 'result_manifest'`,
        [taskId],
      )
      expect(evidenceRows[0]?.total, 'no evidence row written for the late result').toBe('0')

      // Reconcile so teardown can clean up a task that is not stuck in cancel_requested
      const reconciled = await call('POST', `${API}/tasks/${taskId}/attempts/${attemptId}/reconcile`, {
        body: { resolution: 'stopped', externalEvidence: { note: 'cleanup reconcile', observedAt: new Date().toISOString() } },
        lock: String(cancelled.body.taskUpdatedAt),
      })
      expect(reconciled.status, `reconcile for cleanup: ${JSON.stringify(reconciled.body)}`).toBe(200)
    } finally {
      await cleanupSeeds(request, token, [seed])
    }
  })

  test('unknown resolution: POST reconcile with an invalid resolution value answers 422', async ({ request }) => {
    test.slow()
    let token: string | null = null
    let seed: SeededTask | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const call = caller(request, token)
      seed = await seedReadyTask(request, token, call, 'bad-resolution')
      const { taskId } = seed

      const attemptId = await reserveAttempt(call, taskId, seed.taskUpdatedAt)
      await flipAttemptToClaimed(taskId, attemptId)

      // Cancel first so the attempt is in a reconcilable state
      const lock = (await taskVersion(call, taskId)).updatedAt
      const cancelled = await call('POST', `${API}/tasks/${taskId}/attempts/${attemptId}/cancel`, {
        body: { reason: 'TC-DELIVERY-007 bad resolution setup' },
        lock,
      })
      expect(cancelled.status, `cancel: ${JSON.stringify(cancelled.body)}`).toBe(200)

      const reconcileLock = String(cancelled.body.taskUpdatedAt)
      const response = await call('POST', `${API}/tasks/${taskId}/attempts/${attemptId}/reconcile`, {
        body: {
          resolution: 'invalid_resolution_value',
          externalEvidence: { note: 'TC-DELIVERY-007 bad resolution test', observedAt: new Date().toISOString() },
        },
        lock: reconcileLock,
      })
      // reconcileAttemptSchema uses reconciliationResolutionSchema = z.enum(['not_started','stopped','completed','unknown'])
      // An unrecognised value fails zod parsing and the handler returns 422 (validation_failed → 400)
      // or 400 depending on how parseDeliveryInput surfaces zod errors. Both reflect a client error.
      // The OpenAPI doc lists 400 for validation failures on this route.
      expect([400, 422]).toContain(response.status)
      // The attempt state must remain cancel_requested — the invalid body was rejected
      const register = await sql<{ state: string }>(
        `select entry->>'state' as state from delivery_tasks, jsonb_array_elements(execution_attempts) entry where id = $1`,
        [taskId],
      )
      expect(register[0]?.state, 'attempt state must remain cancel_requested after bad resolution').toBe('cancel_requested')

      // Cleanup: reconcile with a valid resolution
      const cleanup = await call('POST', `${API}/tasks/${taskId}/attempts/${attemptId}/reconcile`, {
        body: { resolution: 'stopped', externalEvidence: { note: 'cleanup reconcile', observedAt: new Date().toISOString() } },
        lock: reconcileLock,
      })
      expect(cleanup.status, `cleanup reconcile: ${JSON.stringify(cleanup.body)}`).toBe(200)
    } finally {
      await cleanupSeeds(request, token, [seed])
    }
  })

  test('completed→verified direct transition is not available via a public HTTP route', async ({ request }) => {
    test.slow()
    let token: string | null = null
    let seed: SeededTask | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const call = caller(request, token)
      seed = await seedReadyTask(request, token, call, 'state-transition')
      const { taskId, projectId, baselineId } = seed

      const attemptId = await reserveAttempt(call, taskId, seed.taskUpdatedAt)
      await flipAttemptToClaimed(taskId, attemptId)

      const taskPackage = await call('GET', `${API}/tasks/${taskId}/package?attemptId=${attemptId}`)
      expect(taskPackage.status, 'package').toBe(200)
      const manifest = buildResultManifest(taskPackage.body as TaskPackageV1)

      // Deliver result to bring task to awaiting_review
      const accepted = await call('POST', `${API}/tasks/${taskId}/results`, { body: { attemptId, manifest } })
      expect(accepted.status, `result: ${JSON.stringify(accepted.body)}`).toBe(201)
      expect(accepted.body.taskStatus).toBe('awaiting_review')

      // Force the task's DB state to `completed` directly to simulate the scenario.
      // NOTE: `completed` is not a real user-settable task status in the domain — it exists
      // in the attempt register state machine, not the task status enum. The task status
      // enum (USER_SETTABLE_TASK_STATUSES) does not include `completed` as a status that a
      // task itself can hold. We therefore verify via the task update route that `completed`
      // is rejected as an invalid transition when forced through PUT /tasks.
      // There is no dedicated HTTP route to set a task to `verified` directly; the only path
      // from `awaiting_review` → `verified` is `POST /projects/:id/evidence` with kind=review
      // and verdict=approved. Any hypothetical route that would skip this gate is not exposed.
      const badTransition = await call('PUT', `${API}/tasks`, {
        body: { id: taskId, status: 'completed' },
        lock: String(accepted.body.taskUpdatedAt),
      })
      // `completed` is not in USER_SETTABLE_TASK_STATUSES — the validator returns 400 or 422.
      // NOTE: if the platform adds `completed` to the settable set in the future, this test
      // documents the constraint that the transition must still go through the review gate,
      // not a direct PUT. Update the assertion to reflect the new expected behavior at that time.
      expect.soft([400, 422]).toContain(badTransition.status)

      // The correct verified path must go through the review evidence endpoint
      const review = await call('POST', `${API}/projects/${projectId}/evidence`, {
        body: {
          baselineId,
          kind: 'review',
          taskId,
          sourceRevision: manifest.resultRevision,
          payload: { verdict: 'approved', summary: 'TC-DELIVERY-007 transition test review', findings: [], reviewer: { kind: 'human' } },
        },
      })
      expect(review.status, `review evidence: ${JSON.stringify(review.body)}`).toBe(201)
      expect(review.body.taskStatus, 'review evidence moves the task to verified').toBe('verified')

      const finalStatus = (await taskVersion(call, taskId)).status
      expect(finalStatus, 'task is verified after the review gate').toBe('verified')
    } finally {
      await cleanupSeeds(request, token, [seed])
    }
  })
})
