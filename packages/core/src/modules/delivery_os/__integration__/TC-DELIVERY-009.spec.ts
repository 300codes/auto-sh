import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { buildResultManifest } from '../lib/fixtures/builders'
import { type TaskPackageV1 } from '../lib/contracts'

/**
 * TC-DELIVERY-009 — open-mercato-module target profile contract.
 *
 * Owner: OSS stream (EXEC-05 PoC adapter, spec .ai/specs/enterprise/2026-09-19-exec-05-om-poc-adapter.md).
 * Proves that the TaskPackage v1 / ResultManifest v1 contracts work for the open-mercato-module
 * target profile — not just react-vite. All five cases run against the real Postgres database.
 *
 * Cases:
 * 1. GET /api/delivery_os/tasks/:id/package?attemptId=:id returns a TaskPackageV1 with
 *    targetProfileId "open-mercato-module" and validationProfile.checks containing
 *    jest-module / typecheck / yarn-audit commandProfileIds.
 * 2. POST /tasks/:id/results accepts a manifest with open-mercato-module checks (DTO does not force React).
 * 3. POST /tasks/:id/results with sourceRevision.kind = "snapshot" for an OM task returns 422 revision_kind_mismatch.
 * 4. Successful import: task transitions to awaiting_review.
 * 5. POST /tasks/:id/results with a manifest omitting required tests returns 422 missing_required_tests.
 *
 * ENVIRONMENT: same requirements as TC-DELIVERY-OSS-001 — app and fixtures share one Postgres database.
 */

const API = '/api/delivery_os'
const LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'
const COMMIT_A = 'a'.repeat(40)

type Json = Record<string, unknown>
type CallResult = { status: number; body: Json }
type Call = (method: string, path: string, options?: { body?: unknown; lock?: string; headers?: Record<string, string> }) => Promise<CallResult>

const createdProjectIds: string[] = []

function caller(request: APIRequestContext, token: string): Call {
  return async (method, path, options = {}) => {
    const headers: Record<string, string> = { ...(options.headers ?? {}) }
    if (options.lock) headers[LOCK_HEADER] = options.lock
    const response = await apiRequest(request, method, path, { token, data: options.body, headers })
    return { status: response.status(), body: (await readJsonSafe<Json>(response)) ?? {} }
  }
}

async function projectVersion(call: Call, projectId: string): Promise<string> {
  const detail = await call('GET', `${API}/projects/${projectId}`)
  expect(detail.status).toBe(200)
  return detail.body.updatedAt as string
}

async function taskVersion(call: Call, taskId: string): Promise<string> {
  const detail = await call('GET', `${API}/tasks/${taskId}`)
  expect(detail.status).toBe(200)
  return detail.body.updatedAt as string
}

async function deleteProjectsInDb(projectIds: string[]): Promise<void> {
  if (projectIds.length === 0) return
  await withClient(async (client) => {
    for (const table of ['delivery_evidence', 'delivery_decisions', 'delivery_tasks', 'delivery_baselines']) {
      await client.query(`delete from ${table} where project_id = any($1::uuid[])`, [projectIds])
    }
    await client.query('delete from delivery_projects where id = any($1::uuid[])', [projectIds])
    await client.query(
      `delete from action_logs where resource_kind like 'delivery_os%' and (resource_id = any($1::text[]) or parent_resource_id = any($1::text[]))`,
      [projectIds],
    )
    for (const table of ['entity_indexes', 'search_tokens']) {
      await client.query(`delete from ${table} where entity_type like 'delivery_os:%' and entity_id = any($1::text[])`, [projectIds])
    }
  })
}

