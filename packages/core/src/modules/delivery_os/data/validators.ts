import { z } from 'zod'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import {
  acceptanceCriterionSchema,
  addDeliveryIssue,
  attachmentRefSchema,
  attemptModeSchema,
  buildDeliveryError,
  checkStatusSchema,
  checkUniqueIds,
  commentAnchorSchema,
  declaredTestSchema,
  deliveryErrorFromZod,
  deliveryLimitsSchema,
  idempotencyKeySchema,
  isoDateTimeSchema,
  proposalQuestionSchema,
  proposalRiskSchema,
  reconciliationResolutionSchema,
  repoRelativePathSchema,
  requirementSchema,
  reserveAttemptRequestSchema,
  resultCheckSchema,
  resultFindingSchema,
  screenRefSchema,
  sha256Schema,
  sourceRevisionSchema,
  stableIdSchema,
  taskStatusSchema,
  USER_SETTABLE_TASK_STATUSES,
  uuidSchema,
  type DeliveryErrorResult,
  type TaskStatus,
} from '@open-mercato/core/modules/delivery_os/lib/contracts'

const nameSchema = z.string().trim().min(1).max(200)
const titleSchema = z.string().trim().min(1).max(300)
const descriptionSchema = z.string().max(8000)
const reasonSchema = z.string().max(2000)
const MAX_MANIFEST_BODY_CHARS = 2_000_000
const MAX_RECORD_ENTRIES = 500

const manifestBodySchema = z.record(z.string(), z.unknown()).superRefine((value, ctx) => {
  if (JSON.stringify(value).length > MAX_MANIFEST_BODY_CHARS) {
    addDeliveryIssue(ctx, 'payload_too_large', [], 'Manifest is too large')
  }
})

function hasAtMostEntries(value: Record<string, unknown>): boolean {
  return Object.keys(value).length <= MAX_RECORD_ENTRIES
}

const attachmentIdsSchema = z.array(uuidSchema).max(50)

function hasUrlCredentials(value: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:[/\\]*[^/\\?#]*@/i.test(value)) return true
  try {
    const url = new URL(value)
    return url.username !== '' || url.password !== ''
  } catch {
    return false
  }
}

function isPlainHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.username === '' && url.password === ''
  } catch {
    return false
  }
}

function requireReasonWhenRejected(
  value: { verdict: 'approved' | 'rejected'; reason?: string | null },
  ctx: z.RefinementCtx,
): void {
  if (value.verdict === 'rejected' && (value.reason ?? '').trim().length === 0) {
    addDeliveryIssue(ctx, 'reason_required', ['reason'], 'A rejection needs a reason')
  }
}

export const deliveryInputModeSchema = z.enum(['from_brief', 'from_design'])

export { taskStatusSchema, USER_SETTABLE_TASK_STATUSES, type TaskStatus }

export const decisionVerdictSchema = z.enum(['approved', 'rejected'])

const repositoryRefSchema = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine((value) => !hasUrlCredentials(value), { message: 'repositoryRef must not contain credentials' })

export const draftCommentSchema = z.object({
  id: stableIdSchema,
  screenAttachmentId: uuidSchema.nullable(),
  anchor: commentAnchorSchema.nullable(),
  body: z.string().min(1).max(4000),
  status: z.enum(['open', 'resolved']),
  resolution: z.string().min(1).max(4000).optional(),
})

export const draftAdrSchema = z.object({
  id: stableIdSchema,
  title: z.string().min(1).max(300),
  decision: z.string().min(1).max(4000),
})

