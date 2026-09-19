import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { uploadAttachmentFixture, deleteAttachmentIfExists } from '@open-mercato/core/helpers/integration/attachmentsFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { buildResultManifest } from '../lib/fixtures/builders'
import { type BaselineContentV1, type TaskPackageV1 } from '../lib/contracts'

/**
 * TC-DELIVERY-008 — Evidence discriminator validation and the review gate.
 *
 * Owner: OSS stream. This spec exercises the `POST /api/delivery_os/projects/:id/evidence` route
 * against the real database, covering:
 *
 * 1. Unknown `kind` discriminator → 422 with `unsupported_evidence_kind`.
 * 2. Missing required per-discriminator fields:
 *    - `screenshot` without the required `payload.attachmentId`/`sha256`/`name`/`viewport`/`capturedAt` → 400.
 *    - `scan` without `payload.checkId`/`scanner`/`status`/`rawReportHash` → 400.
 * 3. Declared SHA-256 hash that doesn't match the real attachment content → 422 (`hash_mismatch`).
 * 4. Partial AC coverage keeps task in `reviewing` (i.e. `awaiting_review`) — approving a review that covers
 *    only one of the task's ACs must not transition the task to `verified`; `missing_required_tests` is
 *    returned instead.
 * 5. Deploy gate: POSTing a deploy decision when the report is not publishable (no evidence yet) returns
 *    422 `report_not_green`. The deploy-decisions route exists at
 *    `POST /api/delivery_os/projects/:id/deploy-decisions` and guards behind `delivery_os.deploy.approve`.
 *
 * ENVIRONMENT: same requirements as TC-DELIVERY-OSS-001 — app + fixtures must share one Postgres database.
 * All rows created by this spec are hard-deleted in `afterAll`; `beforeAll` / per-test `finally` blocks
 * handle failures mid-seeding.
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

type Json = Record<string, unknown>
type CallResult = { status: number; body: Json }
type Call = (method: string, path: string, options?: { body?: unknown; lock?: string; headers?: Record<string, string> }) => Promise<CallResult>

const createdProjectIds: string[] = []
const createdAttachmentIds: string[] = []

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

async function taskVersion(call: Call, taskId: string): Promise<{ updatedAt: string; status: string }> {
  const detail = await call('GET', `${API}/tasks/${taskId}`)
  expect(detail.status).toBe(200)
  return { updatedAt: detail.body.updatedAt as string, status: detail.body.status as string }
}

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

type SeededTask = {
  projectId: string
  attachmentId: string
  sha256: string
  baselineId: string
  contentHash: string
  taskId: string
  taskUpdatedAt: string
}

/**
 * Replicates the seedReadyTask helper from TC-DELIVERY-OSS-001 so this spec is self-contained.
 * Seeds: project → attachment → draft spec → baseline → requirements + design decisions → task → ready.
 */
async function seedReadyTask(request: APIRequestContext, token: string, call: Call, label: string): Promise<SeededTask> {
  const project = await call('POST', `${API}/projects`, {
    body: { name: `TC-DELIVERY-008 ${label} ${Date.now()}`, inputMode: 'from_brief', targetProfileId: 'react-vite', brief: 'Evidence gate regression' },
  })
  expect(project.status, 'create project').toBe(201)
  const projectId = project.body.id as string
  createdProjectIds.push(projectId)

  const upload = await uploadAttachmentFixture(request, token, {
    entityId: 'delivery_os:delivery_project',
    recordId: projectId,
    fileName: `tc-delivery-008-${label}.png`,
    mimeType: 'image/png',
    buffer: PNG_1X1,
  })
  createdAttachmentIds.push(upload.id)
  const sha256 = createHash('sha256').update(PNG_1X1).digest('hex')

  const draft = await call('PUT', `${API}/projects`, {
    body: { id: projectId, draftSpec: draftSpecFor(upload.id, sha256) },
    lock: await projectVersion(call, projectId),
  })
  expect(draft.status, 'draft spec').toBe(200)

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
    body: { source: 'manual', baselineId, title: `Evidence gate task ${label}`, acIds: ['AC-001', 'AC-002'], allowedPaths: ['src/**'] },
  })
  expect(task.status, 'task create').toBe(201)
  const ready = await call('PUT', `${API}/tasks`, { body: { id: task.body.id, status: 'ready' }, lock: String(task.body.updatedAt) })
  expect(ready.status, 'task ready').toBe(200)

  return { projectId, attachmentId: upload.id, sha256, baselineId, contentHash, taskId: String(task.body.id), taskUpdatedAt: String(ready.body.updatedAt) }
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