/** Baseline spec for an OM project with the two PoC ACs and their test catalogue entries. */
function omDraftSpec() {
  return {
    requirements: [
      { id: 'REQ-OM-1', title: 'OM target profile contract', description: 'The open-mercato-module profile validates correctly.' },
    ],
    acceptanceCriteria: [
      { id: 'AC-OM-001', requirementId: 'REQ-OM-1', description: 'The profile passes schema validation with a non-empty catalogue.' },
      { id: 'AC-OM-002', requirementId: 'REQ-OM-1', description: 'assertRevisionKind returns ok:true for git and ok:false for snapshot.' },
    ],
    screens: [],
    tokens: {},
    architectureSummary: null,
    planSummary: null,
    acTestMap: {
      'AC-OM-001': ['open-mercato-module AC-OM-001: profile validates against schema'],
      'AC-OM-002': ['open-mercato-module AC-OM-002: OM profile uses git revision'],
    },
    manualChecks: {},
    declaredTests: [
      {
        testId: 'open-mercato-module AC-OM-001: profile validates against schema',
        file: 'packages/core/src/modules/delivery_os/lib/__tests__/targetProfiles.test.ts',
      },
      {
        testId: 'open-mercato-module AC-OM-002: OM profile uses git revision',
        file: 'packages/core/src/modules/delivery_os/lib/__tests__/targetProfiles.test.ts',
      },
    ],
    attachments: [],
  }
}

type SeededOmTask = {
  projectId: string
  baselineId: string
  taskId: string
  attemptId: string
  packageUrl: string
}

async function seedOmReadyTask(call: Call, label: string): Promise<SeededOmTask> {
  const project = await call('POST', `${API}/projects`, {
    body: {
      name: `TC-DELIVERY-009 ${label} ${Date.now()}`,
      inputMode: 'from_brief',
      targetProfileId: 'open-mercato-module',
      brief: 'Validate open-mercato-module profile end-to-end (PoC)',
    },
  })
  expect(project.status, 'create OM project').toBe(201)
  const projectId = project.body.id as string
  createdProjectIds.push(projectId)

  const draft = await call('PUT', `${API}/projects`, {
    body: { id: projectId, draftSpec: omDraftSpec() },
    lock: await projectVersion(call, projectId),
  })
  expect(draft.status, 'PUT draftSpec').toBe(200)

  const baseline = await call('POST', `${API}/projects/${projectId}/baselines`, {
    body: { source: 'manual' },
    lock: await projectVersion(call, projectId),
  })
  expect(baseline.status, 'freeze baseline').toBe(201)
  const { baselineId, contentHash, version } = baseline.body as { baselineId: string; contentHash: string; version: number }

  for (const kind of ['requirements', 'design']) {
    const decision = await call('POST', `${API}/baselines/${baselineId}/decisions`, {
      body: { kind, verdict: 'approved', subjectHash: contentHash, subjectVersion: version },
      lock: await projectVersion(call, projectId),
    })
    expect(decision.status, `${kind} decision`).toBe(201)
  }

  const task = await call('POST', `${API}/projects/${projectId}/tasks`, {
    body: {
      source: 'manual',
      baselineId,
      title: `${label} task`,
      acIds: ['AC-OM-001', 'AC-OM-002'],
      allowedPaths: ['packages/core/src/modules/delivery_os/lib/**'],
    },
  })
  expect(task.status, 'create task').toBe(201)
  const taskId = String(task.body.id)

  const ready = await call('PUT', `${API}/tasks`, {
    body: { id: taskId, status: 'ready' },
    lock: String(task.body.updatedAt),
  })
  expect(ready.status, 'move task to ready').toBe(200)

  const idempotencyKey = `tc-009-${label}-${randomUUID()}`
  const attempt = await call('POST', `${API}/tasks/${taskId}/attempts`, {
    body: { mode: 'manual_handoff', baseRevision: { kind: 'git', commitSha: COMMIT_A } },
    lock: String(ready.body.updatedAt),
    headers: { 'Idempotency-Key': idempotencyKey },
  })
  expect(attempt.status, 'reserve attempt').toBe(201)

  return {
    projectId,
    baselineId,
    taskId,
    attemptId: String(attempt.body.attemptId),
    packageUrl: `${API}/tasks/${taskId}/package?attemptId=${attempt.body.attemptId}`,
  }
}