export const draftSpecV1Schema = z
  .object({
    requirements: z.array(requirementSchema).max(200).default([]),
    acceptanceCriteria: z.array(acceptanceCriterionSchema).max(500).default([]),
    questions: z.array(proposalQuestionSchema).max(200).default([]),
    risks: z.array(proposalRiskSchema).max(200).default([]),
    adr: z.array(draftAdrSchema).max(100).default([]),
    screens: z.array(screenRefSchema).max(100).default([]),
    tokens: z.record(z.string().min(1).max(200), z.json()).refine(hasAtMostEntries, { message: 'Too many entries' }).default({}),
    architectureSummary: descriptionSchema.nullable().default(null),
    planSummary: descriptionSchema.nullable().default(null),
    acTestMap: z
      .record(stableIdSchema, z.array(z.string().min(1).max(512)).max(200))
      .refine(hasAtMostEntries, { message: 'Too many entries' })
      .default({}),
    manualChecks: z.record(stableIdSchema, stableIdSchema).refine(hasAtMostEntries, { message: 'Too many entries' }).default({}),
    declaredTests: z.array(declaredTestSchema).max(1000).default([]),
    attachments: z.array(attachmentRefSchema).max(200).default([]),
    comments: z.array(draftCommentSchema).max(500).default([]),
  })
  .superRefine((value, ctx) => {
    checkUniqueIds(ctx, value.requirements.map((requirement) => requirement.id), 'requirements', 'id')
    checkUniqueIds(ctx, value.acceptanceCriteria.map((criterion) => criterion.id), 'acceptanceCriteria', 'id')
    checkUniqueIds(ctx, value.questions.map((question) => question.id), 'questions', 'id')
    checkUniqueIds(ctx, value.risks.map((risk) => risk.id), 'risks', 'id')
    checkUniqueIds(ctx, value.adr.map((record) => record.id), 'adr', 'id')
    checkUniqueIds(ctx, value.comments.map((comment) => comment.id), 'comments', 'id')
  })
export type DraftSpecV1 = z.infer<typeof draftSpecV1Schema>

export const projectCreateSchema = z.object({
  name: nameSchema,
  inputMode: deliveryInputModeSchema,
  brief: z.string().max(20000).nullable().optional(),
  targetProfileId: stableIdSchema,
  targetProfileVersion: z.number().int().positive().optional(),
  repositoryRef: repositoryRefSchema.nullable().optional(),
  limits: deliveryLimitsSchema.partial().optional(),
})
export type ProjectCreateInput = z.infer<typeof projectCreateSchema>

export const projectUpdateSchema = z.object({
  id: uuidSchema,
  name: nameSchema.optional(),
  brief: z.string().max(20000).nullable().optional(),
  repositoryRef: repositoryRefSchema.nullable().optional(),
  draftSpec: draftSpecV1Schema.optional(),
  limits: deliveryLimitsSchema.partial().optional(),
})
export type ProjectUpdateInput = z.infer<typeof projectUpdateSchema>

export const projectListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().trim().max(200).optional(),
  includeArchived: z
    .union([z.boolean(), z.string().max(10)])
    .optional()
    .transform((value) => (typeof value === 'boolean' ? value : parseBooleanWithDefault(value, false))),
})
export type ProjectListQuery = z.infer<typeof projectListQuerySchema>

const acIdsSchema = z.array(stableIdSchema).min(1).max(50)
const dependsOnTaskIdsSchema = z.array(uuidSchema).max(50)
const allowedPathsSchema = z.array(repoRelativePathSchema).max(200)

export const taskCreateSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('manual'),
    baselineId: uuidSchema,
    title: titleSchema,
    description: descriptionSchema.nullable().optional(),
    acIds: acIdsSchema,
    dependsOnTaskIds: dependsOnTaskIdsSchema.optional(),
    allowedPaths: allowedPathsSchema.optional(),
  }),
  z.object({
    source: z.literal('plan_proposal'),
    manifest: manifestBodySchema,
  }),
])
export type TaskCreateInput = z.infer<typeof taskCreateSchema>

export const taskUpdateSchema = z
  .object({
    id: uuidSchema,
    title: titleSchema.optional(),
    description: descriptionSchema.nullable().optional(),
    acIds: acIdsSchema.optional(),
    dependsOnTaskIds: dependsOnTaskIdsSchema.optional(),
    allowedPaths: allowedPathsSchema.optional(),
    status: taskStatusSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const selfIndex = value.dependsOnTaskIds?.indexOf(value.id) ?? -1
    if (selfIndex >= 0) {
      addDeliveryIssue(ctx, 'cycle', ['dependsOnTaskIds', selfIndex], 'A task cannot depend on itself')
    }
  })
export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>

