import { asValue, createContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createDeliveryStageSignals } from '../stageSignals'
import { DeliveryWorkflowProjectBinding } from '../../data/entities'
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: (em: EntityManager, entity: object, where: object) => em.findOne(entity as never, where) }))
const scope = { tenantId: 'tenant', organizationId: 'org' }
function fixture() {
  const stage = { stageId: 'scope', currency: 'approved', latestDecision: { verdict: 'approved' }, pendingApproval: null, blockers: [] }
  const binding = { ...scope, projectId: 'project', workflowInstanceId: 'instance' }
  const instance = { ...scope, id: 'instance', status: 'PAUSED', currentStepId: 'scope' }
  const em = {
    findOne: async (entity: unknown, where: Record<string, unknown>) => {
      const row = entity === DeliveryWorkflowProjectBinding ? binding : instance
      return Object.entries(where).every(([key, value]) => (row as Record<string, unknown>)[key] === value) ? row : null
    },
    transactional: async <Result>(work: (value: unknown) => Promise<Result>) => work(em),
    getConnection: () => ({ execute: jest.fn(async () => []) }),
  }
  const sendSignal = jest.fn(async () => { instance.status = 'COMPLETED' })
  const container = createContainer().register({ em: asValue(em), deliveryOsFlowQueries: asValue({ flowStatus: jest.fn(async () => ({ stages: [stage] })) }), signalHandler: asValue({ sendSignal }) })
  return { stage, instance, sendSignal, service: createDeliveryStageSignals(container), options: { ...scope, instanceId: 'instance', signalName: 'delivery.stage.scope.approved' } }
}
test('persistent stage event resumes a current approval once, completed retry does not execute again', async () => {
  const context = fixture()
  await context.service.resume(scope, 'project', 'scope')
  await context.service.resume(scope, 'project', 'scope')
  expect(context.sendSignal).toHaveBeenCalledTimes(1)
  expect(context.sendSignal.mock.calls[0]).toEqual([expect.anything(), expect.anything(), context.options])
})
test.each(['stale', 'pending', 'rejected'])('forged signal cannot bypass %s domain approval', async (currency) => {
  const context = fixture()
  context.stage.currency = currency
  await expect(context.service.validate(context.options)).rejects.toMatchObject({ status: 409 })
  await context.service.resume(scope, 'project', 'scope')
  expect(context.sendSignal).not.toHaveBeenCalled()
})
test('scope mismatch, arbitrary signals and context overwrite fail closed', async () => {
  const context = fixture()
  for (const options of [{ ...context.options, organizationId: 'foreign' }, { ...context.options, signalName: 'continue' }, { ...context.options, payload: { approved: true } }]) {
    await expect(context.service.validate(options)).rejects.toMatchObject({ status: 409 })
  }
})
