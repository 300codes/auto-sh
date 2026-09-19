import { z } from 'zod'
import { uuidSchema, isoDateTimeSchema } from './contracts'
export const scopingWidgetContextSchema = z.object({
  schemaVersion: z.literal('delivery-scoping-context.v1'),
  projectId: uuidSchema,
  intakeUpdatedAt: isoDateTimeSchema,
})
export type ScopingWidgetContext = z.infer<typeof scopingWidgetContextSchema> & { refresh?: () => Promise<void> }