export const baselineCreateSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('manual') }),
  z.object({ source: z.literal('requirements_proposal'), manifest: manifestBodySchema }),
])
export type BaselineCreateInput = z.infer<typeof baselineCreateSchema>

export const baselineDecisionSchema = z
  .object({
    kind: z.enum(['requirements', 'design']),
    verdict: decisionVerdictSchema,
    subjectHash: sha256Schema,
    subjectVersion: z.number().int().positive(),
    reason: reasonSchema.nullable().optional(),
  })
  .superRefine(requireReasonWhenRejected)
export type BaselineDecisionInput = z.infer<typeof baselineDecisionSchema>

export const reserveAttemptBodySchema = reserveAttemptRequestSchema
export type ReserveAttemptBody = z.infer<typeof reserveAttemptBodySchema>

export const idempotencyKeyHeaderSchema = idempotencyKeySchema

export const trustedExecutionSchema = z.strictObject({
  source: z.literal('delivery_agents'),
  actorUserId: uuidSchema,
})
export type TrustedExecution = z.infer<typeof trustedExecutionSchema>

export const reserveAttemptCommandSchema = z.object({
  taskId: uuidSchema,
  idempotencyKey: idempotencyKeySchema,
  mode: attemptModeSchema,
  baseRevision: sourceRevisionSchema,
  trustedExecution: trustedExecutionSchema.optional(),
})
export type ReserveAttemptCommandInput = z.infer<typeof reserveAttemptCommandSchema>

const internalAttemptShape = {
  taskId: uuidSchema,
  attemptId: uuidSchema,
  trustedExecution: trustedExecutionSchema.optional(),
}
const attemptRefSchema = z.string().min(1).max(200)

export const claimAttemptCommandSchema = z.object({
  ...internalAttemptShape,
  workerRef: attemptRefSchema,
})
export type ClaimAttemptCommandInput = z.infer<typeof claimAttemptCommandSchema>

export const linkAttemptWorkflowCommandSchema = z.object({
  ...internalAttemptShape,
  workflowRef: attemptRefSchema,
  workflowStepId: attemptRefSchema.nullable().optional(),
  dispatched: z.boolean().optional(),
})
export type LinkAttemptWorkflowCommandInput = z.infer<typeof linkAttemptWorkflowCommandSchema>

export const markAttemptDeliveryCommandSchema = z.discriminatedUnion('outcome', [
  z.object({ ...internalAttemptShape, outcome: z.literal('delivered') }),
  z.object({ ...internalAttemptShape, outcome: z.literal('failed'), error: z.string().min(1).max(8000) }),
])
export type MarkAttemptDeliveryCommandInput = z.infer<typeof markAttemptDeliveryCommandSchema>

export const packageQuerySchema = z.object({ attemptId: uuidSchema })
export type PackageQuery = z.infer<typeof packageQuerySchema>

export const resultsImportSchema = z.object({
  attemptId: uuidSchema,
  manifest: manifestBodySchema,
})
export type ResultsImportInput = z.infer<typeof resultsImportSchema>

export const acceptResultCommandSchema = resultsImportSchema.extend({
  taskId: uuidSchema,
  source: z.enum(['manual', 'adapter']),
  trustedExecution: trustedExecutionSchema.optional(),
})
export type AcceptResultCommandInput = z.infer<typeof acceptResultCommandSchema>

const evidenceBaseShape = {
  baselineId: uuidSchema,
  taskId: uuidSchema.optional(),
  attemptId: uuidSchema.optional(),
  sourceRevision: sourceRevisionSchema.optional(),
  attachmentIds: attachmentIdsSchema.optional(),
}

export const testEvidencePayloadSchema = z.object({
  rawReportHash: sha256Schema,
  checks: z.array(resultCheckSchema).min(1).max(1000),
})

export const reviewEvidencePayloadSchema = z.object({
  verdict: z.enum(['approved', 'changes_requested']),
  summary: z.string().min(1).max(8000),
  findings: z.array(resultFindingSchema).max(200).default([]),
  manualCheckId: stableIdSchema.optional(),
  reviewedEvidenceId: uuidSchema.optional(),
  reviewer: z.object({
    kind: z.enum(['human', 'agent']),
    ref: z.string().min(1).max(200).optional(),
  }),
})

