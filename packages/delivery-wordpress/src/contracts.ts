import { z } from 'zod'

export const scopeSchema = z.object({
  tenantId: z.uuid(),
  organizationId: z.uuid(),
  projectId: z.uuid(),
}).strict()

export const createSiteRequestSchema = z.object({
  scope: scopeSchema,
  attemptId: z.uuid(),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/),
  name: z.string().trim().min(1).max(80).regex(/^[\p{L}\p{N} ._-]+$/u),
  themeSlug: z.string().regex(/^[a-z][a-z0-9-]{0,59}$/),
}).strict()

export const siteHandleSchema = z.object({
  siteId: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()

export const toolCheckSchema = z.object({
  checkId: z.string(),
  status: z.enum(['passed', 'failed', 'not_run']),
  checkedAt: z.iso.datetime(),
  code: z.string().optional(),
}).strict()

export const siteResultSchema = z.object({
  schemaVersion: z.literal(1),
  provenance: z.enum(['live', 'fixture']),
  siteId: siteHandleSchema.shape.siteId,
  scope: scopeSchema,
  attemptId: z.uuid(),
  toolExecutionId: z.uuid(),
  studioSiteId: z.string().min(1),
  localUrl: z.url(),
  themeSlug: createSiteRequestSchema.shape.themeSlug,
  themeCommit: z.string().regex(/^[a-f0-9]{40,64}$/),
  createdAt: z.iso.datetime(),
  checks: z.array(toolCheckSchema),
}).strict()

export type Scope = z.infer<typeof scopeSchema>
export type CreateSiteRequest = z.infer<typeof createSiteRequestSchema>
export type SiteHandle = z.infer<typeof siteHandleSchema>
export type SiteResult = z.infer<typeof siteResultSchema>
export type ToolCheck = z.infer<typeof toolCheckSchema>

export function toolError(code: string): Error & { code: string } {
  return Object.assign(new Error(`[internal] ${code}`), { code })
}

export function parseInput<Output>(schema: z.ZodType<Output>, value: unknown): Output {
  const result = schema.safeParse(value)
  if (!result.success) throw toolError('invalid_input')
  return result.data
}
