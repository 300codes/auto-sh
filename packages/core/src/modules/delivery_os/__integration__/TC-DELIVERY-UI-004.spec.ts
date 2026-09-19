import { createHash, randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  deleteAttachmentIfExists,
  uploadAttachmentFixture,
} from '@open-mercato/core/helpers/integration/attachmentsFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { DELIVERY_SCHEMA_VERSIONS, taskPackageV1Schema, type SourceRevision } from '../lib/contracts'
import { buildResultManifest } from '../lib/fixtures'
import { DELIVERY_PROJECT_ATTACHMENT_ENTITY_ID } from '../components/detail/screenUpload'
import { buildAttemptIdempotencyKey } from '../components/task/attemptKey'
import {
  baselineCreateResponseSchema,
  decisionCreateResponseSchema,
  planImportResponseSchema,
  projectDetailSchema,
  projectUpdateResponseSchema,
  attemptCancelResponseSchema,
  attemptReconcileResponseSchema,
  resultAcceptResponseSchema,
  taskDtoSchema,
  taskUpdateResponseSchema,
} from '../api/schemas'
import { reserveAttemptResponseSchema } from '../lib/contracts'

/**
 * TC-DELIVERY-UI-004: the manual hand-off, end to end.
 *
 * (a) the full path — reserve, export the package, import the result, watch the
 *     task status move; (b) the uncertain path — reserve, request a stop, see
 *     `stop_unconfirmed`, reconcile as `unknown` and watch the attempt stop
 *     being active; (c) the negative paths — a repeated reservation returns the
 *     SAME attempt, a result for a foreign attempt is refused, and `completed`
 *     without a manifest is refused with `manifest_required`.
 *
 * Self-contained: every project is created here and archived by ITS OWN id in
 * `finally` — never "the first row of the list", which would destroy a record
 * this run never created (finding F2 of the UI-02 implementation review).
 *
 * Environment note: written against the live contracts but NOT executed — the
 * local database carries no `delivery_*` tables and both `yarn db:migrate` and
 * `yarn initialize` need separate approval. See the UI-04 handoff.
 */

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const PNG_SHA256 = createHash('sha256').update(PNG_1X1).digest('hex')

/** `react-vite` is a git profile, so a reservation must carry a git revision. */
const BASE_REVISION: SourceRevision = { kind: 'git', commitSha: 'a'.repeat(40) }

type Created = { projectId: string | null; attachmentIds: string[] }

type ReadyTask = {
  projectId: string
  taskId: string
  taskUpdatedAt: string
  attemptNumber: number
}

async function archiveProject(request: APIRequestContext, token: string, projectId: string): Promise<void> {
  const detailResponse = await apiRequest(request, 'GET', `/api/delivery_os/projects/${projectId}`, { token })
  if (!detailResponse.ok()) return
  const detail = projectDetailSchema.parse(await readJsonSafe(detailResponse))
  if (detail.archivedAt || !detail.updatedAt) return
  await apiRequest(request, 'DELETE', `/api/delivery_os/projects?id=${projectId}`, {
    token,
    headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: detail.updatedAt },
  })
}

async function cleanup(request: APIRequestContext, token: string, created: Created): Promise<void> {
  if (created.projectId) await archiveProject(request, token, created.projectId)
  for (const attachmentId of created.attachmentIds) {
    await deleteAttachmentIfExists(request, token, attachmentId)
  }
}

function requirementsManifest(projectId: string, manifestId: string) {
  return {
    schemaVersion: DELIVERY_SCHEMA_VERSIONS.requirementsProposal,
    projectId,
    manifestId,
    requirements: [{ id: 'REQ-1', title: 'The catalogue lists the available services' }],
    acceptanceCriteria: [
      { id: 'AC-1', requirementId: 'REQ-1', description: 'The list renders every published service.' },
    ],
    questions: [],
    risks: [],
    producedBy: { tool: 'claude-code', sessionRef: null },
  }
}