test.describe('TC-DELIVERY-009: open-mercato-module target profile contract', () => {
  let call: Call
  let seeded: SeededOmTask

  test.beforeAll(async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    call = caller(request, token)
    seeded = await seedOmReadyTask(call, 'main')
  })

  test.afterAll(async () => {
    await deleteProjectsInDb(createdProjectIds).catch(() => undefined)
  })

  test('case 1 — package endpoint returns open-mercato-module TaskPackageV1', async () => {
    const result = await call('GET', seeded.packageUrl)
    expect(result.status).toBe(200)
    const pkg = result.body as unknown as TaskPackageV1
    expect(pkg.targetProfileId).toBe('open-mercato-module')
    expect(pkg.targetProfileVersion).toBe(1)
    expect(pkg.baseRevision.kind).toBe('git')
    const commandProfiles = pkg.validationProfile.checks.map((c) => c.commandProfileId)
    expect(commandProfiles).toContain('jest-module')
    expect(commandProfiles).toContain('typecheck')
    expect(commandProfiles).toContain('yarn-audit')
    expect(commandProfiles).not.toContain('vite-build')
    expect(commandProfiles).not.toContain('npm-audit')
  })

  test('case 2 — DTO does not force React: OM manifest is accepted', async () => {
    const pkgResp = await call('GET', seeded.packageUrl)
    expect(pkgResp.status).toBe(200)
    const pkg = pkgResp.body as unknown as TaskPackageV1
    const manifest = buildResultManifest(pkg)
    const result = await call('POST', `${API}/tasks/${seeded.taskId}/results`, {
      body: { attemptId: seeded.attemptId, manifest },
    })
    expect(result.status).toBe(200)
    expect(result.body.evidenceId).toBeTruthy()
  })

  test('case 3 — snapshot revision for OM task returns 422 revision_kind_mismatch', async () => {
    // Seed a fresh task for this case since case 2 may have consumed the main attempt
    const fresh = await seedOmReadyTask(call, 'case3')
    const pkgResp = await call('GET', fresh.packageUrl)
    expect(pkgResp.status).toBe(200)
    const pkg = pkgResp.body as unknown as TaskPackageV1
    const snapshotRevision = { kind: 'snapshot' as const, contentHash: 'a'.repeat(64), externalWorkspaceId: 'om-ws-1' }
    const manifest = buildResultManifest(pkg, {
      baseRevision: snapshotRevision,
      resultRevision: snapshotRevision,
      baseCommit: undefined,
      resultCommit: undefined,
    })
    const result = await call('POST', `${API}/tasks/${fresh.taskId}/results`, {
      body: { attemptId: fresh.attemptId, manifest },
    })
    expect(result.status).toBe(422)
    expect(result.body.code).toBe('revision_kind_mismatch')
  })

  test('case 4 — successful OM manifest import transitions task to awaiting_review', async () => {
    const fresh = await seedOmReadyTask(call, 'case4')
    const pkgResp = await call('GET', fresh.packageUrl)
    expect(pkgResp.status).toBe(200)
    const pkg = pkgResp.body as unknown as TaskPackageV1
    const manifest = buildResultManifest(pkg)
    const importResult = await call('POST', `${API}/tasks/${fresh.taskId}/results`, {
      body: { attemptId: fresh.attemptId, manifest },
    })
    expect(importResult.status).toBe(200)
    expect(importResult.body.evidenceId).toBeTruthy()
    const taskDetail = await call('GET', `${API}/tasks/${fresh.taskId}`)
    expect(taskDetail.status).toBe(200)
    expect(taskDetail.body.status).toBe('awaiting_review')
  })

  test('case 5 — manifest omitting required tests returns 422 missing_required_tests', async () => {
    const fresh = await seedOmReadyTask(call, 'case5')
    const pkgResp = await call('GET', fresh.packageUrl)
    expect(pkgResp.status).toBe(200)
    const pkg = pkgResp.body as unknown as TaskPackageV1
    // Strip all test checks so ACs have no required tests present
    const fullManifest = buildResultManifest(pkg)
    const manifest = { ...fullManifest, checks: fullManifest.checks.filter((c) => c.acIds.length === 0) }
    const result = await call('POST', `${API}/tasks/${fresh.taskId}/results`, {
      body: { attemptId: fresh.attemptId, manifest },
    })
    expect(result.status).toBe(422)
    expect(result.body.code).toBe('missing_required_tests')
  })
})
