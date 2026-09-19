import { createLogger } from '@open-mercato/shared/lib/logger'
import { getDeliveryAgentsQueue, DELIVERY_RESUME_QUEUE, type ResumeAttemptJobPayload } from '../lib/queue'

const logger = createLogger('delivery_agents').child({ subscriber: 'evidence-recorded' })

export const metadata = {
  event: 'delivery_os.evidence.recorded',
  persistent: true,
  id: 'delivery_agents:evidence-recorded',
}

type EvidenceRecordedPayload = {
  evidenceId: string
  taskId?: string | null
  attemptId?: string | null
  projectId: string
  kind: string
  duplicate: boolean
  completionDelivery?: string | null
  tenantId: string
  organizationId: string
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(payload: EvidenceRecordedPayload, _ctx: ResolverContext): Promise<void> {
  // Only enqueue resume job when completionDelivery is 'pending'
  if (payload.completionDelivery !== 'pending') return
  if (!payload.attemptId || !payload.taskId) {
    logger.debug('evidence-recorded without attemptId/taskId — skipping resume enqueue', {
      evidenceId: payload.evidenceId,
    })
    return
  }

  // Fetch workflowRef for the attempt — the resume worker needs it to send the signal
  // We pass it via the job payload to avoid re-reading in the worker
  // The workflowRef is the correlationKey = attemptId, so we can derive it
  const jobPayload: ResumeAttemptJobPayload = {
    attemptId: payload.attemptId,
    taskId: payload.taskId,
    evidenceId: payload.evidenceId,
    workflowRef: payload.attemptId, // correlationKey = attemptId per executionBridge
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
  }

  try {
    await getDeliveryAgentsQueue(DELIVERY_RESUME_QUEUE).enqueue(jobPayload as Record<string, unknown>)
    logger.debug('enqueued resume-attempt job', { attemptId: payload.attemptId, evidenceId: payload.evidenceId })
  } catch (error) {
    logger.error('failed to enqueue resume-attempt job', {
      attemptId: payload.attemptId,
      evidenceId: payload.evidenceId,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