export const screenshotEvidencePayloadSchema = z.object({
  attachmentId: uuidSchema,
  sha256: sha256Schema,
  name: z.string().min(1).max(300),
  viewport: z.object({
    width: z.number().int().positive().max(16384),
    height: z.number().int().positive().max(16384),
  }),
  capturedAt: isoDateTimeSchema,
  pageUrl: z.string().max(2000).refine(isPlainHttpUrl, { message: 'pageUrl must be an http(s) URL without credentials' }).optional(),
})

export const deploymentVerificationSchema = z.object({
  status: z.enum(['verified', 'failed']),
  checkedAt: isoDateTimeSchema,
  method: z.string().min(1).max(200),
  observedBuildId: z.string().min(1).max(200),
  note: z.string().max(2000).optional(),
})

export const deploymentEvidencePayloadSchema = z.object({
  url: z.string().max(2000).optional(),
  environment: z.string().max(100).optional(),
  buildId: z.string().max(200).optional(),
  deployedAt: isoDateTimeSchema,
  uploadStatus: z.enum(['succeeded', 'failed']),
  verification: deploymentVerificationSchema.nullable().default(null),
})

export const scanEvidencePayloadSchema = z.object({
  checkId: stableIdSchema,
  scanner: z.string().min(1).max(200),
  status: checkStatusSchema,
  rawReportHash: sha256Schema,
  summary: z
    .object({
      critical: z.number().int().min(0),
      high: z.number().int().min(0),
      moderate: z.number().int().min(0),
      low: z.number().int().min(0),
    })
    .optional(),
})

export const referenceMaterialPayloadSchema = z.object({
  title: z.string().min(1).max(300),
  description: descriptionSchema.optional(),
  origin: z.string().min(1).max(500).optional(),
})

export const RECORDABLE_EVIDENCE_KINDS = [
  'test',
  'review',
  'screenshot',
  'deployment',
  'scan',
  'reference_material',
] as const
export type RecordableEvidenceKind = (typeof RECORDABLE_EVIDENCE_KINDS)[number]

const REVISION_REQUIRED_KINDS: readonly RecordableEvidenceKind[] = ['test', 'review', 'scan']

export const recordEvidenceSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('test'), ...evidenceBaseShape, payload: testEvidencePayloadSchema }),
    z.object({ kind: z.literal('review'), ...evidenceBaseShape, payload: reviewEvidencePayloadSchema }),
    z.object({ kind: z.literal('screenshot'), ...evidenceBaseShape, payload: screenshotEvidencePayloadSchema }),
    z.object({ kind: z.literal('deployment'), ...evidenceBaseShape, payload: deploymentEvidencePayloadSchema }),
    z.object({ kind: z.literal('scan'), ...evidenceBaseShape, payload: scanEvidencePayloadSchema }),
    z.object({ kind: z.literal('reference_material'), ...evidenceBaseShape, payload: referenceMaterialPayloadSchema }),
  ])
  .superRefine((value, ctx) => {
    if (value.attemptId && !value.taskId) {
      ctx.addIssue({ code: 'custom', path: ['taskId'], message: 'taskId is required when attemptId is given' })
    }
    if (value.kind === 'review' && !value.taskId) {
      ctx.addIssue({ code: 'custom', path: ['taskId'], message: 'A review must name the task it reviews' })
    }
    if (REVISION_REQUIRED_KINDS.includes(value.kind) && !value.sourceRevision) {
      ctx.addIssue({ code: 'custom', path: ['sourceRevision'], message: `sourceRevision is required for ${value.kind} evidence` })
    }
    if (value.kind === 'deployment') {
      const { url, environment, buildId } = value.payload
      const requiredFields = { url, environment, buildId }
      for (const [field, fieldValue] of Object.entries(requiredFields)) {
        if (typeof fieldValue !== 'string' || fieldValue.trim().length === 0) {
          addDeliveryIssue(ctx, 'deployment_incomplete', ['payload', field], `Deployment evidence needs ${field}`)
        }
      }
      if (!value.sourceRevision) {
        addDeliveryIssue(ctx, 'deployment_incomplete', ['sourceRevision'], 'Deployment evidence needs the deployed revision')
      }
      if (typeof url === 'string' && url.trim().length > 0 && !isPlainHttpUrl(url)) {
        addDeliveryIssue(ctx, 'deployment_incomplete', ['payload', 'url'], 'Deployment url must be an http(s) URL without credentials')
      }
    }
  })
