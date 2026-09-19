const mockRun = jest.fn()
const mockSignal = jest.fn()
const mockCommand = jest.fn()
const mockFindInstance = jest.fn()
const mockContainer = { resolve: jest.fn() }
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: async () => mockContainer }))
jest.mock('@open-mercato/shared/lib/logger', () => ({ createLogger: () => ({ child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }) }))
jest.mock('@open-mercato/delivery-cezar/lib/resultManifest', () => ({ mapCezarRunToResultManifest: jest.fn() }), { virtual: true })
jest.mock('../../lib/resultAcceptance', () => ({ acceptResult: jest.fn() }))
jest.mock('../../lib/workflowInstance', () => {
  const actual = jest.requireActual('../../lib/workflowInstance')
  return { ...actual, findDeliveryWorkflowInstance: (...args: unknown[]) => mockFindInstance(...args) }
})
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import execute from '../execute-task'
import resume from '../resume-attempt'
import type { QueuedJob, JobContext } from '@open-mercato/queue'
import type { ExecuteTaskJobPayload, ResumeAttemptJobPayload } from '../../lib/queue'

const payload = {
  taskId: '11111111-1111-4111-8111-111111111111',
  attemptId: '22222222-2222-4222-8222-222222222222',
  tenantId: '33333333-3333-4333-8333-333333333333',
  organizationId: '44444444-4444-4444-8444-444444444444',
  actorUserId: '55555555-5555-4555-8555-555555555555',
  workflowRef: '22222222-2222-4222-8222-222222222222',
  evidenceId: '66666666-6666-4666-8666-666666666666',
}
const context = {} as JobContext

function commandCalls(id: string): unknown[] {
  return mockCommand.mock.calls.filter(([commandId]) => commandId === id).map(([, options]) => options.input)
}

beforeEach(() => {
  jest.resetAllMocks()
  mockCommand.mockResolvedValue({ result: { changed: true } })
  mockRun.mockResolvedValue({ exitCode: 0, durationMs: 1 })
  mockSignal.mockResolvedValue(0)
  mockFindInstance.mockResolvedValue(null)
  const em = { fork: () => em }
  const services: Record<string, unknown> = {
    em,
    commandBus: { execute: mockCommand },
    deliveryOsAttemptQueries: {
      assertExecutionReady: async () => undefined,
      buildTaskPackage: async () => ({ schemaVersion: '1' }),
      getAttempt: async () => ({ state: 'claimed' }),
    },
    deliveryAgentsTaskExecutor: { run: mockRun },
    signalHandler: { sendSignalByCorrelationKey: mockSignal },
  }
  mockContainer.resolve.mockImplementation((key: string) => services[key])
})

describe('REC-02: execute-task claims before any external effect', () => {
  it('does not run the executor again when the same job re-claims an attempt it already holds', async () => {
    mockCommand.mockImplementation(async (id: string) => ({ result: { changed: id !== 'delivery_os.attempts.claim' } }))
    await execute({ id: 'job', payload } as QueuedJob<ExecuteTaskJobPayload>, context)
    expect(mockRun).not.toHaveBeenCalled()
    expect(commandCalls('delivery_os.attempts.claim')).toHaveLength(1)
  })

  it.each(['attempt_active', 'attempt_closed', 'attempt_cancelled'])('ends a duplicate job refused with %s without an effect', async (code) => {
    mockCommand.mockRejectedValueOnce(new CrudHttpError(409, { error: code, code }))
    await expect(execute({ id: 'duplicate', payload } as QueuedJob<ExecuteTaskJobPayload>, context)).resolves.toBeUndefined()
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('surfaces an unexpected claim failure for a queue retry', async () => {
    mockCommand.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(execute({ id: 'job', payload } as QueuedJob<ExecuteTaskJobPayload>, context)).rejects.toThrow('database unavailable')
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('runs the executor once for a fresh claim', async () => {
    await execute({ id: 'job', payload } as QueuedJob<ExecuteTaskJobPayload>, context)
    expect(mockRun).toHaveBeenCalledTimes(1)
  })
})

describe('REC-04: resume-attempt after a delivery whose signal already landed', () => {
  async function runResume(): Promise<void> {
    jest.useFakeTimers()
    const operation = resume({ id: 'resume', payload } as QueuedJob<ResumeAttemptJobPayload>, context)
    await jest.runAllTimersAsync()
    await operation
    jest.useRealTimers()
  }

  it.each([
    { status: 'COMPLETED', currentStepId: 'end' },
    { status: 'RUNNING', currentStepId: 'end' },
  ])('marks the delivery delivered when the workflow already left the wait step (%j)', async (instance) => {
    mockFindInstance.mockResolvedValue({ id: 'workflow', ...instance })
    await runResume()
    expect(commandCalls('delivery_os.attempts.mark_delivery')).toEqual([expect.objectContaining({ outcome: 'delivered' })])
    expect(mockFindInstance).toHaveBeenCalledWith(expect.anything(), { correlationKey: payload.workflowRef }, { tenantId: payload.tenantId, organizationId: payload.organizationId })
  })

  it.each([
    null,
    { status: 'PAUSED', currentStepId: 'wait_for_evidence' },
    { status: 'RUNNING', currentStepId: 'start' },
  ])('marks the delivery failed when the workflow never consumed the signal (%j)', async (instance) => {
    mockFindInstance.mockResolvedValue(instance === null ? null : { id: 'workflow', ...instance })
    await runResume()
    expect(commandCalls('delivery_os.attempts.mark_delivery')).toEqual([expect.objectContaining({ outcome: 'failed' })])
  })

  it('fails closed when the workflow state cannot be read', async () => {
    mockFindInstance.mockRejectedValue(new Error('lookup failed'))
    await runResume()
    expect(commandCalls('delivery_os.attempts.mark_delivery')).toEqual([expect.objectContaining({ outcome: 'failed' })])
  })

  it('does not look up the workflow when the signal is delivered', async () => {
    mockSignal.mockResolvedValue(1)
    await runResume()
    expect(mockFindInstance).not.toHaveBeenCalled()
    expect(commandCalls('delivery_os.attempts.mark_delivery')).toEqual([expect.objectContaining({ outcome: 'delivered' })])
  })
})
