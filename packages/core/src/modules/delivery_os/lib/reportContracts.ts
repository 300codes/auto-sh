import { z } from 'zod'
import { deliveryReportV1Schema, deliveryReportFlowSectionSchema, uuidSchema, sha256Schema, sourceRevisionSchema, isoDateTimeSchema } from './contracts'

export const releaseCandidateSchema = z.object({
  id: uuidSchema,
  version: z.number().int().positive(),
  projectId: uuidSchema,
  baselineId: uuidSchema,
  baselineHash: sha256Schema,
  sourceRevision: sourceRevisionSchema,
  evidenceIds: z.array(uuidSchema).min(1).max(1000),
  createdAt: isoDateTimeSchema,
})
export type ReleaseCandidate = z.infer<typeof releaseCandidateSchema>
export const nominateReleaseCandidateSchema = z.object({
  baselineId: uuidSchema,
  sourceRevision: sourceRevisionSchema,
  evidenceIds: z.array(uuidSchema).min(1).max(1000).refine((ids) => new Set(ids).size === ids.length),
})
export const releaseCandidateResponseSchema = z.object({ currentCandidate: releaseCandidateSchema.nullable(), projectUpdatedAt: isoDateTimeSchema })
export const decisionPreflightShape = {
  candidateId: uuidSchema.optional(),
  candidateVersion: z.number().int().positive().optional(),
  decisionContextHash: sha256Schema.optional(),
}
export const deliveryReportResponseSchema = deliveryReportV1Schema.extend({
  mode: z.enum(['legacy', 'flow']),
  flow: deliveryReportFlowSectionSchema.nullable(),
  currentCandidate: releaseCandidateSchema.nullable(),
  projectUpdatedAt: isoDateTimeSchema,
  decisionContextHash: sha256Schema,
  candidateDecisions: z.object({ deployDecisionId: uuidSchema.nullable(), releaseDecisionId: uuidSchema.nullable() }),
})
export type DeliveryReportResponse = z.infer<typeof deliveryReportResponseSchema>