async function cleanupSeed(request: APIRequestContext, token: string | null, seed: SeededTask | null): Promise<void> {
  if (!seed) return
  await deleteProjectsInDb([seed.projectId]).catch(() => undefined)
  await deleteAttachmentIfExists(request, token, seed.attachmentId)
}

test.describe('TC-DELIVERY-008: evidence discriminator validation and review gate', () => {
  test.afterAll(async ({ request }) => {
    await deleteProjectsInDb(createdProjectIds)
    const token = await getAuthToken(request, 'admin').catch(() => null)
    for (const attachmentId of createdAttachmentIds) {
      await deleteAttachmentIfExists(request, token, attachmentId)
    }
  })

  test('unknown discriminator kind → 422 unsupported_evidence_kind', async ({ request }) => {
    let token: string | null = null
    let seed: SeededTask | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const call = caller(request, token)
      seed = await seedReadyTask(request, token, call, 'unknown-kind')
      const { projectId, baselineId } = seed

      const result = await call('POST', `${API}/projects/${projectId}/evidence`, {
        body: {
          kind: 'invalid_kind_value',
          baselineId,
          payload: { whatever: true },
        },
      })
      expect(result.status, `answered ${JSON.stringify(result.body)}`).toBe(422)
      expect(result.body.code).toBe('unsupported_evidence_kind')
      const details = result.body.details as Array<{ path?: string; code: string }>
      expect(details.some((detail) => detail.path === 'kind')).toBe(true)
    } finally {
      await cleanupSeed(request, token, seed)
    }
  })

  test('screenshot kind without required payload fields → 400 validation_failed', async ({ request }) => {
    let token: string | null = null
    let seed: SeededTask | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const call = caller(request, token)
      seed = await seedReadyTask(request, token, call, 'screenshot-missing-fields')
      const { projectId, baselineId } = seed

      // Omit the required `payload.attachmentId`, `sha256`, `name`, `viewport`, `capturedAt` fields.
      const result = await call('POST', `${API}/projects/${projectId}/evidence`, {
        body: {
          kind: 'screenshot',
          baselineId,
          payload: {},
        },
      })
      expect(result.status, `answered ${JSON.stringify(result.body)}`).toBe(400)
      expect(result.body.code).toBe('validation_failed')
    } finally {
      await cleanupSeed(request, token, seed)
    }
  })

  test('scan kind without required AC mapping fields → 400 validation_failed', async ({ request }) => {
    let token: string | null = null
    let seed: SeededTask | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const call = caller(request, token)
      seed = await seedReadyTask(request, token, call, 'scan-missing-fields')
      const { projectId, baselineId } = seed

      // Omit the required `payload.checkId`, `scanner`, `status`, `rawReportHash` fields.
      // Also omit the required `sourceRevision` (REVISION_REQUIRED_KINDS includes 'scan').
      const result = await call('POST', `${API}/projects/${projectId}/evidence`, {
        body: {
          kind: 'scan',
          baselineId,
          payload: {},
        },
      })
      expect(result.status, `answered ${JSON.stringify(result.body)}`).toBe(400)
      expect(result.body.code).toBe('validation_failed')
    } finally {
      await cleanupSeed(request, token, seed)
    }
  })

  test('scan kind with sourceRevision missing → 400 (sourceRevision required for scan)', async ({ request }) => {
    let token: string | null = null
    let seed: SeededTask | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const call = caller(request, token)
      seed = await seedReadyTask(request, token, call, 'scan-no-revision')
      const { projectId, baselineId } = seed

      // Provide a structurally valid scan payload but omit sourceRevision.
      // The superRefine on recordEvidenceSchema adds a validation_failed issue when
      // sourceRevision is absent for 'scan' kind.
      const result = await call('POST', `${API}/projects/${projectId}/evidence`, {
        body: {
          kind: 'scan',
          baselineId,
          payload: {
            checkId: 'dependency-audit',
            scanner: 'npm audit',
            status: 'passed',
            rawReportHash: 'd'.repeat(64),
          },
        },
      })
      expect(result.status, `answered ${JSON.stringify(result.body)}`).toBe(400)
      expect(result.body.code).toBe('validation_failed')
      const details = result.body.details as Array<{ path?: string }>
      expect(details.some((detail) => detail.path === 'sourceRevision')).toBe(true)
    } finally {
      await cleanupSeed(request, token, seed)
    }
  })

  test('screenshot evidence with declared sha256 not matching attachment content → 422 hash_mismatch', async ({ request }) => {
    /**
     * The evidence route resolves the attachment and verifies the declared sha256 against the stored
     * file digest. Posting a sha256 that differs from the actual attachment content returns
     * 422 `hash_mismatch`.
     */
    let token: string | null = null
    let seed: SeededTask | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const call = caller(request, token)
      seed = await seedReadyTask(request, token, call, 'hash-mismatch')
      const { projectId, baselineId, attachmentId } = seed

      const wrongHash = 'f'.repeat(64)

      const result = await call('POST', `${API}/projects/${projectId}/evidence`, {
        body: {
          kind: 'screenshot',
          baselineId,
          payload: {
            attachmentId,
            sha256: wrongHash,
            name: 'Mismatched screenshot',
            viewport: { width: 1280, height: 800 },
            capturedAt: new Date().toISOString(),
          },
        },
      })
      // The route rejects when the hash doesn't match the stored attachment content.
      expect(result.status, `answered ${JSON.stringify(result.body)}`).toBe(422)
      expect(result.body.code).toBe('hash_mismatch')
    } finally {
      await cleanupSeed(request, token, seed)
    }
  })

  test('partial AC coverage keeps task in awaiting_review after result and review', async ({ request }) => {
    test.slow()
    let token: string | null = null
    let seed: SeededTask | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const call = caller(request, token)
      seed = await seedReadyTask(request, token, call, 'partial-ac')
      const { projectId, baselineId, taskId, taskUpdatedAt } = seed

      // Reserve an attempt on the task.
      const reserveKey = `tc-delivery-008-partial-${randomUUID()}`
      const reserved = await call('POST', `${API}/tasks/${taskId}/attempts`, {
        body: { mode: 'manual_handoff', baseRevision: { kind: 'git', commitSha: COMMIT_A } },
        lock: taskUpdatedAt,
        headers: { 'Idempotency-Key': reserveKey },
      })
      expect(reserved.status, `reserve answered ${JSON.stringify(reserved.body)}`).toBe(201)
      const attemptId = reserved.body.attemptId as string

      // Fetch the task package to build a structurally valid manifest.
      const taskPackage = await call('GET', `${API}/tasks/${taskId}/package?attemptId=${attemptId}`)
      expect(taskPackage.status, 'package').toBe(200)

      const manifest = buildResultManifest(taskPackage.body as TaskPackageV1, { changedPaths: ['src/ServiceList.tsx'] })
      expect(manifest.checks.some((check) => check.acIds.includes('AC-002'))).toBe(true)
      manifest.checks = manifest.checks.filter((check) => !check.acIds.includes('AC-002'))
      expect(manifest.checks.some((check) => check.acIds.includes('AC-001'))).toBe(true)

      const accepted = await call('POST', `${API}/tasks/${taskId}/results`, { body: { attemptId, manifest } })
      expect(accepted.status, `result answered ${JSON.stringify(accepted.body)}`).toBe(201)
      expect(accepted.body.taskStatus).toBe('awaiting_review')

      const review = await call('POST', `${API}/projects/${projectId}/evidence`, {
        body: {
          baselineId,
          kind: 'review',
          taskId,
          attemptId,
          sourceRevision: manifest.resultRevision,
          payload: {
            verdict: 'approved',
            summary: 'Only partial AC coverage verified',
            findings: [],
            reviewer: { kind: 'human' },
          },
        },
      })

      expect(review.status, `review answered ${JSON.stringify(review.body)}`).toBe(422)
      expect(review.body.code).toBe('missing_required_tests')
      const taskAfter = await taskVersion(call, taskId)
      expect(taskAfter.status).toBe('awaiting_review')
    } finally {
      await cleanupSeed(request, token, seed)
    }
  })

  test('changes_requested review does not move task to verified; deploy gate blocks when report not green', async ({ request }) => {
    test.slow()
    let token: string | null = null
    let seed: SeededTask | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const call = caller(request, token)
      seed = await seedReadyTask(request, token, call, 'deploy-gate')
      const { projectId, baselineId, taskId, taskUpdatedAt } = seed

      const reserveKey = `tc-delivery-008-deploy-${randomUUID()}`
      const reserved = await call('POST', `${API}/tasks/${taskId}/attempts`, {
        body: { mode: 'manual_handoff', baseRevision: { kind: 'git', commitSha: COMMIT_A } },
        lock: taskUpdatedAt,
        headers: { 'Idempotency-Key': reserveKey },
      })
      expect(reserved.status, `reserve answered ${JSON.stringify(reserved.body)}`).toBe(201)
      const attemptId = reserved.body.attemptId as string

      const taskPackage = await call('GET', `${API}/tasks/${taskId}/package?attemptId=${attemptId}`)
      expect(taskPackage.status).toBe(200)
      const manifest = buildResultManifest(taskPackage.body as TaskPackageV1, { changedPaths: ['src/ServiceList.tsx'], checkStatus: 'failed' })

      const accepted = await call('POST', `${API}/tasks/${taskId}/results`, { body: { attemptId, manifest } })
      expect(accepted.status, `result answered ${JSON.stringify(accepted.body)}`).toBe(201)
      expect(accepted.body.taskStatus).toBe('awaiting_review')

      // Post a changes_requested review — task goes to changes_requested, never verified.
      const changesReview = await call('POST', `${API}/projects/${projectId}/evidence`, {
        body: {
          baselineId,
          kind: 'review',
          taskId,
          attemptId,
          sourceRevision: manifest.resultRevision,
          payload: {
            verdict: 'changes_requested',
            summary: 'Needs corrections before approval',
            findings: [{ severity: 'error', message: 'AC-001 not proven by test output' }],
            reviewer: { kind: 'human' },
          },
        },
      })
      expect(changesReview.status, `changes_requested review answered ${JSON.stringify(changesReview.body)}`).toBe(201)
      expect(changesReview.body.taskStatus).toBe('changes_requested')

      const taskAfter = await taskVersion(call, taskId)
      expect(taskAfter.status, 'task must not be verified').not.toBe('verified')

      const report = await call('GET', `${API}/projects/${projectId}/report`)
      expect(report.status).toBe(200)
      expect((report.body.gates as { publishable: { ok: boolean } }).publishable.ok).toBe(false)
      const projectUpdatedAt = await projectVersion(call, projectId)
      const deployDecision = await call('POST', `${API}/projects/${projectId}/deploy-decisions`, {
        body: {
          baselineId,
          sourceRevision: manifest.resultRevision,
          verdict: 'approved',
        },
        lock: projectUpdatedAt,
      })
      expect(deployDecision.status, `deploy decision answered ${JSON.stringify(deployDecision.body)}`).toBe(422)
      expect(deployDecision.body.code).toBe('report_not_green')
      expect(await projectVersion(call, projectId)).toBe(projectUpdatedAt)
      expect((await taskVersion(call, taskId)).status).toBe('changes_requested')
    } finally {
      await cleanupSeed(request, token, seed)
    }
  })
})
