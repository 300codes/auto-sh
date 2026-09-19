const mockHostExecute = jest.fn()
const mockHostSupports = jest.fn()
const mockAccept = jest.fn()
const mockRun = jest.fn()
const mockCommand = jest.fn()
const mockContainer = { resolve: jest.fn() }
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: async () => mockContainer }))
jest.mock('@open-mercato/shared/lib/logger', () => ({ createLogger: () => ({ child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }) }))
jest.mock('@open-mercato/delivery-cezar/lib/resultManifest', () => ({ mapCezarRunToResultManifest: jest.fn() }), { virtual: true })
jest.mock('../../lib/resultAcceptance', () => ({ acceptResult: (...args: unknown[]) => mockAccept(...args) }))
import taskPackageSnapshotFixture from '@open-mercato/core/modules/delivery_os/lib/fixtures/task-package.snapshot.v1.json'
import execute from '../execute-task'
import type { QueuedJob, JobContext } from '@open-mercato/queue'
import type { ExecuteTaskJobPayload } from '../../lib/queue'

const payload = {
  taskId: taskPackageSnapshotFixture.taskId,
  attemptId: taskPackageSnapshotFixture.attemptId,
  tenantId: '33333333-3333-4333-8333-333333333333',
  organizationId: '44444444-4444-4444-8444-444444444444',
  actorUserId: '55555555-5555-4555-8555-555555555555',
}
const context = {} as JobContext
const manifest = { schemaVersion: 'delivery.result-manifest/v1', attemptId: payload.attemptId }
let attemptState = 'claimed'
let services: Record<string, unknown>

function runJob(): Promise<void> {
  return execute({ id: 'job', payload } as QueuedJob<ExecuteTaskJobPayload>, context)
}

beforeEach(() => {
  jest.resetAllMocks()
  attemptState = 'claimed'
  mockCommand.mockResolvedValue({ result: { changed: true } })
  mockHostSupports.mockReturnValue(true)
  mockHostExecute.mockResolvedValue(manifest)
  mockAccept.mockResolvedValue({ evidenceId: 'evidence', duplicate: false })
  const em = { fork: () => em }
  services = {
    em,
    commandBus: { execute: mockCommand },
    deliveryOsAttemptQueries: {
      assertExecutionReady: async () => undefined,
      buildTaskPackage: async () => structuredClone(taskPackageSnapshotFixture),
      getAttempt: async () => ({ state: attemptState }),
    },
    deliveryAgentsTaskExecutor: { run: mockRun },
    deliveryAgentsExecutionHost: { supports: mockHostSupports, execute: mockHostExecute },
  }
  mockContainer.resolve.mockImplementation((key: string) => {
    if (!(key in services)) throw new Error(`[internal] unresolved ${key}`)
    return services[key]
  })
})

describe('execute-task routes a canonical task package to the execution host', () => {
  it('runs the host for the package profile and accepts its canonical manifest', async () => {
    await runJob()
    expect(mockHostSupports).toHaveBeenCalledWith(taskPackageSnapshotFixture.targetProfileId, taskPackageSnapshotFixture.targetProfileVersion)
    expect(mockHostExecute).toHaveBeenCalledWith(expect.objectContaining({
      taskPackage: expect.objectContaining({ taskId: payload.taskId, attemptId: payload.attemptId }),
      scope: { tenantId: payload.tenantId, organizationId: payload.organizationId },
      actorUserId: payload.actorUserId,
    }))
    expect(mockAccept).toHaveBeenCalledWith(expect.objectContaining({ taskId: payload.taskId, attemptId: payload.attemptId, manifest }))
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('refuses the package before any effect when no host is registered', async () => {
    delete services.deliveryAgentsExecutionHost
    await expect(runJob()).rejects.toThrow('No compatible execution host')
    expect(mockRun).not.toHaveBeenCalled()
    expect(mockAccept).not.toHaveBeenCalled()
  })

  it('refuses the package when the host does not support its target profile', async () => {
    mockHostSupports.mockReturnValue(false)
    await expect(runJob()).rejects.toThrow('No compatible execution host')
    expect(mockHostExecute).not.toHaveBeenCalled()
  })

  it('does not accept anything when the host fails', async () => {
    mockHostExecute.mockRejectedValue(new Error('[internal] snapshot mismatch'))
    await runJob()
    expect(mockAccept).not.toHaveBeenCalled()
  })

  it('reconciles a cancel requested during host execution instead of accepting the result', async () => {
    attemptState = 'cancel_requested'
    await runJob()
    expect(mockAccept).not.toHaveBeenCalled()
    expect(mockCommand.mock.calls.map(([id]) => id)).toContain('delivery_os.attempts.reconcile')
  })
})
