/** @jest-environment node */

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback?: string) => fallback ?? _key }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => require('./routeTestKit').findMock)
jest.mock('@open-mercato/shared/lib/di/container', () => require('./routeTestKit').containerMock)
jest.mock('@open-mercato/shared/lib/auth/server', () => require('./routeTestKit').authServerMock)
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => require('./routeTestKit').organizationScopeMock)
jest.mock('../../events', () => ({ emitDeliveryOsEvent: jest.fn(async () => undefined) }))
import '@open-mercato/core/modules/delivery_os/commands'
import { POST, metadata, openApi } from '../tasks/[id]/results/route'
import { FOREIGN_ORG_ID } from '../../commands/__tests__/baselineTestKit'
import { buildResultManifest } from '../../lib/fixtures/builders'
import { emitDeliveryOsEvent } from '../../events'
import { resultAcceptResponseSchema } from '../schemas'
import { UNKNOWN_ATTEMPT_ID, exportPackage, reserveAttemptId, seedReadyTask } from './attemptRouteKit'
import {
  FOREIGN_TENANT_ID,
  TASK_ID,
  apiRequest,
  expectFrozenError,
  isAllowedBy,
  readBody,
  resetRouteState,
  routeParams,
  routeState,
  signInAs,
} from './routeTestKit'

function importResult(body: unknown, options: { taskId?: string; headers?: Record<string, string> } = {}): Promise<Response> {
  const taskId = options.taskId ?? TASK_ID
  return POST(apiRequest('POST', `/tasks/${taskId}/results`, { body, headers: options.headers }), routeParams(taskId))
}

async function reservedResult(): Promise<{ attemptId: string; manifest: Record<string, unknown> }> {
  const attemptId = await reserveAttemptId()
  const manifest = buildResultManifest(await exportPackage(attemptId)) as unknown as Record<string, unknown>
  return { attemptId, manifest }
}

beforeEach(() => {
  resetRouteState()
  jest.mocked(emitDeliveryOsEvent).mockClear()
})

describe('POST /api/delivery_os/tasks/:id/results — guards', () => {
  it('requires results.import: a manage-only user cannot import results', () => {
    expect(Object.keys(openApi.methods)).toEqual(['POST'])
    expect(isAllowedBy(metadata, 'POST', ['delivery_os.results.import'])).toBe(true)
    expect(isAllowedBy(metadata, 'POST', ['delivery_os.attempts.manage', 'delivery_os.projects.manage'])).toBe(false)
  })

  it('answers 401 without a session', async () => {
    routeState.auth = null
    expect((await importResult({})).status).toBe(401)
  })
})

describe('POST /api/delivery_os/tasks/:id/results', () => {
  it('accepts a result with 201, then answers 200 duplicate for the replay with one evidence row', async () => {
    const task = seedReadyTask()
    const { attemptId, manifest } = await reservedResult()

    const accepted = await importResult({ attemptId, manifest })
    const acceptedBody = await readBody(accepted)
    expect(accepted.status).toBe(201)
    expect(resultAcceptResponseSchema.safeParse(acceptedBody).success).toBe(true)
    expect(acceptedBody).toMatchObject({ duplicate: false, taskStatus: 'awaiting_review' })
    expect(Object.keys(acceptedBody).sort()).toEqual(['duplicate', 'evidenceId', 'taskStatus', 'taskUpdatedAt'])
    expect(routeState.store.evidence[0]).toMatchObject({ source: 'manual', attemptId, taskId: TASK_ID })

    const replay = await importResult({ attemptId, manifest })
    expect(replay.status).toBe(200)
    expect(await readBody(replay)).toMatchObject({ duplicate: true, evidenceId: acceptedBody.evidenceId })
    expect(routeState.store.evidence).toHaveLength(1)
    expect(task.status).toBe('awaiting_review')
    const recorded = jest.mocked(emitDeliveryOsEvent).mock.calls.filter(([eventId]) => eventId === 'delivery_os.evidence.recorded')
    expect(recorded).toHaveLength(2)
  })

  it('ignores a client-sent source and taskId', async () => {
    seedReadyTask()
    const { attemptId, manifest } = await reservedResult()
    const response = await importResult({ attemptId, manifest, source: 'adapter', taskId: FOREIGN_ORG_ID })
    expect(response.status).toBe(201)
    expect(routeState.store.evidence[0]).toMatchObject({ source: 'manual', taskId: TASK_ID })
  })

  it('answers 409 result_conflict for a different manifest and 422 correlation_mismatch for a foreign task id', async () => {
    seedReadyTask()
    const { attemptId, manifest } = await reservedResult()
    const foreignTask = { ...manifest, taskId: UNKNOWN_ATTEMPT_ID }
    await expectFrozenError(await importResult({ attemptId, manifest: foreignTask }), 422, 'correlation_mismatch')
    await importResult({ attemptId, manifest })
    const different = { ...manifest, externalRunId: 'another-run' }
    await expectFrozenError(await importResult({ attemptId, manifest: different }), 409, 'result_conflict')
    expect(routeState.store.evidence).toHaveLength(1)
  })

  it('answers 404 attempt_not_found, 400 for a malformed body and 422 for an unknown schema version', async () => {
    seedReadyTask()
    const { attemptId, manifest } = await reservedResult()
    await expectFrozenError(await importResult({ attemptId: UNKNOWN_ATTEMPT_ID, manifest }), 404, 'attempt_not_found')
    await expectFrozenError(await importResult({ attemptId }), 400, 'validation_failed')
    await expectFrozenError(await importResult({ attemptId: 'nope', manifest }), 400, 'validation_failed')
    const unknownVersion = { ...manifest, schemaVersion: 'delivery.result-manifest/v9' }
    await expectFrozenError(await importResult({ attemptId, manifest: unknownVersion }), 422, 'unsupported_schema_version')
    expect(routeState.store.evidence).toHaveLength(0)
  })

  it('answers 413 payload_too_large for an oversized manifest and for an oversized declared body', async () => {
    seedReadyTask()
    const { attemptId, manifest } = await reservedResult()
    const oversized = { ...manifest, padding: 'x'.repeat(2_000_001) }
    await expectFrozenError(await importResult({ attemptId, manifest: oversized }), 413, 'payload_too_large')
    const declared = await importResult({ attemptId, manifest }, { headers: { 'content-length': '9000000' } })
    await expectFrozenError(declared, 413, 'payload_too_large')
    const streamed = await importResult({ attemptId, manifest: { ...manifest, padding: 'x'.repeat(8_000_001) } })
    const streamedBody = await expectFrozenError(streamed, 413, 'payload_too_large')
    expect((streamedBody.details as Array<{ path?: string }>)[0].path).toBe('body')
    expect(routeState.store.evidence).toHaveLength(0)
  })

  it('answers 404 for a second tenant, a second organization and a malformed id', async () => {
    seedReadyTask()
    const { attemptId, manifest } = await reservedResult()
    for (const session of [{ tenantId: FOREIGN_TENANT_ID }, { orgId: FOREIGN_ORG_ID }]) {
      signInAs(session)
      await expectFrozenError(await importResult({ attemptId, manifest }), 404, 'not_found')
      await expectFrozenError(await importResult({ attemptId: 'nope' }), 404, 'not_found')
    }
    signInAs({})
    await expectFrozenError(await importResult({ attemptId, manifest }, { taskId: 'nope' }), 404, 'not_found')
    expect(routeState.store.evidence).toHaveLength(0)
  })
})
