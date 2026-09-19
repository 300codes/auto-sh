import { z } from 'zod'
export const settingsInputSchema = z.object({ workflowId: z.string().min(1).max(100), version: z.number().int().positive() }).strict()
export const scopeSchema = z.object({ tenantId: z.uuid(), organizationId: z.uuid() }).strict()
export const bindingSchema = settingsInputSchema.extend({ definitionId: z.uuid(), definitionHash: z.string().regex(/^[a-f0-9]{64}$/), templateHash: z.string().regex(/^[a-f0-9]{64}$/) })
export const settingsResponseSchema = z.object({
  setting: bindingSchema.extend({ id: z.uuid(), updatedAt: z.string().datetime(), studioHref: z.string() }).nullable(),
})

export const projectBindingResponseSchema = z.object({
  schemaVersion: z.literal('delivery-workflow-binding.v1'),
  projectId: z.uuid(),
  binding: z.object({
    definitionId: z.uuid(), version: z.number().int().positive(), workflowId: z.string().min(1),
    workflowInstanceId: z.uuid().nullable(), studioHref: z.string(),
  }).strict().nullable(),
}).strict()
