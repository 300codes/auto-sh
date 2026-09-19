import { z } from 'zod'
import { checkStatusSchema, deliveryEvidenceKindSchema, sourceRevisionSchema, uuidSchema, sha256Schema } from './contracts'

export const evidenceListQuerySchema = z.object({
  baselineId: uuidSchema,
  revision: z.string().min(1).max(1000).optional(),
  group: z.enum(['revision', 'baseline']).default('revision'),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
}).superRefine((value, context) => {
  if (value.group === 'revision' && !value.revision) context.addIssue({ code: 'custom', path: ['revision'], message: 'Revision required' })
  if (value.group === 'baseline' && value.revision) context.addIssue({ code: 'custom', path: ['revision'], message: 'Baseline group has no revision' })
})
export const evidenceReadItemSchema = z.object({
  id: uuidSchema, projectId: uuidSchema, baselineId: uuidSchema,
  taskId: uuidSchema.nullable(), attemptId: uuidSchema.nullable(),
  kind: deliveryEvidenceKindSchema, source: z.enum(['manual', 'adapter']),
  sourceRevision: sourceRevisionSchema.nullable(), rawReportHash: sha256Schema.nullable(),
  createdAt: z.string().datetime(),
})
export const evidenceListResponseSchema = z.object({
  schemaVersion: z.literal('delivery-evidence-read.v1'),
  group: z.enum(['revision', 'baseline']), items: z.array(evidenceReadItemSchema).max(100),
  nextOffset: z.number().int().nonnegative().nullable(),
})
export const evidenceSafePayloadSchema = z.object({
  verdict: z.enum(['approved', 'changes_requested']).optional(),
  status: checkStatusSchema.optional(),
  uploadStatus: z.enum(['succeeded', 'failed']).optional(),
  verificationStatus: z.enum(['verified', 'unverified', 'failed']).optional(),
  checks: z.array(z.object({ status: checkStatusSchema, rawReportHash: sha256Schema.nullable() })).max(1000).optional(),
  summary: z.object({ critical: z.number().int().nonnegative(), high: z.number().int().nonnegative(), moderate: z.number().int().nonnegative(), low: z.number().int().nonnegative() }).optional(),
  viewport: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).optional(),
  capturedAt: z.string().datetime().optional(),
  sha256: sha256Schema.optional(),
})
export const evidenceDetailResponseSchema = evidenceReadItemSchema.extend({
  schemaVersion: z.literal('delivery-evidence-read.v1'), payload: evidenceSafePayloadSchema,
  attachments: z.array(z.object({ mimeType: z.string().max(255).nullable().default(null), fileSize: z.number().int().nonnegative().nullable().default(null), available: z.boolean().nullable().default(null), id: uuidSchema, downloadUrl: z.string().startsWith('/api/delivery_os/projects/'), previewUrl: z.string().startsWith('/api/delivery_os/projects/').nullable() })).max(100),
  attachmentsTruncated: z.boolean(),
})
export type EvidenceListQuery = z.infer<typeof evidenceListQuerySchema>
export type EvidenceListResponse = z.infer<typeof evidenceListResponseSchema>
export type EvidenceDetailResponse = z.infer<typeof evidenceDetailResponseSchema>
export function evidenceAttachmentUrl(projectId: string, evidenceId: string, attachmentId: string): string {
  return `/api/delivery_os/projects/${encodeURIComponent(projectId)}/evidence/${encodeURIComponent(evidenceId)}/attachments/${encodeURIComponent(attachmentId)}`
}