function planManifest(projectId: string, baselineId: string, baselineHash: string, manifestId: string) {
  return {
    schemaVersion: DELIVERY_SCHEMA_VERSIONS.planProposal,
    projectId,
    baselineId,
    baselineHash,
    manifestId,
    architectureSummary: 'One page, one store, no server state.',
    tasks: [
      {
        proposalTaskKey: 'T-1',
        title: 'Render the catalogue list',
        description: 'List the services with a category filter.',
        acIds: ['AC-1'],
        dependsOn: [],
        allowedPaths: ['src/features/catalogue'],
      },
    ],
    acTestMap: { 'AC-1': ['tests/catalogue.spec.ts'] },
    declaredTests: [{ testId: 'tests/catalogue.spec.ts', file: 'tests/catalogue.spec.ts' }],
    producedBy: { tool: 'claude-code', sessionRef: null },
  }
}

async function decide(
  request: APIRequestContext,
  token: string,
  baselineId: string,
  projectVersion: string,
  body: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', `/api/delivery_os/baselines/${baselineId}/decisions`, {
    token,
    headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: projectVersion },
    data: body,
  })
  expect(response.status(), `recording the ${String(body.kind)} decision`).toBe(201)
  return decisionCreateResponseSchema.parse(await readJsonSafe(response)).projectUpdatedAt
}

async function approveBoth(
  request: APIRequestContext,
  token: string,
  baseline: { baselineId: string; contentHash: string; version: number },
  projectVersion: string,
): Promise<string> {
  let version = projectVersion
  for (const kind of ['requirements', 'design'] as const) {
    version = await decide(request, token, baseline.baselineId, version, {
      kind,
      verdict: 'approved',
      subjectHash: baseline.contentHash,
      subjectVersion: baseline.version,
    })
  }
  return version
}

/**
 * The shortest honest road to a reservable task: requirements, a stored render,
 * a frozen baseline, its two decisions, a plan, and the MERGED baseline's own
 * two decisions — the ready gate refuses a task pinned to anything but the
 * active baseline.
 */
async function prepareReadyTask(request: APIRequestContext, token: string, created: Created): Promise<ReadyTask> {
  const createResponse = await apiRequest(request, 'POST', '/api/delivery_os/projects', {
    token,
    data: {
      name: `Delivery UI-04 ${randomUUID()}`,
      inputMode: 'from_brief',
      brief: 'TC-DELIVERY-UI-004 fixture',
      targetProfileId: 'react-vite',
    },
  })
  expect(createResponse.status(), 'creating the project').toBe(201)
  const project = await readJsonSafe(createResponse) as { id: string; updatedAt: string }
  created.projectId = project.id
  let projectVersion = project.updatedAt

  const requirementsResponse = await apiRequest(request, 'POST', `/api/delivery_os/projects/${project.id}/baselines`, {
    token,
    headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: projectVersion },
    data: { source: 'requirements_proposal', manifest: requirementsManifest(project.id, `req-${randomUUID()}`) },
  })
  expect(requirementsResponse.status(), 'importing the requirements proposal').toBe(201)
  projectVersion = baselineCreateResponseSchema.parse(await readJsonSafe(requirementsResponse)).projectUpdatedAt

  const uploaded = await uploadAttachmentFixture(request, token, {
    entityId: DELIVERY_PROJECT_ATTACHMENT_ENTITY_ID,
    recordId: project.id,
    fileName: 'screen.png',
    mimeType: 'image/png',
    buffer: PNG_1X1,
  })
  created.attachmentIds.push(uploaded.id)

  const detailResponse = await apiRequest(request, 'GET', `/api/delivery_os/projects/${project.id}`, { token })
  const detail = projectDetailSchema.parse(await readJsonSafe(detailResponse))
  const draft = detail.draftSpec as Record<string, unknown>
  const screenResponse = await apiRequest(request, 'PUT', '/api/delivery_os/projects', {
    token,
    headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: detail.updatedAt! },
    data: {
      id: project.id,
      draftSpec: {
        ...draft,
        screens: [{
          name: 'Service list',
          fileKey: '5wOkFtN959W4MFmgRuaU8S',
          nodeId: '3:2',
          viewport: { width: 1440, height: 1024 },
          attachmentId: uploaded.id,
          sha256: PNG_SHA256,
          capturedAt: new Date().toISOString(),
        }],
      },
    },
  })
  expect(screenResponse.status(), 'appending the screen to the draft').toBe(200)
  projectVersion = projectUpdateResponseSchema.parse(await readJsonSafe(screenResponse)).updatedAt

  const freezeResponse = await apiRequest(request, 'POST', `/api/delivery_os/projects/${project.id}/baselines`, {
    token,
    headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: projectVersion },
    data: { source: 'manual' },
  })
  expect(freezeResponse.status(), 'freezing the draft').toBe(201)
  const frozen = baselineCreateResponseSchema.parse(await readJsonSafe(freezeResponse))
  projectVersion = await approveBoth(request, token, frozen, frozen.projectUpdatedAt)

  const planResponse = await apiRequest(request, 'POST', `/api/delivery_os/projects/${project.id}/tasks`, {
    token,
    headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: projectVersion },
    data: {
      source: 'plan_proposal',
      manifest: planManifest(project.id, frozen.baselineId, frozen.contentHash, `plan-${randomUUID()}`),
    },
  })
  expect(planResponse.status(), 'importing the plan proposal').toBe(201)
  const plan = planImportResponseSchema.parse(await readJsonSafe(planResponse))
  const task = plan.tasks.find((entry) => entry.proposalTaskKey === 'T-1')
  expect(task, 'the plan must create T-1').toBeTruthy()

  // The merged baseline needs its OWN two decisions: the ready gate refuses a
  // task whose baseline is not the active one.
  await approveBoth(
    request,
    token,
    { baselineId: plan.baselineId, contentHash: plan.contentHash, version: plan.version },
    plan.projectUpdatedAt,
  )

  const readyResponse = await apiRequest(request, 'PUT', '/api/delivery_os/tasks', {
    token,
    headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: task!.updatedAt },
    data: { id: task!.id, status: 'ready' },
  })
  expect(readyResponse.status(), 'moving the task to ready').toBe(200)
  const ready = taskUpdateResponseSchema.parse(await readJsonSafe(readyResponse))
  expect(ready.status).toBe('ready')

  return { projectId: project.id, taskId: task!.id, taskUpdatedAt: ready.updatedAt, attemptNumber: 0 }
}

