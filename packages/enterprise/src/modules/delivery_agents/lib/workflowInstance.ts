import type { EntityManager } from '@mikro-orm/postgresql'
import { DELIVERY_AGENTS_END_STEP_ID, DELIVERY_AGENTS_WAIT_STEP_ID } from './attemptWorkflow'

type DeliveryScope = { tenantId: string; organizationId: string }

export type DeliveryWorkflowInstance = {
  id: string
  status: string
  currentStepId?: string | null
}

type InstanceLookup = { id: string } | { correlationKey: string }

export async function findDeliveryWorkflowInstance(
  em: EntityManager,
  lookup: InstanceLookup,
  scope: DeliveryScope,
): Promise<DeliveryWorkflowInstance | null> {
  const { WorkflowInstance } = (await import('@open-mercato/core/modules/workflows/data/entities')) as {
    WorkflowInstance: new () => DeliveryWorkflowInstance
  }
  const instance = await em.fork().findOne(WorkflowInstance as never, {
    ...lookup,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  } as never)
  return (instance as unknown as DeliveryWorkflowInstance | null) ?? null
}

export function isParkedAtEvidenceWait(instance: DeliveryWorkflowInstance | null): boolean {
  return instance?.status === 'PAUSED' && instance.currentStepId === DELIVERY_AGENTS_WAIT_STEP_ID
}

export function hasLeftEvidenceWait(instance: DeliveryWorkflowInstance | null): boolean {
  return instance?.status === 'COMPLETED' || instance?.currentStepId === DELIVERY_AGENTS_END_STEP_ID
}
