import { createModuleQueue, type Queue } from '@open-mercato/queue'

export const DELIVERY_EXECUTE_QUEUE = 'delivery-execute'
export const DELIVERY_RESUME_QUEUE = 'delivery-resume'

export type ExecuteTaskJobPayload = {
  attemptId: string
  taskId: string
  tenantId: string
  organizationId: string
  actorUserId: string | null
}

export type ResumeAttemptJobPayload = {
  attemptId: string
  taskId: string
  evidenceId: string
  workflowRef: string
  tenantId: string
  organizationId: string
}

const queues = new Map<string, Queue<Record<string, unknown>>>()

export function getDeliveryAgentsQueue(queueName: string): Queue<Record<string, unknown>> {
  const existing = queues.get(queueName)
  if (existing) return existing
  const concurrency =
    queueName === DELIVERY_EXECUTE_QUEUE
      ? Math.max(1, Number.parseInt(process.env.DELIVERY_EXECUTE_CONCURRENCY ?? '2', 10) || 2)
      : 5
  const created = createModuleQueue<Record<string, unknown>>(queueName, { concurrency })
  queues.set(queueName, created)
  return created
}