async function reserve(
  request: APIRequestContext,
  token: string,
  ready: ReadyTask,
  idempotencyKey: string,
) {
  return apiRequest(request, 'POST', `/api/delivery_os/tasks/${ready.taskId}/attempts`, {
    token,
    headers: {
      [OPTIMISTIC_LOCK_HEADER_NAME]: ready.taskUpdatedAt,
      'idempotency-key': idempotencyKey,
    },
    data: { mode: 'manual_handoff', baseRevision: BASE_REVISION },
  })
}

function keyFor(ready: ReadyTask): string {
  return buildAttemptIdempotencyKey({
    taskId: ready.taskId,
    baseRevision: BASE_REVISION,
    attemptNumber: ready.attemptNumber,
  })
}

async function readTask(request: APIRequestContext, token: string, taskId: string) {
  const response = await apiRequest(request, 'GET', `/api/delivery_os/tasks/${taskId}`, { token })
  expect(response.ok(), 'reading the task detail').toBe(true)
  return taskDtoSchema.parse(await readJsonSafe(response))
}

test.describe('TC-DELIVERY-UI-004: manual hand-off from reservation to a closed attempt', () => {
  test('TC-DELIVERY-UI-004a: reserve, export the package, import the result', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const created: Created = { projectId: null, attachmentIds: [] }
    try {
      const ready = await prepareReadyTask(request, token, created)

      const reserveResponse = await reserve(request, token, ready, keyFor(ready))
      expect(reserveResponse.status(), 'a new key reserves a new attempt').toBe(201)
      const reservation = reserveAttemptResponseSchema.parse(await readJsonSafe(reserveResponse))
      expect(reservation.taskId).toBe(ready.taskId)

      // The package is read-only and requires the attempt: this is the order the
      // UI shows rather than works around.
      const withoutAttempt = await apiRequest(request, 'GET', `/api/delivery_os/tasks/${ready.taskId}/package`, { token })
      expect(withoutAttempt.status(), 'the package needs an attemptId').toBe(400)

      const packageResponse = await apiRequest(
        request,
        'GET',
        `/api/delivery_os/tasks/${ready.taskId}/package?attemptId=${reservation.attemptId}`,
        { token },
      )
      expect(packageResponse.status(), 'exporting the task package').toBe(200)
      const taskPackage = taskPackageV1Schema.parse(await readJsonSafe(packageResponse))
      expect(taskPackage.attemptId).toBe(reservation.attemptId)
      expect(taskPackage.baselineHash).toBe(reservation.baselineHash)

      // The register is readable and reports exactly one active attempt.
      const executing = await readTask(request, token, ready.taskId)
      expect(executing.attemptRegisterReadable).toBe(true)
      expect(executing.executionAttempts).toHaveLength(1)
      expect(executing.status).toBe('executing')

      const manifest = buildResultManifest(taskPackage)
      const resultResponse = await apiRequest(request, 'POST', `/api/delivery_os/tasks/${ready.taskId}/results`, {
        token,
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: executing.updatedAt },
        data: { attemptId: reservation.attemptId, manifest },
      })
      expect(resultResponse.status(), 'importing the result manifest').toBe(201)
      const accepted = resultAcceptResponseSchema.parse(await readJsonSafe(resultResponse))
      expect(accepted.duplicate).toBe(false)
      expect(accepted.taskStatus, 'an accepted result never verifies the task by itself').toBe('awaiting_review')

      // An identical replay is a SUCCESS that writes no second evidence.
      const replayResponse = await apiRequest(request, 'POST', `/api/delivery_os/tasks/${ready.taskId}/results`, {
        token,
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: accepted.taskUpdatedAt },
        data: { attemptId: reservation.attemptId, manifest },
      })
      expect(replayResponse.status(), 'a replay answers 200, not 201').toBe(200)
      const replay = resultAcceptResponseSchema.parse(await readJsonSafe(replayResponse))
      expect(replay.duplicate).toBe(true)
      expect(replay.evidenceId, 'a replay must not create a second evidence record').toBe(accepted.evidenceId)
    } finally {
      await cleanup(request, token, created)
    }
  })

  test('TC-DELIVERY-UI-004b: a requested stop stays unconfirmed until the attempt is reconciled', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const created: Created = { projectId: null, attachmentIds: [] }
    try {
      const ready = await prepareReadyTask(request, token, created)
      const reserveResponse = await reserve(request, token, ready, keyFor(ready))
      expect(reserveResponse.status()).toBe(201)
      const reservation = reserveAttemptResponseSchema.parse(await readJsonSafe(reserveResponse))

      const cancelResponse = await apiRequest(
        request,
        'POST',
        `/api/delivery_os/tasks/${ready.taskId}/attempts/${reservation.attemptId}/cancel`,
        {
          token,
          headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: reservation.taskUpdatedAt },
          data: { reason: 'The session host became unreachable.' },
        },
      )
      expect(cancelResponse.status(), 'requesting the stop').toBe(200)
      const cancelled = attemptCancelResponseSchema.parse(await readJsonSafe(cancelResponse))
      expect(cancelled.state).toBe('cancel_requested')
      expect(cancelled.stopConfirmation, 'the stop is requested, never confirmed').toBe('stop_unconfirmed')
      expect(cancelled.taskStatus, 'the task keeps executing while the stop is unconfirmed').toBe('executing')

      // The unconfirmed stop keeps the attempt ACTIVE, so a second reservation
      // is still refused: this is exactly what the UI has to say out loud.
      const blocked = await reserve(request, token, { ...ready, attemptNumber: 1, taskUpdatedAt: cancelled.taskUpdatedAt }, keyFor({ ...ready, attemptNumber: 1 }))
      expect(blocked.status(), 'an unconfirmed stop still blocks a new reservation').toBe(409)
      expect((await readJsonSafe(blocked) as { code?: string } | null)?.code).toBe('attempt_active')

      const beforeReconcile = await readTask(request, token, ready.taskId)
      expect(beforeReconcile.executionAttempts[0].stopConfirmation).toBe('stop_unconfirmed')

      const reconcileResponse = await apiRequest(
        request,
        'POST',
        `/api/delivery_os/tasks/${ready.taskId}/attempts/${reservation.attemptId}/reconcile`,
        {
          token,
          headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: beforeReconcile.updatedAt },
          data: {
            resolution: 'unknown',
            externalEvidence: {
              note: 'The host was rebuilt; whether the run finished cannot be established.',
              observedAt: new Date().toISOString(),
            },
          },
        },
      )
      expect(reconcileResponse.status(), 'recording the unresolved reconciliation').toBe(200)
      const reconciled = attemptReconcileResponseSchema.parse(await readJsonSafe(reconcileResponse))
      expect(reconciled.resolution).toBe('unknown')

      const afterReconcile = await readTask(request, token, ready.taskId)
      expect(afterReconcile.executionAttempts[0].state, 'unknown records the uncertainty, it does not invent an outcome')
        .toBe('reconciliation_required')
      expect(afterReconcile.executionAttempts[0].reconciliation?.resolution).toBe('unknown')
      expect(afterReconcile.executionAttempts[0].outcome, 'an unresolved attempt has no outcome').toBeNull()
    } finally {
      await cleanup(request, token, created)
    }
  })

  test('TC-DELIVERY-UI-004c: a repeat reservation, a foreign attempt and a manifest-less completion', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const created: Created = { projectId: null, attachmentIds: [] }
    try {
      const ready = await prepareReadyTask(request, token, created)
      const key = keyFor(ready)

      const first = await reserve(request, token, ready, key)
      expect(first.status()).toBe(201)
      const reservation = reserveAttemptResponseSchema.parse(await readJsonSafe(first))

      // The SAME key, derived from the same (task, revision, attempt number),
      // must land on the SAME attempt — not a second one, not a conflict.
      const repeat = await reserve(request, token, { ...ready, taskUpdatedAt: reservation.taskUpdatedAt }, key)
      expect(repeat.status(), 'a repeated reservation answers 200, not 201').toBe(200)
      const repeated = reserveAttemptResponseSchema.parse(await readJsonSafe(repeat))
      expect(repeated.attemptId, 'the repeat returns the existing attempt').toBe(reservation.attemptId)

      const afterRepeat = await readTask(request, token, ready.taskId)
      expect(afterRepeat.executionAttempts, 'no second attempt was opened').toHaveLength(1)

      const packageResponse = await apiRequest(
        request,
        'GET',
        `/api/delivery_os/tasks/${ready.taskId}/package?attemptId=${reservation.attemptId}`,
        { token },
      )
      const taskPackage = taskPackageV1Schema.parse(await readJsonSafe(packageResponse))

      // A result addressed at an attempt this task never had is refused.
      const foreignAttemptId = randomUUID()
      const foreignResponse = await apiRequest(request, 'POST', `/api/delivery_os/tasks/${ready.taskId}/results`, {
        token,
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: afterRepeat.updatedAt },
        data: {
          attemptId: foreignAttemptId,
          manifest: buildResultManifest({ ...taskPackage, attemptId: foreignAttemptId }),
        },
      })
      expect([404, 409, 422], 'a result for an unknown attempt must be refused').toContain(foreignResponse.status())

      // `completed` without the manifest is refused by the domain with a named
      // code; the dialog blocks it before the request, this proves the server
      // agrees rather than the UI guessing.
      const withoutManifest = await apiRequest(
        request,
        'POST',
        `/api/delivery_os/tasks/${ready.taskId}/attempts/${reservation.attemptId}/reconcile`,
        {
          token,
          headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: afterRepeat.updatedAt },
          data: {
            resolution: 'completed',
            externalEvidence: { note: 'It finished on the other host.', observedAt: new Date().toISOString() },
          },
        },
      )
      expect([400, 422], 'a completion without a manifest must be refused').toContain(withoutManifest.status())
      const refusal = await readJsonSafe(withoutManifest) as { code?: string; details?: Array<{ code?: string }> } | null
      expect(
        refusal?.code === 'manifest_required' || refusal?.details?.some((detail) => detail.code === 'manifest_required'),
        'the refusal must name the missing manifest',
      ).toBe(true)
    } finally {
      await cleanup(request, token, created)
    }
  })
})
