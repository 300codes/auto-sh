import { z } from 'zod'
import {
  deliveryErrorBodySchema,
  deliveryLimitsSchema,
  executionAttemptSchema,
  isoDateTimeSchema,
  reconciliationResolutionSchema,
  sha256Schema,
  TASK_STATUS_REASONS,
  taskStatusSchema,
  uuidSchema,
} from '../lib/contracts'

export { deliveryErrorBodySchema }

export const optimisticLockConflictSchema = z.object({
  error: z.string(),
  code: z.literal('optimistic_lock_conflict'),
  currentUpdatedAt: z.string().nullable().optional(),
  expectedUpdatedAt: z.string().nullable().optional(),
})

export const projectListItemSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  inputMode: z.string(),
  brief: z.string().nullable(),
  targetProfileId: z.string(),
  targetProfileVersion: z.number(),
  repositoryRef: z.string().nullable(),
  activeBaselineId: uuidSchema.nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
})
export type ProjectListItem = z.infer<typeof projectListItemSchema>

export const projectProgressSchema = z.object({
  proven: z.number().int(),
  total: z.number().int(),
  unit: z.literal('ac'),
  percent: z.number().nullable(),
})

export const projectDetailSchema = projectListItemSchema.extend({
  draftSpec: z.record(z.string(), z.unknown()),
  limits: deliveryLimitsSchema,
  status: z.enum(['archived', 'draft', 'awaiting_approval', 'planning', 'in_progress', 'coverage_gap', 'verified', 'released']),
  progress: projectProgressSchema,
  taskCounts: z.record(z.string(), z.number().int()),
  attention: z.object({
    blockedTaskIds: z.array(uuidSchema),
    reconciliationRequiredTaskIds: z.array(uuidSchema),
  }),
})
export type ProjectDetail = z.infer<typeof projectDetailSchema>

export const projectCreateResponseSchema = z.object({ id: uuidSchema, updatedAt: isoDateTimeSchema })
export const projectUpdateResponseSchema = z.object({ ok: z.literal(true), updatedAt: isoDateTimeSchema })

export const baselineDecisionDtoSchema = z.object({
  id: uuidSchema,
  kind: z.string(),
  verdict: z.enum(['approved', 'rejected']),
  subjectHash: sha256Schema,
  subjectVersion: z.number().int().nullable(),
  reason: z.string().nullable(),
  actorUserId: uuidSchema,
  decidedAt: z.string(),
})

export const baselineDtoSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  version: z.number().int(),
  contentHash: sha256Schema,
  source: z.string(),
  parentBaselineId: uuidSchema.nullable(),
  content: z.record(z.string(), z.unknown()),
  attachmentIds: z.array(uuidSchema),
  createdBy: uuidSchema.nullable(),
  createdAt: z.string(),
  isActive: z.boolean(),
  decisions: z.array(baselineDecisionDtoSchema),
})
export type BaselineDto = z.infer<typeof baselineDtoSchema>

export const baselineListResponseSchema = z.object({ items: z.array(baselineDtoSchema), total: z.number().int() })

export const baselineCreateResponseSchema = z.object({
  baselineId: uuidSchema,
  version: z.number().int(),
  contentHash: sha256Schema,
  duplicate: z.boolean(),
  openCommentIds: z.array(z.string()),
  projectUpdatedAt: z.string(),
})

export const decisionCreateResponseSchema = z.object({
  decisionId: uuidSchema,
  activeBaselineId: uuidSchema.nullable(),
  projectUpdatedAt: isoDateTimeSchema,
})

export const deployDecisionCreateResponseSchema = z.object({
  decisionId: uuidSchema,
  projectUpdatedAt: isoDateTimeSchema,
})

export const releaseDecisionCreateResponseSchema = deployDecisionCreateResponseSchema

export const taskDtoSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  baselineId: uuidSchema,
  title: z.string(),
  description: z.string().nullable(),
  acIds: z.array(z.string()),
  dependsOnTaskIds: z.array(uuidSchema),
  allowedPaths: z.array(z.string()),
  targetProfileId: z.string(),
  targetProfileVersion: z.number().int(),
  status: taskStatusSchema,
  statusReason: z.string().nullable(),
  attemptNumber: z.number().int(),
  executionAttempts: z.array(executionAttemptSchema),
  attemptRegisterReadable: z.boolean(),
  proposalTaskKey: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().nullable(),
})
export type TaskDto = z.infer<typeof taskDtoSchema>

export const taskListResponseSchema = z.object({ items: z.array(taskDtoSchema), total: z.number().int() })
export const taskCreateResponseSchema = z.object({ id: uuidSchema, updatedAt: isoDateTimeSchema })
export const planImportResponseSchema = z.object({
  baselineId: uuidSchema,
  version: z.number().int().positive(),
  contentHash: sha256Schema,
  duplicate: z.boolean(),
  tasks: z.array(z.object({ id: uuidSchema, proposalTaskKey: z.string().min(1), updatedAt: isoDateTimeSchema })),
  projectUpdatedAt: isoDateTimeSchema,
})
export const taskUpdateResponseSchema = z.object({
  ok: z.literal(true),
  updatedAt: isoDateTimeSchema,
  status: taskStatusSchema,
})

export const resultAcceptResponseSchema = z.object({
  evidenceId: uuidSchema,
  duplicate: z.boolean(),
  taskStatus: taskStatusSchema,
  taskUpdatedAt: isoDateTimeSchema,
})

export const evidenceRecordResponseSchema = z.object({
  evidenceId: uuidSchema,
  duplicate: z.boolean(),
  taskStatus: taskStatusSchema.optional(),
  taskStatusReason: z.enum(TASK_STATUS_REASONS).nullable().optional(),
  taskUpdatedAt: isoDateTimeSchema.optional(),
})

export const attemptCancelResponseSchema = z.object({
  attemptId: uuidSchema,
  state: z.literal('cancel_requested'),
  stopConfirmation: z.literal('stop_unconfirmed'),
  taskStatus: taskStatusSchema,
  taskUpdatedAt: isoDateTimeSchema,
})

export const attemptReconcileResponseSchema = z.object({
  attemptId: uuidSchema,
  resolution: reconciliationResolutionSchema,
  taskStatus: taskStatusSchema,
  taskUpdatedAt: isoDateTimeSchema,
  evidenceId: uuidSchema.optional(),
})
