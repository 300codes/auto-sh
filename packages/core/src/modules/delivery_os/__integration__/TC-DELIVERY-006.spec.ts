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
 * TC-DELIVERY-006: Evidence recording edge cases.
 *
 * Covers cases that the basic OSS-001 flow does not: duplicate result idempotency, hash
 * conflict (same attempt, different manifest), unknown baselineId, cancelled-attempt guard,
 * foreign-tenant isolation, and tenantId field ignored in the body.
 *
 * ENVIRONMENT: shares the same app+database as TC-DELIVERY-OSS-001. All seeded projects are
 * hard-deleted in afterAll; attachment cleanup follows. Fixture users (foreign tenant) are
 * also removed. Run with the integration harness: `yarn test:integration`.
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
    body: { name: `TC-DELIVERY-006 ${label} ${Date.now()}`, inputMode: 'from_brief', targetProfileId: 'react-vite', brief: 'Edge-case evidence regression' },
  })
  expect(project.status, 'create project').toBe(201)
  const projectId = project.body.id as string
  createdProjectIds.push(projectId)

  const upload = await uploadAttachmentFixture(request, token, {
    entityId: 'delivery_os:delivery_project',
    recordId: projectId,
    fileName: `tc-delivery-006-${label}.png`,
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
  const key = `tc-delivery-006-${randomUUID()}`
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
         then entry || jsonb_build_object('state', 'claimed', 'claimedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'workerRef', 'tc-delivery-006-worker')
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

test.describe('TC-DELIVERY-006: evidence recording edge cases', () => {
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

  test('duplicate result idempotency: same attemptId and identical manifest hash answers 200 duplicate:true with the same evidenceId and writes no new row', async ({
    request,
  }) => {
    test.slow()
    let token: string | null = null
    let seed: SeededTask | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const call = caller(request, token)
      seed = await seedReadyTask(request, token, call, 'dup-idem')
      const { taskId, projectId, baselineId } = seed

      const attemptId = await reserveAttempt(call, taskId, seed.taskUpdatedAt)
      await flipAttemptToClaimed(taskId, attemptId)

      const taskPackage = await call('GET', `${API}/tasks/${taskId}/package?attemptId=${attemptId}`)
      expect(taskPackage.status, 'package').toBe(200)
      const manifest = buildResultManifest(taskPackage.body as TaskPackageV1, { changedPaths: ['src/ServiceList.tsx'] })

      const first = await call('POST', `${API}/tasks/${taskId}/results`, { body: { attemptId, manifest } })
      expect(first.status, `first result: ${JSON.stringify(first.body)}`).toBe(201)
      expect(first.body).toMatchObject({ duplicate: false, taskStatus: 'awaiting_review' })
      const evidenceId = first.body.evidenceId as string
      expect(typeof evidenceId).toBe('string')

      const second = await call('POST', `${API}/tasks/${taskId}/results`, { body: { attemptId, manifest } })
      expect(second.status, `duplicate result: ${JSON.stringify(second.body)}`).toBe(200)
      expect(second.body).toMatchObject({ duplicate: true, evidenceId })

      const resultRows = await sql<{ total: string }>(
        `select count(*) as total from delivery_evidence where task_id = $1 and kind = 'result_manifest'`,
        [taskId],
      )
      expect(resultRows[0]?.total, 'exactly one result_manifest row despite two POSTs').toBe('1')

      // cleanup: record a review to bring the task to verified so teardown is clean
      await call('POST', `${API}/projects/${projectId}/evidence`, {
        body: {
          baselineId,
          kind: 'review',
          taskId,
          sourceRevision: manifest.resultRevision,
          payload: { verdict: 'approved', summary: 'Duplicate idempotency test review', findings: [], reviewer: { kind: 'human' } },
        },
      })
    } finally {
      await cleanupSeeds(request, token, [seed])
    }
  })

  test('hash conflict: same attemptId but a different manifest hash answers 409 result_conflict', async ({ request }) => {
    test.slow()
    let token: string | null = null
    let seed: SeededTask | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const call = caller(request, token)
      seed = await seedReadyTask(request, token, call, 'hash-conflict')
      const { taskId } = seed

      const attemptId = await reserveAttempt(call, taskId, seed.taskUpdatedAt)
      await flipAttemptToClaimed(taskId, attemptId)

      const taskPackage = await call('GET', `${API}/tasks/${taskId}/package?attemptId=${attemptId}`)
      expect(taskPackage.status, 'package').toBe(200)
      const manifestA = buildResultManifest(taskPackage.body as TaskPackageV1, { changedPaths: ['src/ServiceList.tsx'] })
      const manifestB = buildResultManifest(taskPackage.body as TaskPackageV1, { changedPaths: ['src/OtherFile.tsx'] })
      // Ensure the manifests differ so the canonical hash differs
      expect(JSON.stringify(manifestA)).not.toBe(JSON.stringify(manifestB))

      const first = await call('POST', `${API}/tasks/${taskId}/results`, { body: { attemptId, manifest: manifestA } })
      expect(first.status, `first result: ${JSON.stringify(first.body)}`).toBe(201)

      const conflict = await call('POST', `${API}/tasks/${taskId}/results`, { body: { attemptId, manifest: manifestB } })
      expect(conflict.status, `hash conflict: ${JSON.stringify(conflict.body)}`).toBe(409)
      expect(conflict.body.code).toBe('result_conflict')

      const resultRows = await sql<{ total: string }>(
        `select count(*) as total from delivery_evidence where task_id = $1 and kind = 'result_manifest'`,
        [taskId],
      )
      expect(resultRows[0]?.total, 'no second evidence row was written on hash conflict').toBe('1')
    } finally {
      await cleanupSeeds(request, token, [seed])
    }
  })

  test('unknown baselineId: POST evidence with a made-up baselineId answers 404 or 422', async ({ request }) => {
    test.slow()
    let token: string | null = null
    let seed: SeededTask | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const call = caller(request, token)
      seed = await seedReadyTask(request, token, call, 'unknown-baseline')
      const { taskId, projectId } = seed

      const attemptId = await reserveAttempt(call, taskId, seed.taskUpdatedAt)
      await flipAttemptToClaimed(taskId, attemptId)

      const taskPackage = await call('GET', `${API}/tasks/${taskId}/package?attemptId=${attemptId}`)
      expect(taskPackage.status, 'package').toBe(200)
      const manifest = buildResultManifest(taskPackage.body as TaskPackageV1)
      const fakeBaselineId = randomUUID()

      const response = await call('POST', `${API}/projects/${projectId}/evidence`, {
        body: {
          baselineId: fakeBaselineId,
          kind: 'review',
          taskId,
          sourceRevision: manifest.resultRevision,
          payload: { verdict: 'approved', summary: 'Unknown baseline test', findings: [], reviewer: { kind: 'human' } },
        },
      })
      // The route resolves the project first and then validates the baselineId ownership.
      // Depending on validation order the domain may return 404 (not found in scope)
      // or 422 (foreign_reference / baseline_not_active). Both are acceptable — what
      // matters is that no evidence row is created.
      expect.soft([404, 422]).toContain(response.status)
      const evidenceRows = await sql<{ total: string }>(
        `select count(*) as total from delivery_evidence where project_id = $1 and baseline_id = $2`,
        [projectId, fakeBaselineId],
      )
      expect(evidenceRows[0]?.total, 'no evidence row written for the unknown baseline').toBe('0')
    } finally {
      await cleanupSeeds(request, token, [seed])
    }
  })

  test('cancelled attempt: POST results for a cancelled attempt answers 409 attempt_closed or attempt_cancelled', async ({ request }) => {
    test.slow()
    let token: string | null = null
    let seed: SeededTask | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const call = caller(request, token)
      seed = await seedReadyTask(request, token, call, 'cancelled')
      const { taskId } = seed

      const attemptId = await reserveAttempt(call, taskId, seed.taskUpdatedAt)
      await flipAttemptToClaimed(taskId, attemptId)

      const lock = (await taskVersion(call, taskId)).updatedAt
      const cancelled = await call('POST', `${API}/tasks/${taskId}/attempts/${attemptId}/cancel`, {
        body: { reason: 'TC-DELIVERY-006 cancelled attempt test' },
        lock,
      })
      expect(cancelled.status, `cancel: ${JSON.stringify(cancelled.body)}`).toBe(200)
      expect(cancelled.body.state).toBe('cancel_requested')

      // Now attempt to deliver a result for the cancelled attempt. The attempt is
      // cancel_requested (not yet closed via reconcile), so the domain treats it as
      // non-accepting. The expected code is attempt_closed or attempt_cancelled.
      const taskPackage = await call('GET', `${API}/tasks/${taskId}/package?attemptId=${attemptId}`)
      // Package read on a cancel_requested attempt may still succeed (read-only)
      const manifest = taskPackage.status === 200
        ? buildResultManifest(taskPackage.body as TaskPackageV1)
        : { attemptId, schemaVersion: 'delivery.result-manifest/v1', projectId: seed.projectId, taskId, baselineId: seed.baselineId }

      const lateResult = await call('POST', `${API}/tasks/${taskId}/results`, { body: { attemptId, manifest } })
      expect(lateResult.status, `late result after cancel: ${JSON.stringify(lateResult.body)}`).toBe(409)
      expect(['attempt_closed', 'attempt_cancelled', 'attempt_not_active']).toContain(lateResult.body.code)
    } finally {
      await cleanupSeeds(request, token, [seed])
    }
  })

  test('foreign-tenant attempt: POST results using org B token for an attempt owned by org A answers 404', async ({ request }) => {
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
      seed = await seedReadyTask(request, token, call, 'foreign-tenant')
      const { taskId } = seed

      const attemptId = await reserveAttempt(call, taskId, seed.taskUpdatedAt)
      await flipAttemptToClaimed(taskId, attemptId)

      const taskPackage = await call('GET', `${API}/tasks/${taskId}/package?attemptId=${attemptId}`)
      expect(taskPackage.status, 'package').toBe(200)
      const manifest = buildResultManifest(taskPackage.body as TaskPackageV1)

      // Create a user in a different tenant/org
      const ownerScope = getTokenScope(token)
      const foreignTenant = (
        await sql<{ id: string }>(
          `insert into tenants (id, name, is_active, created_at, updated_at) values (gen_random_uuid(), $1, true, now(), now()) returning id`,
          [`TC-DELIVERY-006 tenant foreign ${Date.now()}`],
        )
      )[0].id
      tenantIds.push(foreignTenant)
      const foreignOrg = await createOrganizationInDb({ name: `TC-DELIVERY-006 org foreign ${Date.now()}`, tenantId: foreignTenant })
      organizationIds.push(foreignOrg)

      const email = `tc-delivery-006-foreign-${Date.now()}@example.com`
      const userId = await createUserFixture(request, superadminToken, {
        email,
        password: FOREIGN_PASSWORD,
        organizationId: foreignOrg,
        roles: [],
      })
      const foreignUser: ForeignUser = { userId, token: '', organizationId: foreignOrg, tenantId: foreignTenant }
      foreignUsers.push(foreignUser)
      await setUserAclInDb({ userId, tenantId: foreignTenant, features: ['delivery_os.*'], organizations: [foreignOrg] })
      foreignUser.token = await getAuthToken(request, email, FOREIGN_PASSWORD)
      expect(getTokenScope(foreignUser.token).organizationId).toBe(foreignOrg)
      expect(getTokenScope(foreignUser.token).tenantId).not.toBe(ownerScope.tenantId)

      const foreignCall = caller(request, foreignUser.token)

      // POST results: the task is scoped to the owner's tenant; the foreign user must get 404
      const response = await foreignCall('POST', `${API}/tasks/${taskId}/results`, {
        body: { attemptId, manifest },
      })
      expect(response.status, `foreign tenant result POST: ${JSON.stringify(response.body)}`).toBe(404)
      expect(JSON.stringify(response.body), 'response must not leak the owner taskId').not.toContain(taskId)

      // Verify no evidence row was written
      const evidenceRows = await sql<{ total: string }>(
        `select count(*) as total from delivery_evidence where task_id = $1`,
        [taskId],
      )
      expect(evidenceRows[0]?.total, 'no evidence written via foreign tenant call').toBe('0')
    } finally {
      await cleanupSeeds(request, token, [seed])
      await deleteForeignFixtures(foreignUsers, organizationIds, tenantIds).catch(() => undefined)
    }
  })

  test('tenantId field in body is ignored: evidence is scoped to the auth context tenant, not the provided field', async ({ request }) => {
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
      seed = await seedReadyTask(request, token, call, 'tenant-field')
      const { taskId, projectId, baselineId } = seed

      const attemptId = await reserveAttempt(call, taskId, seed.taskUpdatedAt)
      await flipAttemptToClaimed(taskId, attemptId)

      const taskPackage = await call('GET', `${API}/tasks/${taskId}/package?attemptId=${attemptId}`)
      expect(taskPackage.status, 'package').toBe(200)
      const manifest = buildResultManifest(taskPackage.body as TaskPackageV1)

      // Create a second tenant to inject as spoofed tenantId
      const ownerScope = getTokenScope(token)
      const spoofTenant = (
        await sql<{ id: string }>(
          `insert into tenants (id, name, is_active, created_at, updated_at) values (gen_random_uuid(), $1, true, now(), now()) returning id`,
          [`TC-DELIVERY-006 tenant spoof ${Date.now()}`],
        )
      )[0].id
      tenantIds.push(spoofTenant)
      const spoofOrg = await createOrganizationInDb({ name: `TC-DELIVERY-006 org spoof ${Date.now()}`, tenantId: spoofTenant })
      organizationIds.push(spoofOrg)

      // POST results with a tenantId field injected into the manifest body. The field is
      // not part of the ResultManifest v1 schema and must be stripped/ignored by the
      // domain. The evidence row must be scoped to ownerScope.tenantId.
      // NOTE: The route handler validates the body via resultsImportSchema; extra fields
      // on the manifest are allowed (it is a z.record) but routing context carries the
      // auth-derived tenantId, not whatever is in the request body.
      const response = await call('POST', `${API}/tasks/${taskId}/results`, {
        body: {
          attemptId,
          manifest: { ...manifest, tenantId: spoofTenant },
        },
      })
      expect(response.status, `result with injected tenantId: ${JSON.stringify(response.body)}`).toBe(201)

      const evidenceRows = await sql<{ tenant_id: string; total: string }>(
        `select tenant_id::text, count(*) as total from delivery_evidence where task_id = $1 and kind = 'result_manifest' group by tenant_id`,
        [taskId],
      )
      expect(evidenceRows).toHaveLength(1)
      expect(evidenceRows[0]?.tenant_id, 'evidence tenant_id must match auth context, not the spoofed body field').toBe(ownerScope.tenantId)
      expect(evidenceRows[0]?.tenant_id).not.toBe(spoofTenant)

      // Cleanup: verify no evidence was written in the spoofed tenant
      const spoofRows = await sql<{ total: string }>(
        `select count(*) as total from delivery_evidence where tenant_id = $1`,
        [spoofTenant],
      )
      expect(spoofRows[0]?.total, 'no evidence row in the spoofed tenant').toBe('0')

      // Record a review so teardown cleanup is complete
      await call('POST', `${API}/projects/${projectId}/evidence`, {
        body: {
          baselineId,
          kind: 'review',
          taskId,
          sourceRevision: manifest.resultRevision,
          payload: { verdict: 'approved', summary: 'Tenant field ignored test review', findings: [], reviewer: { kind: 'human' } },
        },
      })
    } finally {
      await cleanupSeeds(request, token, [seed])
      await deleteForeignFixtures(foreignUsers, organizationIds, tenantIds).catch(() => undefined)
    }
  })
})