export type RecordEvidenceInput = z.infer<typeof recordEvidenceSchema>

export type ParseRecordEvidenceResult =
  | { ok: true; data: RecordEvidenceInput }
  | ({ ok: false } & DeliveryErrorResult)

function isRecordableEvidenceKind(value: unknown): value is RecordableEvidenceKind {
  return typeof value === 'string' && (RECORDABLE_EVIDENCE_KINDS as readonly string[]).includes(value)
}

export function parseRecordEvidenceBody(input: unknown): ParseRecordEvidenceResult {
  const kind = typeof input === 'object' && input !== null && 'kind' in input ? input.kind : undefined
  if (typeof kind === 'string' && !isRecordableEvidenceKind(kind)) {
    return {
      ok: false,
      ...buildDeliveryError('unsupported_evidence_kind', 'Unsupported evidence kind', [
        {
          path: 'kind',
          code: 'unsupported_evidence_kind',
          message: `Received ${kind.slice(0, 100)}; supported: ${RECORDABLE_EVIDENCE_KINDS.join(', ')}`,
        },
      ]),
    }
  }
  const parsed = recordEvidenceSchema.safeParse(input)
  if (!parsed.success) return { ok: false, ...deliveryErrorFromZod(parsed.error) }
  return { ok: true, data: parsed.data }
}

export const cancelAttemptSchema = z.object({
  reason: reasonSchema.optional(),
})
export type CancelAttemptInput = z.infer<typeof cancelAttemptSchema>

export const cancelAttemptCommandSchema = cancelAttemptSchema.extend({
  taskId: uuidSchema,
  attemptId: uuidSchema,
})
export type CancelAttemptCommandInput = z.infer<typeof cancelAttemptCommandSchema>

const reconcileAttemptShape = {
  resolution: reconciliationResolutionSchema,
  externalEvidence: z.object({
    note: z.string().trim().min(1).max(4000),
    observedAt: isoDateTimeSchema,
    externalRunId: z.string().min(1).max(200).optional(),
  }),
  manifest: manifestBodySchema.optional(),
}

function requireCompletedManifest(value: { resolution: string; manifest?: unknown }, ctx: z.RefinementCtx): void {
  if (value.resolution === 'completed' && !value.manifest) {
    addDeliveryIssue(ctx, 'manifest_required', ['manifest'], 'Resolution completed needs the result manifest')
  }
}

export const reconcileAttemptSchema = z.object(reconcileAttemptShape).superRefine(requireCompletedManifest)
export type ReconcileAttemptInput = z.infer<typeof reconcileAttemptSchema>

export const reconcileAttemptCommandSchema = z
  .object({
    ...reconcileAttemptShape,
    taskId: uuidSchema,
    attemptId: uuidSchema,
    trustedExecution: trustedExecutionSchema.optional(),
  })
  .superRefine(requireCompletedManifest)
export type ReconcileAttemptCommandInput = z.infer<typeof reconcileAttemptCommandSchema>

export const deployDecisionSchema = z
  .object({
    baselineId: uuidSchema,
    sourceRevision: sourceRevisionSchema,
    verdict: decisionVerdictSchema,
    reason: reasonSchema.nullable().optional(),
  })
  .superRefine(requireReasonWhenRejected)
export type DeployDecisionInput = z.infer<typeof deployDecisionSchema>

export const releaseDecisionSchema = z
  .object({
    deploymentEvidenceId: uuidSchema,
    verdict: decisionVerdictSchema,
    reason: reasonSchema.nullable().optional(),
  })
  .superRefine(requireReasonWhenRejected)
export type ReleaseDecisionInput = z.infer<typeof releaseDecisionSchema>
