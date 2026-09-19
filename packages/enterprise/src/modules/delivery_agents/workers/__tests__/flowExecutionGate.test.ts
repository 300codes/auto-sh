const mockGate = jest.fn()
const mockRun = jest.fn()
const mockSignal = jest.fn()
const mockCommand = jest.fn()
const mockContainer = { resolve: jest.fn() }
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: async () => mockContainer }))
jest.mock('@open-mercato/shared/lib/logger', () => ({ createLogger: () => ({ child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }) }))
jest.mock('@open-mercato/delivery-cezar/lib/resultManifest', () => ({ mapCezarRunToResultManifest: jest.fn() }), { virtual: true })
const mockFindEvidence = jest.fn()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: (...args: unknown[]) => mockFindEvidence(...args) }))
jest.mock('../../lib/resultAcceptance', () => ({ acceptResult: jest.fn() }))
import execute from '../execute-task'
import resume from '../resume-attempt'
import type { QueuedJob, JobContext } from '@open-mercato/queue'
import type { ExecuteTaskJobPayload, ResumeAttemptJobPayload } from '../../lib/queue'

const payload = { taskId: '11111111-1111-4111-8111-111111111111', attemptId: '22222222-2222-4222-8222-222222222222', tenantId: '33333333-3333-4333-8333-333333333333', organizationId: '44444444-4444-4444-8444-444444444444', actorUserId: '55555555-5555-4555-8555-555555555555', workflowRef: 'attempt-correlation' }
const context = {} as JobContext

beforeEach(() => {
  jest.resetAllMocks()
  mockFindEvidence.mockResolvedValue({ recordedBy: '55555555-5555-4555-8555-555555555555' })
  mockGate.mockResolvedValue(undefined)
  mockCommand.mockResolvedValue({ result: {} })
  mockRun.mockResolvedValue({ exitCode: 0, durationMs: 1 })
  const em = { fork: () => em }
  const services: Record<string, unknown> = {
    em, commandBus: { execute: mockCommand },
    deliveryOsAttemptQueries: { assertExecutionReady: mockGate, buildTaskPackage: async () => ({ schemaVersion: '1' }), getAttempt: async () => ({ state: 'claimed' }) },
    deliveryAgentsTaskExecutor: { run: mockRun },
    signalHandler: { sendSignalByCorrelationKey: mockSignal },
  }
  mockContainer.resolve.mockImplementation((key: string) => services[key])
})

describe('worker before-effect flow gate', () => {
  it('does not call the executor when the claimed attempt lost its current binding', async () => {
    mockGate.mockRejectedValueOnce(new Error('[internal] stale binding'))
    await expect(execute({ id: 'job', payload } as QueuedJob<ExecuteTaskJobPayload>, context)).rejects.toThrow('stale binding')
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('runs an allowed claimed attempt only after the gate resolves', async () => {
    await execute({ id: 'job', payload } as QueuedJob<ExecuteTaskJobPayload>, context)
    expect(mockRun).toHaveBeenCalledTimes(1)
    expect(mockGate.mock.invocationCallOrder[0]).toBeLessThan(mockRun.mock.invocationCallOrder[0])
  })

  it('refuses a core package without a compatible host before external effects', async () => {
    const queries = mockContainer.resolve('deliveryOsAttemptQueries') as { buildTaskPackage: () => Promise<unknown> }
    queries.buildTaskPackage = async () => ({ schemaVersion: 'task-package.v1' })
    await expect(execute({ id: 'job', payload } as QueuedJob<ExecuteTaskJobPayload>, context)).rejects.toThrow('No compatible execution host')
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('checks the scoped task, attempt and workflow before signaling a resume', async () => {
    mockGate.mockRejectedValueOnce(new Error('[internal] stale flow'))
    await expect(resume({ id: 'resume', payload } as QueuedJob<ResumeAttemptJobPayload>, context)).rejects.toThrow('stale flow')
    expect(mockGate).toHaveBeenCalledWith({ tenantId: payload.tenantId, organizationId: payload.organizationId }, payload.taskId, payload.attemptId, 'resume', payload.workflowRef)
    expect(mockSignal).not.toHaveBeenCalled()
  })

  it('rechecks before every resume retry and stops a stale retry before its effect', async () => {
    jest.useFakeTimers()
    mockSignal.mockResolvedValueOnce(0)
    mockGate.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('[internal] stale retry'))
    const operation = resume({ id: 'resume', payload } as QueuedJob<ResumeAttemptJobPayload>, context)
    const assertion = expect(operation).rejects.toThrow('stale retry')
    await jest.runAllTimersAsync()
    await assertion
    expect(mockGate).toHaveBeenCalledTimes(2)
    expect(mockSignal).toHaveBeenCalledTimes(1)
    jest.useRealTimers()
  })
})
