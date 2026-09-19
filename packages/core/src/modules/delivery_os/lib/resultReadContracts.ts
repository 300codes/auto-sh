import { z } from 'zod'
import {
  isoDateTimeSchema,
  repoRelativePathSchema,
  resultCheckSchema,
  resultFindingSchema,
  sha256Schema,
  sourceRevisionSchema,
  usageSchema,
  uuidSchema,
} from './contracts'

export const resultReadQuerySchema = z.object({ attemptId: uuidSchema })

export const acceptedResultSummarySchema = z.object({
  projectId: uuidSchema,
  taskId: uuidSchema,
  attemptId: uuidSchema,
  baselineId: uuidSchema,
  baselineHash: sha256Schema,
  evidenceId: uuidSchema,
  sourceRevision: sourceRevisionSchema,
  source: z.enum(['manual', 'adapter']),
  createdAt: isoDateTimeSchema,
  externalRunId: z.string().min(1).max(200),
  checks: z.array(resultCheckSchema.pick({ checkId: true, testId: true, acIds: true, status: true })).max(1000),
  findings: z.array(resultFindingSchema).max(500),
  changedPaths: z.array(repoRelativePathSchema).max(2000),
  artifactCount: z.number().int().min(0).max(200),
  artifactBytes: z.number().int().min(0).nullable(),
  usage: usageSchema,
})

export const resultReadResponseSchema = z.object({
  schemaVersion: z.literal('delivery-result-read.v1'),
  result: acceptedResultSummarySchema.nullable(),
})

export type AcceptedResultSummary = z.infer<typeof acceptedResultSummarySchema>
export type ResultReadResponse = z.infer<typeof resultReadResponseSchema>
