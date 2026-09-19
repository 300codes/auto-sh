import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { workflowDefinitionDataSchema } from '@open-mercato/core/modules/workflows/data/validators'
import { DELIVERY_AGENTS_WAIT_STEP_ID, upsertAttemptWorkflowDefinition } from '../attemptWorkflow'

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({ child: () => ({ warn: jest.fn(), info: jest.fn() }) }),
}))

test('the owned attempt workflow is a valid definition whose transitions the engine follows automatically', async () => {
  const upsertOwnedDefinition = jest.fn().mockResolvedValue({ ok: true, definition: { workflowId: 'delivery-cezar-attempt' } })
  const container = { resolve: () => ({ upsertOwnedDefinition }) } as unknown as AwilixContainer
  await upsertAttemptWorkflowDefinition(container, {} as EntityManager, {
    tenantId: '11111111-1111-4111-8111-111111111111',
    organizationId: '22222222-2222-4222-8222-222222222222',
  })
  const definition = workflowDefinitionDataSchema.parse(upsertOwnedDefinition.mock.calls[0][1].definition)
  expect(definition.transitions.every((transition) => transition.trigger === 'auto')).toBe(true)
  expect(definition.transitions.find((transition) => transition.fromStepId === 'start')?.toStepId).toBe(DELIVERY_AGENTS_WAIT_STEP_ID)
})
