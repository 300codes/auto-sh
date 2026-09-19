import { z } from 'zod'
import type { createDeliveryStageSignals } from '../lib/stageSignals'
export const metadata = { event: 'delivery_os.stage.decided', persistent: true, id: 'delivery_workflows:stage-decided' }
const eventSchema = z.object({ projectId: z.string().uuid(), stageId: z.string(), verdict: z.literal('approved'), currency: z.literal('approved') })
export default async function handle(payload: unknown, context: { resolve<T>(name: string): T; tenantId?: string | null; organizationId?: string | null }) {
  const parsed = eventSchema.safeParse(payload)
  if (!parsed.success || !context.tenantId || !context.organizationId) return
  await context.resolve<ReturnType<typeof createDeliveryStageSignals>>('deliveryStageSignals').resume(
    { tenantId: context.tenantId, organizationId: context.organizationId }, parsed.data.projectId, parsed.data.stageId,
  )
}
