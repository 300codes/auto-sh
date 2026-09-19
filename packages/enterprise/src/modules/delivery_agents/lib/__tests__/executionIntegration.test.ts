import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { isIssuedTrustedExecution } from '@open-mercato/core/modules/delivery_os/lib/trustedExecution'
import { acceptResult } from '../resultAcceptance'
import { startExecution } from '../executionBridge'

const mockEnqueue = jest.fn()
jest.mock('../queue', () => ({
  DELIVERY_EXECUTE_QUEUE: 'delivery-execute',
  getDeliveryAgentsQueue: () => ({ enqueue: mockEnqueue }),
}))
jest.mock('@open-mercato/core/modules/workflows/data/entities', () => ({
  WorkflowInstance: class WorkflowInstance {},
}))
jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({ child: () => ({ warn: jest.fn() }) }),
}))

const actorUserId = '7e21256a-4849-442b-b96d-f9c26037832b'
const scope = {
  tenantId: '836fd3cf-48b8-4099-9f18-8a8ce249fabc',
  organizationId: 'a049c0e7-a6f3-4697-b522-b9c8e59e15fd',
}

function fixture() {
  const execute = jest.fn().mockResolvedValue({ result: { attemptId: 'attempt', created: true } })
  const findOne = jest.fn().mockResolvedValue({ id: 'workflow', status: 'PAUSED', currentStepId: 'wait_for_evidence' })
  const workflowExecutor = {
    startWorkflow: jest.fn().mockResolvedValue({ id: 'workflow' }),
    executeWorkflow: jest.fn().mockResolvedValue({ status: 'RUNNING' }),
  }
  const getAttempt = jest.fn().mockResolvedValue({ resultEvidenceId: 'existing-evidence', workflowRef: 'existing-workflow' })
  const container = {
    resolve: (name: string) => {
      if (name === 'commandBus') return { execute }
      if (name === 'workflowExecutor') return workflowExecutor
      if (name === 'deliveryOsAttemptQueries') return { getAttempt, assertExecutionReady: jest.fn(async () => undefined) }
      throw new Error(`Unexpected service: ${name}`)
    },
  } as unknown as AppContainer
  const em = { fork: () => ({ findOne }) } as unknown as EntityManager
  return {
    execute, findOne, workflowExecutor, getAttempt, container,
    startInput: {
      taskId: 'task', idempotencyKey: 'key', userId: actorUserId, scope, container, em,
      baseRevision: { kind: 'snapshot' as const, contentHash: 'a'.repeat(64), externalWorkspaceId: 'site' },
    },
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})
afterEach(() => jest.useRealTimers())

test('accepts through the domain command envelope with issued authority and scoped actor', async () => {
  const setup = fixture()
  setup.execute.mockResolvedValue({ result: { evidenceId: 'evidence', duplicate: false } })
  const manifest = { contentHash: 'manifest' }
  await expect(acceptResult({ ...setup.startInput, attemptId: 'attempt', manifest })).resolves.toEqual({ evidenceId: 'evidence', duplicate: false })
  const options = setup.execute.mock.calls[0][1]
  expect(isIssuedTrustedExecution(options.input.trustedExecution)).toBe(true)
  expect(options.input.trustedExecution.actorUserId).toBe(actorUserId)
  expect(options.ctx.auth).toMatchObject({ sub: actorUserId, tenantId: scope.tenantId, orgId: scope.organizationId })
  expect(options.input.manifest).toBe(manifest)
  expect(setup.getAttempt).not.toHaveBeenCalled()
})

test('defers duplicate conflicts to the canonical domain guard', async () => {
  const setup = fixture()
  setup.execute.mockRejectedValue(new Error('result_manifest_conflict'))
  await expect(acceptResult({ ...setup.startInput, attemptId: 'attempt', manifest: {} })).rejects.toThrow('result_manifest_conflict')
  expect(setup.execute).toHaveBeenCalledTimes(1)
})

test.each([null, 'delivery_agents_worker'])('rejects an untrusted actor %s before executing', async (userId) => {
  const setup = fixture()
  await expect(acceptResult({ ...setup.startInput, attemptId: 'attempt', manifest: {}, userId })).rejects.toThrow()
  expect(setup.execute).not.toHaveBeenCalled()
})

test('unwraps reservation and enqueues only the correctly scoped parked workflow', async () => {
  const setup = fixture()
  await expect(startExecution(setup.startInput)).resolves.toEqual({ attemptId: 'attempt', workflowInstanceId: 'workflow', state: 'reserved' })
  expect(setup.findOne).toHaveBeenCalledWith(expect.any(Function), { id: 'workflow', ...scope })
  expect(mockEnqueue).toHaveBeenCalledWith({ attemptId: 'attempt', taskId: 'task', actorUserId, ...scope })
  expect(setup.execute.mock.calls[1][1].input.attemptId).toBe('attempt')
})

test('reuses the domain reservation without creating another workflow or job', async () => {
  const setup = fixture()
  setup.execute.mockResolvedValue({ result: { attemptId: 'attempt', created: false } })
  await expect(startExecution(setup.startInput)).resolves.toMatchObject({ attemptId: 'attempt', workflowInstanceId: 'existing-workflow' })
  expect(setup.workflowExecutor.startWorkflow).not.toHaveBeenCalled()
  expect(mockEnqueue).not.toHaveBeenCalled()
})

test('does not enqueue when initial workflow execution fails', async () => {
  const setup = fixture()
  setup.workflowExecutor.executeWorkflow.mockRejectedValue(new Error('execution failed'))
  await expect(startExecution(setup.startInput)).rejects.toThrow('execution failed')
  expect(mockEnqueue).not.toHaveBeenCalled()
})

test('does not enqueue when the scoped park lookup fails', async () => {
  const setup = fixture()
  setup.findOne.mockRejectedValue(new Error('lookup failed'))
  await expect(startExecution(setup.startInput)).rejects.toThrow('Unable to confirm')
  expect(mockEnqueue).not.toHaveBeenCalled()
})

test.each([
  { status: 'PAUSED', currentStepId: 'wrong-step' },
  { status: 'RUNNING', currentStepId: 'wait_for_evidence' },
  null,
])('does not enqueue an unconfirmed park %j', async (instance) => {
  jest.useFakeTimers()
  const setup = fixture()
  setup.findOne.mockResolvedValue(instance)
  const assertion = expect(startExecution(setup.startInput)).rejects.toThrow('did not park')
  await jest.runAllTimersAsync()
  await assertion
  expect(mockEnqueue).not.toHaveBeenCalled()
})


test('never fabricates a workspace revision from a baseline when no revision is supplied', async () => {
  const setup = fixture()
  await expect(startExecution({ ...setup.startInput, baseRevision: undefined })).rejects.toThrow()
  expect(setup.execute).not.toHaveBeenCalled()
  expect(setup.workflowExecutor.startWorkflow).not.toHaveBeenCalled()
  expect(mockEnqueue).not.toHaveBeenCalled()
})
