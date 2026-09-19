import { z } from 'zod'
import { MAX_CANONICAL_DEPTH, SHA256_HEX_PATTERN } from './canonicalConstants'

export const DELIVERY_CONTRACT_VERSION = 1

export const DELIVERY_SCHEMA_VERSIONS = {
  taskPackage: 'delivery.task-package/v1',
  resultManifest: 'delivery.result-manifest/v1',
  baselineContent: 'delivery.baseline-content/v1',
  requirementsProposal: 'delivery.requirements-proposal/v1',
  planProposal: 'delivery.plan-proposal/v1',
  designManifest: 'delivery.design-manifest/v1',
  report: 'delivery.report/v1',
  executionWidgetContext: 'delivery_os.project.execution.v1',
} as const

export const DELIVERY_EXECUTION_SPOT_ID = 'delivery_os.project.execution'
export const DELIVERY_EXECUTION_CONTEXT_CONTRACT = DELIVERY_SCHEMA_VERSIONS.executionWidgetContext

export const MAX_EXECUTION_ATTEMPTS = 16

export const MAX_PLAN_PROPOSAL_TASKS = 100

export const deliveryErrorCodes = {
  validation_failed: 400,
  idempotency_key_required: 400,
  forbidden: 403,
  not_found: 404,
  attempt_not_found: 404,
  optimistic_lock_conflict: 409,
  idempotency_conflict: 409,
  attempt_active: 409,
  attempt_limit_reached: 409,
  attempt_not_active: 409,
  attempt_not_reconcilable: 409,
  attempt_cancelled: 409,
  attempt_closed: 409,
  reconciliation_required: 409,
  dependency_not_verified: 409,
  task_not_ready: 409,
  invalid_transition: 409,
  result_conflict: 409,
  subject_hash_mismatch: 409,
  correction_limit_reached: 409,
  payload_too_large: 413,
  unsupported_schema_version: 422,
  unknown_target_profile: 422,
  foreign_reference: 422,
  unknown_ac: 422,
  unknown_test_id: 422,
  cycle: 422,
  foreign_dependency: 422,
  path_not_allowed: 422,
  duplicate_stable_id: 422,
  invalid_comment_anchor: 422,
  missing_acceptance_criteria: 422,
  missing_render: 422,
  temporary_url_only: 422,
  missing_required_tests: 422,
  attachment_scope_mismatch: 422,
  attachment_hash_mismatch: 422,
  hash_mismatch: 422,
  baseline_not_approved: 422,
  baseline_not_active: 422,
  correlation_mismatch: 422,
  baseline_mismatch: 422,
  base_revision_mismatch: 422,
  revision_kind_mismatch: 422,
  manifest_required: 422,
  reason_required: 422,
  report_not_green: 422,
  deployment_unverified: 422,
  deployment_incomplete: 422,
  revision_mismatch: 422,
  deploy_decision_missing: 422,
  invalid_revision: 422,
  unsupported_evidence_kind: 422,
  optimistic_lock_required: 428,
} as const

export type DeliveryErrorCode = keyof typeof deliveryErrorCodes

const deliveryErrorCodeList = Object.keys(deliveryErrorCodes) as [DeliveryErrorCode, ...DeliveryErrorCode[]]

export const deliveryErrorCodeSchema = z.enum(deliveryErrorCodeList)

export const deliveryErrorDetailSchema = z.object({
  path: z.string().optional(),
  code: z.string().min(1),
  message: z.string().optional(),
})
export type DeliveryErrorDetail = z.infer<typeof deliveryErrorDetailSchema>

export const deliveryErrorBodySchema = z.object({
  error: z.string().min(1),
  code: deliveryErrorCodeSchema,
  details: z.array(deliveryErrorDetailSchema),
})
export type DeliveryErrorBody = z.infer<typeof deliveryErrorBodySchema>

export type DeliveryErrorResult = { status: number; body: DeliveryErrorBody }

export type DeliveryCheckResult = { ok: true } | ({ ok: false } & DeliveryErrorResult)

export function buildDeliveryError(
  code: DeliveryErrorCode,
  error: string,
  details: DeliveryErrorDetail[] = [],
): DeliveryErrorResult {
  return { status: deliveryErrorCodes[code], body: { error, code, details } }
}

function isDeliveryErrorCode(value: unknown): value is DeliveryErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(deliveryErrorCodes, value)
}

export function addDeliveryIssue(
  ctx: z.RefinementCtx,
  deliveryCode: DeliveryErrorCode,
  path: PropertyKey[],
  message: string,
): void {
  ctx.addIssue({ code: 'custom', message, path, params: { deliveryCode } })
}

function readDeliveryCode(issue: z.core.$ZodIssue): DeliveryErrorCode | null {
  if (issue.code !== 'custom') return null
  const candidate = issue.params?.deliveryCode
  return isDeliveryErrorCode(candidate) ? candidate : null
}

export function deliveryErrorFromZod(error: z.ZodError): DeliveryErrorResult {
  const details = error.issues.map((issue) => {
    const path = issue.path.map((segment) => String(segment)).join('.')
    const detail: DeliveryErrorDetail = { code: readDeliveryCode(issue) ?? issue.code, message: issue.message }
    return path.length > 0 ? { path, ...detail } : detail
  })
  const hasShapeIssue = error.issues.some((issue) => readDeliveryCode(issue) === null)
  const firstIssue = error.issues[0]
  const firstCode = firstIssue ? readDeliveryCode(firstIssue) : null
  if (hasShapeIssue || !firstIssue || !firstCode) {
    return buildDeliveryError('validation_failed', 'Validation failed', details)
  }
  return buildDeliveryError(firstCode, firstIssue.message, details)
}

export const taskStatusSchema = z.enum([
  'draft',
  'ready',
  'executing',
  'awaiting_review',
  'changes_requested',
  'verified',
  'blocked',
  'cancelled',
])
export type TaskStatus = z.infer<typeof taskStatusSchema>

export const USER_SETTABLE_TASK_STATUSES: readonly TaskStatus[] = ['draft', 'ready', 'blocked', 'cancelled']

export const TASK_STATUS_REASONS = ['reconciliation_required', 'dependency_blocked', 'correction_limit_reached'] as const
export type TaskStatusReason = (typeof TASK_STATUS_REASONS)[number]

export const uuidSchema = z.uuid()
export const sha256Schema = z.string().regex(SHA256_HEX_PATTERN)
const commitShaSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)
export const isoDateTimeSchema = z.iso.datetime({ offset: true })
export const stableIdSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9._-]{0,63}$/)
const testIdSchema = z.string().min(1).max(512)
const shortTextSchema = z.string().min(1).max(300)
const longTextSchema = z.string().max(8000)
export const idempotencyKeySchema = z.string().regex(/^[\x21-\x7E]{1,200}$/)

export const repoRelativePathSchema = z
  .string()
  .min(1)
  .max(512)
  .superRefine((value, ctx) => {
    const isAbsolute = value.startsWith('/') || value.startsWith('~') || /^[A-Za-z]:/.test(value)
    const hasForbiddenCharacter = value.includes('\\') || /[\x00-\x1f]/.test(value) || value !== value.trim()
    const hasTraversal = value.split('/').some((segment) => segment === '..' || segment === '.' || segment === '')
    if (isAbsolute || hasForbiddenCharacter || hasTraversal) {
      addDeliveryIssue(ctx, 'path_not_allowed', [], 'Path must be repository-relative without parent segments')
    }
  })

export const sourceRevisionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('git'), commitSha: commitShaSchema }),
  z.strictObject({
    kind: z.literal('snapshot'),
    contentHash: sha256Schema,
    externalWorkspaceId: z.string().min(1).max(200),
  }),
])
export type SourceRevision = z.infer<typeof sourceRevisionSchema>

function checkRevisionCommit(
  ctx: z.RefinementCtx,
  revision: SourceRevision,
  commit: string | null | undefined,
  commitField: string,
): void {
  const hasCommit = typeof commit === 'string'
  if (revision.kind === 'git' && !hasCommit) {
    addDeliveryIssue(ctx, 'revision_kind_mismatch', [commitField], `${commitField} is required for a git revision`)
    return
  }
  if (revision.kind === 'git' && commit !== revision.commitSha) {
    addDeliveryIssue(ctx, 'revision_kind_mismatch', [commitField], `${commitField} must equal the revision commitSha`)
    return
  }
  if (revision.kind === 'snapshot' && hasCommit) {
    addDeliveryIssue(ctx, 'revision_kind_mismatch', [commitField], `${commitField} must be absent for a snapshot revision`)
  }
}

export function isSameRevision(first: SourceRevision, second: SourceRevision): boolean {
  if (first.kind === 'git' && second.kind === 'git') return first.commitSha === second.commitSha
  if (first.kind === 'snapshot' && second.kind === 'snapshot') {
    return first.contentHash === second.contentHash && first.externalWorkspaceId === second.externalWorkspaceId
  }
  return false
}

export function checkUniqueIds(ctx: z.RefinementCtx, ids: string[], field: string, idField: string): void {
  const seen = new Set<string>()
  ids.forEach((id, index) => {
    if (seen.has(id)) addDeliveryIssue(ctx, 'duplicate_stable_id', [field, index, idField], `Duplicate id ${id}`)
    seen.add(id)
  })
}

function checkKnownAcKeys(ctx: z.RefinementCtx, keys: string[], knownAcIds: Set<string>, path: string[]): void {
  for (const acId of keys) {
    if (!knownAcIds.has(acId)) addDeliveryIssue(ctx, 'unknown_ac', [...path, acId], `Unknown acceptance criterion ${acId}`)
  }
}

export const requirementSchema = z.object({
  id: stableIdSchema,
  title: shortTextSchema,
  description: longTextSchema.optional(),
})
export type Requirement = z.infer<typeof requirementSchema>

export const acceptanceCriterionSchema = z.object({
  id: stableIdSchema,
  requirementId: stableIdSchema,
  description: z.string().min(1).max(2000),
})
export type AcceptanceCriterion = z.infer<typeof acceptanceCriterionSchema>

function checkRequirementsAndCriteria(
  ctx: z.RefinementCtx,
  requirements: Requirement[],
  acceptanceCriteria: AcceptanceCriterion[],
): void {
  checkUniqueIds(ctx, requirements.map((requirement) => requirement.id), 'requirements', 'id')
  checkUniqueIds(ctx, acceptanceCriteria.map((criterion) => criterion.id), 'acceptanceCriteria', 'id')
  const requirementIds = new Set(requirements.map((requirement) => requirement.id))
  acceptanceCriteria.forEach((criterion, index) => {
    if (!requirementIds.has(criterion.requirementId)) {
      addDeliveryIssue(
        ctx,
        'foreign_reference',
        ['acceptanceCriteria', index, 'requirementId'],
        `Unknown requirement ${criterion.requirementId}`,
      )
    }
  })
}

const storedFileFactsShape = {
  sizeBytes: z.number().int().min(0).optional(),
  mimeType: z.string().min(1).max(200).optional(),
}

const viewportSchema = z.object({
  width: z.number().int().positive().max(16384),
  height: z.number().int().positive().max(16384),
})

export const designScreenSchema = z.object({
  fileKey: z.string().min(1).max(200),
  nodeId: z.string().min(1).max(200),
  name: shortTextSchema,
  viewport: viewportSchema,
  attachmentId: uuidSchema,
  sha256: sha256Schema,
  capturedAt: isoDateTimeSchema,
  figmaVersion: z.string().min(1).max(200).optional(),
  ...storedFileFactsShape,
})
export type DesignScreen = z.infer<typeof designScreenSchema>

export const screenRefSchema = designScreenSchema.extend({
  fileKey: z.string().min(1).max(200).nullable(),
  nodeId: z.string().min(1).max(200).nullable(),
})
export type ScreenRef = z.infer<typeof screenRefSchema>

const designTokensSchema = z.record(z.string().min(1).max(200), z.json())

export const attachmentRefSchema = z.object({ attachmentId: uuidSchema, sha256: sha256Schema, ...storedFileFactsShape })
export type AttachmentRef = z.infer<typeof attachmentRefSchema>

const acTestMapSchema = z.record(stableIdSchema, z.array(testIdSchema).max(200))

export const declaredTestSchema = z.object({ testId: testIdSchema, file: repoRelativePathSchema })
export type DeclaredTest = z.infer<typeof declaredTestSchema>

export const deliveryLimitsSchema = z.object({
  maxParallelTasks: z.number().int().min(1).max(8),
  maxCorrectionRounds: z.number().int().min(0).max(10),
  attemptTimeoutMinutes: z.number().int().min(1).max(240),
})
export type DeliveryLimits = z.infer<typeof deliveryLimitsSchema>

export const DEFAULT_DELIVERY_LIMITS: DeliveryLimits = {
  maxParallelTasks: 2,
  maxCorrectionRounds: 2,
  attemptTimeoutMinutes: 20,
}

export const validationCheckDefinitionSchema = z.object({
  checkId: stableIdSchema,
  commandProfileId: stableIdSchema,
  kind: z.enum(['test', 'build', 'typecheck', 'lint', 'scan']),
  required: z.boolean(),
})

export const validationProfileSchema = z.object({
  version: z.number().int().positive(),
  requiredTests: acTestMapSchema,
  checks: z.array(validationCheckDefinitionSchema).max(50),
})
export type ValidationProfile = z.infer<typeof validationProfileSchema>

export const taskPackageV1Schema = z
  .object({
    schemaVersion: z.literal(DELIVERY_SCHEMA_VERSIONS.taskPackage),
    projectId: uuidSchema,
    taskId: uuidSchema,
    attemptId: uuidSchema,
    baselineId: uuidSchema,
    baselineHash: sha256Schema,
    targetProfileId: stableIdSchema,
    targetProfileVersion: z.number().int().positive(),
    title: shortTextSchema,
    description: longTextSchema.optional(),
    requirements: z.array(requirementSchema).max(200),
    acceptanceCriteria: z.array(acceptanceCriterionSchema).min(1).max(200),
    designArtifactRefs: z.array(screenRefSchema).max(100),
    repositoryRef: z.string().min(1).max(200).nullable(),
    baseRevision: sourceRevisionSchema,
    baseCommit: commitShaSchema.optional(),
    allowedPaths: z.array(repoRelativePathSchema).max(200),
    validationProfile: validationProfileSchema,
    limits: deliveryLimitsSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .superRefine((value, ctx) => {
    checkRevisionCommit(ctx, value.baseRevision, value.baseCommit, 'baseCommit')
    checkRequirementsAndCriteria(ctx, value.requirements, value.acceptanceCriteria)
    const acIds = new Set(value.acceptanceCriteria.map((criterion) => criterion.id))
    checkKnownAcKeys(ctx, Object.keys(value.validationProfile.requiredTests), acIds, ['validationProfile', 'requiredTests'])
  })
export type TaskPackageV1 = z.infer<typeof taskPackageV1Schema>

export const checkStatusSchema = z.enum(['passed', 'failed', 'not_run'])
export type CheckStatus = z.infer<typeof checkStatusSchema>

export const resultCheckSchema = z.object({
  checkId: stableIdSchema,
  testId: testIdSchema,
  acIds: z.array(stableIdSchema).max(50),
  commandProfileId: stableIdSchema,
  validationProfileVersion: z.number().int().positive(),
  testDefinitionHash: sha256Schema,
  status: checkStatusSchema,
  exitCode: z.number().int().nullable(),
  durationMs: z.number().int().min(0),
  sourceRevision: sourceRevisionSchema,
  rawReportHash: sha256Schema,
})
export type ResultCheck = z.infer<typeof resultCheckSchema>

export const resultArtifactSchema = z.object({
  path: repoRelativePathSchema,
  sha256: sha256Schema,
  attachmentId: uuidSchema.optional(),
  sizeBytes: z.number().int().min(0).optional(),
})

export const agentDeclarationSchema = z.object({
  summary: longTextSchema,
  claimedAcIds: z.array(stableIdSchema).max(200),
  notes: longTextSchema.optional(),
})
export type AgentDeclaration = z.infer<typeof agentDeclarationSchema>

export const resultFindingSchema = z.object({
  severity: z.enum(['info', 'warning', 'error']),
  message: z.string().min(1).max(2000),
  path: repoRelativePathSchema.optional(),
  acId: stableIdSchema.optional(),
})

const usageValuesSchema = z
  .object({
    inputTokens: z.number().int().min(0).optional(),
    outputTokens: z.number().int().min(0).optional(),
    totalTokens: z.number().int().min(0).optional(),
    costUsd: z.number().min(0).optional(),
  })
  .refine((values) => Object.values(values).some((entry) => typeof entry === 'number'), {
    message: 'Provide at least one measured value or use "unknown"',
  })

export const usageSchema = z.object({
  source: z.enum(['runner', 'provider', 'subscription', 'manual']),
  values: z.union([z.literal('unknown'), usageValuesSchema]),
})
export type DeliveryUsage = z.infer<typeof usageSchema>

export const resultManifestV1Schema = z
  .object({
    schemaVersion: z.literal(DELIVERY_SCHEMA_VERSIONS.resultManifest),
    projectId: uuidSchema,
    taskId: uuidSchema,
    attemptId: uuidSchema,
    baselineId: uuidSchema,
    baselineHash: sha256Schema,
    targetProfileVersion: z.number().int().positive(),
    externalRunId: z.string().min(1).max(200),
    baseRevision: sourceRevisionSchema,
    resultRevision: sourceRevisionSchema,
    baseCommit: commitShaSchema.optional(),
    resultCommit: commitShaSchema.optional(),
    changedPaths: z.array(repoRelativePathSchema).max(2000),
    artifacts: z.array(resultArtifactSchema).max(200),
    checks: z.array(resultCheckSchema).max(1000),
    agentDeclaration: agentDeclarationSchema.optional(),
    findings: z.array(resultFindingSchema).max(500),
    usage: usageSchema,
  })
  .superRefine((value, ctx) => {
    if (value.baseRevision.kind !== value.resultRevision.kind) {
      addDeliveryIssue(ctx, 'revision_kind_mismatch', ['resultRevision', 'kind'], 'Base and result revision kinds differ')
    }
    checkRevisionCommit(ctx, value.baseRevision, value.baseCommit, 'baseCommit')
    checkRevisionCommit(ctx, value.resultRevision, value.resultCommit, 'resultCommit')
    checkUniqueIds(ctx, value.checks.map((check) => check.checkId), 'checks', 'checkId')
    value.checks.forEach((check, index) => {
      if (!isSameRevision(check.sourceRevision, value.resultRevision)) {
        addDeliveryIssue(ctx, 'revision_mismatch', ['checks', index, 'sourceRevision'], 'Check ran on another revision than the result')
      }
    })
  })
export type ResultManifestV1 = z.infer<typeof resultManifestV1Schema>

export const commentAnchorSchema = z.object({ x: z.number(), y: z.number() }).superRefine((value, ctx) => {
  const isInside = (coordinate: number) => coordinate >= 0 && coordinate <= 1
  if (!isInside(value.x) || !isInside(value.y)) {
    addDeliveryIssue(ctx, 'invalid_comment_anchor', [], 'Anchor coordinates must be between 0 and 1')
  }
})

export const resolvedCommentSchema = z.object({
  id: stableIdSchema,
  screenAttachmentId: uuidSchema.nullable(),
  anchor: commentAnchorSchema.nullable(),
  body: z.string().min(1).max(4000),
  resolution: z.string().min(1).max(4000),
})

const manifestIdSchema = z.string().regex(/^[\x21-\x7E]{1,200}$/)

export const importedManifestSchema = z.object({ manifestId: manifestIdSchema, manifestHash: sha256Schema })
export type ImportedManifest = z.infer<typeof importedManifestSchema>

export const baselineContentV1Schema = z
  .object({
    schemaVersion: z.literal(DELIVERY_SCHEMA_VERSIONS.baselineContent),
    requirements: z.array(requirementSchema).max(200),
    acceptanceCriteria: z.array(acceptanceCriterionSchema).max(500),
    screens: z.array(screenRefSchema).max(100),
    tokens: designTokensSchema,
    architectureSummary: longTextSchema.nullable(),
    planSummary: longTextSchema.nullable(),
    acTestMap: acTestMapSchema,
    manualChecks: z.record(stableIdSchema, stableIdSchema),
    declaredTests: z.array(declaredTestSchema).max(1000),
    attachments: z.array(attachmentRefSchema).max(200),
    resolvedComments: z.array(resolvedCommentSchema).max(500),
    importedManifestHashes: z.array(sha256Schema).max(50),
    importedManifests: z.array(importedManifestSchema).max(50).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.acceptanceCriteria.length === 0) {
      addDeliveryIssue(ctx, 'missing_acceptance_criteria', ['acceptanceCriteria'], 'A baseline needs acceptance criteria')
    }
    checkRequirementsAndCriteria(ctx, value.requirements, value.acceptanceCriteria)
    const acIds = new Set(value.acceptanceCriteria.map((criterion) => criterion.id))
    checkKnownAcKeys(ctx, Object.keys(value.acTestMap), acIds, ['acTestMap'])
    checkKnownAcKeys(ctx, Object.keys(value.manualChecks), acIds, ['manualChecks'])
    checkUniqueIds(ctx, value.declaredTests.map((test) => test.testId), 'declaredTests', 'testId')
  })
export type BaselineContentV1 = z.infer<typeof baselineContentV1Schema>

const producedBySchema = z.object({
  tool: z.string().min(1).max(200),
  sessionRef: z.string().min(1).max(500).nullable(),
})

export const proposalQuestionSchema = z.object({
  id: stableIdSchema,
  text: z.string().min(1).max(2000),
  answer: z.string().max(4000).optional(),
})

export const proposalRiskSchema = z.object({
  id: stableIdSchema,
  text: z.string().min(1).max(2000),
  mitigation: z.string().max(4000).optional(),
})

export const requirementsProposalV1Schema = z
  .object({
    schemaVersion: z.literal(DELIVERY_SCHEMA_VERSIONS.requirementsProposal),
    projectId: uuidSchema,
    manifestId: manifestIdSchema,
    requirements: z.array(requirementSchema).min(1).max(200),
    acceptanceCriteria: z.array(acceptanceCriterionSchema).max(500),
    questions: z.array(proposalQuestionSchema).max(200),
    risks: z.array(proposalRiskSchema).max(200),
    producedBy: producedBySchema,
  })
  .superRefine((value, ctx) => {
    checkRequirementsAndCriteria(ctx, value.requirements, value.acceptanceCriteria)
    checkUniqueIds(ctx, value.questions.map((question) => question.id), 'questions', 'id')
    checkUniqueIds(ctx, value.risks.map((risk) => risk.id), 'risks', 'id')
  })
export type RequirementsProposalV1 = z.infer<typeof requirementsProposalV1Schema>

export const planProposalTaskSchema = z.object({
  proposalTaskKey: stableIdSchema,
  title: shortTextSchema,
  description: longTextSchema,
  acIds: z.array(stableIdSchema).min(1).max(50),
  dependsOn: z.array(stableIdSchema).max(50),
  allowedPaths: z.array(repoRelativePathSchema).min(1).max(200),
})
export type PlanProposalTask = z.infer<typeof planProposalTaskSchema>

export const planProposalV1Schema = z
  .object({
    schemaVersion: z.literal(DELIVERY_SCHEMA_VERSIONS.planProposal),
    projectId: uuidSchema,
    baselineId: uuidSchema,
    baselineHash: sha256Schema,
    manifestId: manifestIdSchema,
    architectureSummary: longTextSchema,
    tasks: z.array(planProposalTaskSchema).min(1).max(MAX_PLAN_PROPOSAL_TASKS),
    acTestMap: acTestMapSchema,
    declaredTests: z.array(declaredTestSchema).max(1000),
    producedBy: producedBySchema.optional(),
  })
  .superRefine((value, ctx) => {
    checkUniqueIds(ctx, value.tasks.map((task) => task.proposalTaskKey), 'tasks', 'proposalTaskKey')
    checkUniqueIds(ctx, value.declaredTests.map((test) => test.testId), 'declaredTests', 'testId')
    const taskKeys = new Set(value.tasks.map((task) => task.proposalTaskKey))
    value.tasks.forEach((task, taskIndex) => {
      task.dependsOn.forEach((dependency, dependencyIndex) => {
        const path = ['tasks', taskIndex, 'dependsOn', dependencyIndex]
        if (dependency === task.proposalTaskKey) {
          addDeliveryIssue(ctx, 'cycle', path, `Task ${task.proposalTaskKey} depends on itself`)
        } else if (!taskKeys.has(dependency)) {
          addDeliveryIssue(ctx, 'foreign_dependency', path, `Unknown task ${dependency}`)
        }
      })
    })
  })
export type PlanProposalV1 = z.infer<typeof planProposalV1Schema>

export const designManifestV1Schema = z.object({
  schemaVersion: z.literal(DELIVERY_SCHEMA_VERSIONS.designManifest),
  screens: z.array(designScreenSchema).min(1).max(100),
  tokens: designTokensSchema,
  producedBy: producedBySchema.optional(),
})
export type DesignManifestV1 = z.infer<typeof designManifestV1Schema>

export const attemptModeSchema = z.enum(['manual_handoff', 'automatic'])
export type AttemptMode = z.infer<typeof attemptModeSchema>

export const attemptStateSchema = z.enum([
  'reserved',
  'claimed',
  'result_received',
  'cancel_requested',
  'reconciliation_required',
  'closed',
])
export type AttemptState = z.infer<typeof attemptStateSchema>

export const ACTIVE_ATTEMPT_STATES: readonly AttemptState[] = ['reserved', 'claimed', 'cancel_requested']

export const reconciliationResolutionSchema = z.enum(['not_started', 'stopped', 'completed', 'unknown'])
export type ReconciliationResolution = z.infer<typeof reconciliationResolutionSchema>

export const attemptReconciliationSchema = z.object({
  resolution: reconciliationResolutionSchema,
  note: z.string().min(1).max(4000),
  observedAt: isoDateTimeSchema,
  actorUserId: uuidSchema,
  resolvedAt: isoDateTimeSchema,
})

export const executionAttemptSchema = z
  .object({
    attemptId: uuidSchema,
    idempotencyKey: idempotencyKeySchema,
    payloadHash: sha256Schema,
    mode: attemptModeSchema,
    state: attemptStateSchema,
    baselineId: uuidSchema,
    baselineHash: sha256Schema,
    baseRevision: sourceRevisionSchema,
    baseCommit: commitShaSchema.nullable(),
    reservedAt: isoDateTimeSchema,
    claimedAt: isoDateTimeSchema.nullable(),
    workerRef: z.string().min(1).max(200).nullable(),
    externalRunId: z.string().min(1).max(200).nullable(),
    workflowRef: z.string().min(1).max(200).nullable(),
    workflowStepId: z.string().min(1).max(200).nullable(),
    dispatchedAt: isoDateTimeSchema.nullable(),
    cancellationRequestedAt: isoDateTimeSchema.nullable(),
    stopConfirmation: z.enum(['stop_unconfirmed', 'stopped']).nullable(),
    reconciliation: attemptReconciliationSchema.nullable(),
    resultEvidenceId: uuidSchema.nullable(),
    completionDelivery: z.enum(['pending', 'delivered']).nullable(),
    lastDeliveryError: z.string().max(2000).nullable(),
    deliveryAttempts: z.number().int().min(0).optional(),
    closedAt: isoDateTimeSchema.nullable(),
    outcome: z.enum(['result_accepted', 'cancelled', 'not_started', 'stopped']).nullable(),
  })
  .superRefine((value, ctx) => {
    checkRevisionCommit(ctx, value.baseRevision, value.baseCommit, 'baseCommit')
  })
export type ExecutionAttempt = z.infer<typeof executionAttemptSchema>

export const executionAttemptsSchema = z.array(executionAttemptSchema).superRefine((attempts, ctx) => {
  if (attempts.length > MAX_EXECUTION_ATTEMPTS) {
    addDeliveryIssue(ctx, 'attempt_limit_reached', [], `At most ${MAX_EXECUTION_ATTEMPTS} attempts are recorded per task`)
  }
  const activeCount = attempts.filter((attempt) => ACTIVE_ATTEMPT_STATES.includes(attempt.state)).length
  if (activeCount > 1) addDeliveryIssue(ctx, 'attempt_active', [], 'Only one attempt can be active')
  const seenAttemptIds = new Set<string>()
  const seenKeys = new Set<string>()
  attempts.forEach((attempt, index) => {
    if (seenAttemptIds.has(attempt.attemptId)) {
      addDeliveryIssue(ctx, 'duplicate_stable_id', [index, 'attemptId'], 'Duplicate attemptId')
    }
    if (seenKeys.has(attempt.idempotencyKey)) {
      addDeliveryIssue(ctx, 'idempotency_conflict', [index, 'idempotencyKey'], 'Duplicate idempotencyKey')
    }
    seenAttemptIds.add(attempt.attemptId)
    seenKeys.add(attempt.idempotencyKey)
  })
})

export const deliveryEvidenceKindSchema = z.enum([
  'result_manifest',
  'test',
  'review',
  'screenshot',
  'deployment',
  'scan',
  'reference_material',
])
export type DeliveryEvidenceKind = z.infer<typeof deliveryEvidenceKindSchema>

export function buildPackageUrl(taskId: string, attemptId: string): string {
  return `/api/delivery_os/tasks/${encodeURIComponent(taskId)}/package?attemptId=${encodeURIComponent(attemptId)}`
}

export const reserveAttemptRequestSchema = z.object({
  mode: z.literal('manual_handoff'),
  baseRevision: sourceRevisionSchema,
})
export type ReserveAttemptRequest = z.infer<typeof reserveAttemptRequestSchema>

export const reserveAttemptResponseSchema = z
  .object({
    attemptId: uuidSchema,
    taskId: uuidSchema,
    baselineId: uuidSchema,
    baselineHash: sha256Schema,
    taskUpdatedAt: isoDateTimeSchema,
    packageUrl: z.string().min(1).max(500),
  })
  .superRefine((value, ctx) => {
    if (value.packageUrl !== buildPackageUrl(value.taskId, value.attemptId)) {
      addDeliveryIssue(ctx, 'correlation_mismatch', ['packageUrl'], 'packageUrl must point at this task and attempt')
    }
  })
export type ReserveAttemptResponse = z.infer<typeof reserveAttemptResponseSchema>

function callbackSchema<TCallback extends (...args: never[]) => unknown>() {
  return z.custom<TCallback>((value) => typeof value === 'function', { message: 'Expected a function' })
}

export const executionWidgetContextV1Schema = z.object({
  schemaVersion: z.literal(DELIVERY_SCHEMA_VERSIONS.executionWidgetContext),
  projectId: uuidSchema,
  taskId: uuidSchema.nullable(),
  baselineId: uuidSchema.nullable(),
  updatedAt: isoDateTimeSchema,
  retryLastMutation: callbackSchema<() => Promise<boolean>>(),
  refresh: callbackSchema<() => void | Promise<void>>(),
})
export type ExecutionWidgetContextV1 = z.infer<typeof executionWidgetContextV1Schema>

export const reportAcStatusSchema = z.enum(['passed', 'failed', 'not_run', 'missing', 'manual_pending'])
export type ReportAcStatus = z.infer<typeof reportAcStatusSchema>

export const reportTestStatusSchema = z.enum(['passed', 'failed', 'not_run', 'missing'])
export const reportManualCheckStatusSchema = z.enum(['approved', 'changes_requested', 'missing'])

export const reportScanStatusSchema = z.enum(['present', 'missing', 'failed'])
export type ReportScanStatus = z.infer<typeof reportScanStatusSchema>

export const reportDeploymentStatusSchema = z.enum(['verified', 'unverified', 'missing'])
export type ReportDeploymentStatus = z.infer<typeof reportDeploymentStatusSchema>

export const reportRevisionSourceSchema = z.enum(['selected', 'latest_result', 'none'])
export type ReportRevisionSource = z.infer<typeof reportRevisionSourceSchema>

export const reportGateBlockerSchema = z.object({
  kind: z.enum(['revision', 'ac', 'scan', 'deployment', 'deploy_decision']),
  id: z.string().min(1).max(512),
  status: z.string().min(1).max(64),
})
export type ReportGateBlocker = z.infer<typeof reportGateBlockerSchema>

export const reportGateSchema = z.object({ ok: z.boolean(), blocking: z.array(reportGateBlockerSchema).max(2000) })
export type ReportGate = z.infer<typeof reportGateSchema>

export const reportTestProofSchema = z.object({
  testId: testIdSchema,
  status: reportTestStatusSchema,
  evidenceId: uuidSchema.nullable(),
  rawReportHash: sha256Schema.nullable(),
})
export type ReportTestProof = z.infer<typeof reportTestProofSchema>

export const reportManualCheckProofSchema = z.object({
  manualCheckId: stableIdSchema,
  status: reportManualCheckStatusSchema,
  evidenceId: uuidSchema.nullable(),
})
export type ReportManualCheckProof = z.infer<typeof reportManualCheckProofSchema>

export const reportAcceptanceCriterionSchema = z.object({
  acId: stableIdSchema,
  requirementId: stableIdSchema,
  description: z.string(),
  status: reportAcStatusSchema,
  taskIds: z.array(uuidSchema).max(100),
  tests: z.array(reportTestProofSchema).max(200),
  manualCheck: reportManualCheckProofSchema.nullable(),
})
export type ReportAcceptanceCriterion = z.infer<typeof reportAcceptanceCriterionSchema>

export const deliveryReportRowSchema = z.object({
  requirementId: stableIdSchema.nullable(),
  acId: stableIdSchema.nullable(),
  acStatus: reportAcStatusSchema.nullable(),
  taskId: uuidSchema.nullable(),
  taskStatus: taskStatusSchema.nullable(),
  testId: testIdSchema.nullable(),
  testStatus: reportTestStatusSchema.nullable(),
  manualCheckId: stableIdSchema.nullable(),
  manualCheckStatus: reportManualCheckStatusSchema.nullable(),
  evidenceId: uuidSchema.nullable(),
  rawReportHash: sha256Schema.nullable(),
  deploymentEvidenceId: uuidSchema.nullable(),
})
export type DeliveryReportRow = z.infer<typeof deliveryReportRowSchema>

export const reportScanSchema = z.object({
  checkId: stableIdSchema,
  status: reportScanStatusSchema,
  reportedStatus: checkStatusSchema.nullable(),
  evidenceId: uuidSchema.nullable(),
  rawReportHash: sha256Schema.nullable(),
})
export type ReportScan = z.infer<typeof reportScanSchema>

export const reportDeploymentSchema = z.object({
  status: reportDeploymentStatusSchema,
  verificationStatus: z.enum(['verified', 'unverified', 'failed']).nullable(),
  evidenceId: uuidSchema.nullable(),
  url: z.string().max(2000).nullable(),
  environment: z.string().max(100).nullable(),
  buildId: z.string().max(200).nullable(),
})
export type ReportDeployment = z.infer<typeof reportDeploymentSchema>

export const reportDecisionSchema = z.object({
  id: uuidSchema,
  kind: z.enum(['requirements', 'design', 'deploy', 'release']),
  verdict: z.enum(['approved', 'rejected']),
  subjectType: z.enum(['baseline', 'deployment_evidence']),
  subjectId: uuidSchema,
  subjectHash: z.string().min(1).max(200),
  sourceRevision: sourceRevisionSchema.nullable(),
  decidedAt: isoDateTimeSchema,
  reason: z.string().max(2000).nullable(),
  appliesToRevision: z.boolean(),
})
export type ReportDecision = z.infer<typeof reportDecisionSchema>

export const reportProgressSchema = z.object({
  proven: z.number().int().min(0),
  total: z.number().int().min(0),
  unit: z.literal('ac'),
  percent: z.number().int().min(0).max(100).nullable(),
})

export const reportUsageSchema = usageSchema.extend({ evidenceId: uuidSchema })

export const deliveryReportV1Schema = z.object({
  schemaVersion: z.literal(DELIVERY_SCHEMA_VERSIONS.report),
  projectId: uuidSchema,
  baselineId: uuidSchema,
  baselineHash: sha256Schema,
  targetProfile: z.object({ id: z.string().min(1).max(64), version: z.number().int().positive() }),
  revision: sourceRevisionSchema.nullable(),
  revisionSource: reportRevisionSourceSchema,
  acceptanceCriteria: z.array(reportAcceptanceCriterionSchema).max(500),
  rows: z.array(deliveryReportRowSchema).max(1000),
  totalRows: z.number().int().min(0),
  truncated: z.boolean(),
  limit: z.number().int().min(1).max(1000),
  issues: z.array(z.object({ code: z.literal('unknown_ac'), taskId: uuidSchema, acId: z.string().min(1) })).max(1000),
  scans: z.array(reportScanSchema).max(50),
  deployment: reportDeploymentSchema,
  gates: z.object({ publishable: reportGateSchema, releasable: reportGateSchema }),
  decisions: z.array(reportDecisionSchema).max(1000),
  progress: reportProgressSchema,
  usage: z.array(reportUsageSchema).max(100),
})
export type DeliveryReportV1 = z.infer<typeof deliveryReportV1Schema>

export const deliveryDocumentSchemas = {
  [DELIVERY_SCHEMA_VERSIONS.taskPackage]: taskPackageV1Schema,
  [DELIVERY_SCHEMA_VERSIONS.resultManifest]: resultManifestV1Schema,
  [DELIVERY_SCHEMA_VERSIONS.baselineContent]: baselineContentV1Schema,
  [DELIVERY_SCHEMA_VERSIONS.requirementsProposal]: requirementsProposalV1Schema,
  [DELIVERY_SCHEMA_VERSIONS.planProposal]: planProposalV1Schema,
  [DELIVERY_SCHEMA_VERSIONS.designManifest]: designManifestV1Schema,
  [DELIVERY_SCHEMA_VERSIONS.report]: deliveryReportV1Schema,
} as const

export type VersionedSchemaMap = Record<string, z.ZodType>

export type ParseVersionedSuccess<TMap extends VersionedSchemaMap> = {
  [TVersion in keyof TMap & string]: { ok: true; schemaVersion: TVersion; data: z.output<TMap[TVersion]> }
}[keyof TMap & string]

export type ParseVersionedFailure = { ok: false } & DeliveryErrorResult

function readSchemaVersion(input: unknown): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined
  return 'schemaVersion' in input ? input.schemaVersion : undefined
}

function exceedsDepth(input: unknown, maxDepth: number): boolean {
  let level: unknown[] = [input]
  for (let depth = 0; level.length > 0; depth += 1) {
    if (depth > maxDepth) return true
    level = level.flatMap((entry) => (typeof entry === 'object' && entry !== null ? Object.values(entry) : []))
  }
  return false
}

export function parseVersioned<TMap extends VersionedSchemaMap>(
  schemaMap: TMap,
  input: unknown,
): ParseVersionedSuccess<TMap> | ParseVersionedFailure {
  const schemaVersion = readSchemaVersion(input)
  if (typeof schemaVersion !== 'string' || !Object.prototype.hasOwnProperty.call(schemaMap, schemaVersion)) {
    const supported = Object.keys(schemaMap).join(', ')
    const received = typeof schemaVersion === 'string' ? schemaVersion.slice(0, 100) : typeof schemaVersion
    return {
      ok: false,
      ...buildDeliveryError('unsupported_schema_version', 'Unsupported schema version', [
        { path: 'schemaVersion', code: 'unsupported_schema_version', message: `Received ${received}; supported: ${supported}` },
      ]),
    }
  }
  if (exceedsDepth(input, MAX_CANONICAL_DEPTH)) {
    return { ok: false, ...buildDeliveryError('payload_too_large', 'Document is nested too deeply') }
  }
  const parsed = schemaMap[schemaVersion].safeParse(input)
  if (!parsed.success) return { ok: false, ...deliveryErrorFromZod(parsed.error) }
  return { ok: true, schemaVersion, data: parsed.data } as ParseVersionedSuccess<TMap>
}

// ---------------------------------------------------------------------------
// Flow delta v1 (FLOW-F0) — additive on top of the frozen v1 contract above.
// Nothing above this line changes; every export below is new. Spec:
// `.ai/specs/2026-09-18-delivery-os-hackathon.md` § "Flow delta v1 (FLOW-F0)".
// ---------------------------------------------------------------------------

export const DELIVERY_FLOW_CONTRACT_VERSION = 1

export const DELIVERY_FLOW_SCHEMA_VERSIONS = {
  intake: 'delivery.intake/v1',
  scopingProposal: 'delivery.scoping-proposal/v1',
  flowTemplate: 'delivery.flow-template/v1',
  stageArtifact: 'delivery.stage-artifact/v1',
  commentImport: 'delivery.comment-import/v1',
  flowStatus: 'delivery.flow-status/v1',
  publicationResult: 'delivery.publication-result/v1',
} as const

export const deliveryFlowErrorCodes = {
  target_profile_frozen: 422,
  flow_already_pinned: 409,
  flow_not_pinned: 422,
  unknown_flow_template: 422,
  flow_template_hash_mismatch: 422,
  stage_unknown: 422,
  stage_not_approved: 422,
  stage_dependency_stale: 422,
  stage_artifact_stale: 409,
  client_approval_required: 422,
  blocking_comments_open: 422,
  staff_link_required: 422,
  intake_step_invalid: 422,
  sync_cursor_conflict: 409,
} as const

export type DeliveryFlowErrorCode = keyof typeof deliveryFlowErrorCodes

export const deliveryAllErrorCodes = { ...deliveryErrorCodes, ...deliveryFlowErrorCodes } as const
export type DeliveryAnyErrorCode = keyof typeof deliveryAllErrorCodes

const deliveryAllErrorCodeList = Object.keys(deliveryAllErrorCodes) as [DeliveryAnyErrorCode, ...DeliveryAnyErrorCode[]]

export const deliveryFlowErrorBodySchema = z.object({
  error: z.string().min(1),
  code: z.enum(deliveryAllErrorCodeList),
  details: z.array(deliveryErrorDetailSchema),
})
export type DeliveryFlowErrorBody = z.infer<typeof deliveryFlowErrorBodySchema>

export type DeliveryFlowErrorResult = { status: number; body: DeliveryFlowErrorBody }
export type DeliveryFlowCheckResult = { ok: true } | ({ ok: false } & DeliveryFlowErrorResult)

export function buildDeliveryFlowError(
  code: DeliveryAnyErrorCode,
  error: string,
  details: DeliveryErrorDetail[] = [],
): DeliveryFlowErrorResult {
  return { status: deliveryAllErrorCodes[code], body: { error, code, details } }
}

function isDeliveryAnyErrorCode(value: unknown): value is DeliveryAnyErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(deliveryAllErrorCodes, value)
}

export function addDeliveryFlowIssue(
  ctx: z.RefinementCtx,
  deliveryCode: DeliveryAnyErrorCode,
  path: PropertyKey[],
  message: string,
): void {
  ctx.addIssue({ code: 'custom', message, path, params: { deliveryCode } })
}

function readDeliveryAnyCode(issue: z.core.$ZodIssue): DeliveryAnyErrorCode | null {
  if (issue.code !== 'custom') return null
  const candidate = issue.params?.deliveryCode
  return isDeliveryAnyErrorCode(candidate) ? candidate : null
}

export function deliveryFlowErrorFromZod(error: z.ZodError): DeliveryFlowErrorResult {
  const details = error.issues.map((issue) => {
    const path = issue.path.map((segment) => String(segment)).join('.')
    const detail: DeliveryErrorDetail = { code: readDeliveryAnyCode(issue) ?? issue.code, message: issue.message }
    return path.length > 0 ? { path, ...detail } : detail
  })
  const hasShapeIssue = error.issues.some((issue) => readDeliveryAnyCode(issue) === null)
  const firstIssue = error.issues[0]
  const firstCode = firstIssue ? readDeliveryAnyCode(firstIssue) : null
  if (hasShapeIssue || !firstIssue || !firstCode) {
    return buildDeliveryFlowError('validation_failed', 'Validation failed', details)
  }
  return buildDeliveryFlowError(firstCode, firstIssue.message, details)
}

export type ParseFlowVersionedFailure = { ok: false } & DeliveryFlowErrorResult

export function parseFlowVersioned<TMap extends VersionedSchemaMap>(
  schemaMap: TMap,
  input: unknown,
): ParseVersionedSuccess<TMap> | ParseFlowVersionedFailure {
  const schemaVersion = readSchemaVersion(input)
  if (typeof schemaVersion !== 'string' || !Object.prototype.hasOwnProperty.call(schemaMap, schemaVersion)) {
    const supported = Object.keys(schemaMap).join(', ')
    const received = typeof schemaVersion === 'string' ? schemaVersion.slice(0, 100) : typeof schemaVersion
    return {
      ok: false,
      ...buildDeliveryFlowError('unsupported_schema_version', 'Unsupported schema version', [
        { path: 'schemaVersion', code: 'unsupported_schema_version', message: `Received ${received}; supported: ${supported}` },
      ]),
    }
  }
  if (exceedsDepth(input, MAX_CANONICAL_DEPTH)) {
    return { ok: false, ...buildDeliveryFlowError('payload_too_large', 'Document is nested too deeply') }
  }
  const parsed = schemaMap[schemaVersion].safeParse(input)
  if (!parsed.success) return { ok: false, ...deliveryFlowErrorFromZod(parsed.error) }
  return { ok: true, schemaVersion, data: parsed.data } as ParseVersionedSuccess<TMap>
}

// --- Stages and templates ---------------------------------------------------

export const FLOW_APPROVAL_STAGE_ORDER = ['scope', 'ux', 'key_visual', 'design_system_ui'] as const
export const flowStageIdSchema = z.enum(FLOW_APPROVAL_STAGE_ORDER)
export type FlowStageId = z.infer<typeof flowStageIdSchema>

export const flowTemplateStageKindSchema = z.enum([
  ...FLOW_APPROVAL_STAGE_ORDER,
  'implementation',
  'qa',
  'deploy',
  'release',
])
export type FlowTemplateStageKind = z.infer<typeof flowTemplateStageKindSchema>

export const flowTemplateExecutorSchema = z.object({
  kind: z.enum(['human', 'agent', 'adapter']),
  ref: stableIdSchema.nullable(),
})

export const flowTemplateConditionSchema = z.object({
  key: stableIdSchema,
  operator: z.enum(['equals', 'exists']),
  value: z.json().optional(),
})

export const flowTemplateStageSchema = z.object({
  stageId: stableIdSchema,
  kind: flowTemplateStageKindSchema,
  title: shortTextSchema,
  executor: flowTemplateExecutorSchema,
  approverFeatures: z.array(z.string().min(1).max(200)).max(20),
  requiresClientApproval: z.boolean(),
  dependsOn: z.array(stableIdSchema).max(20),
  conditions: z.array(flowTemplateConditionSchema).max(20),
})
export type FlowTemplateStage = z.infer<typeof flowTemplateStageSchema>

function findStageCycle(stages: readonly FlowTemplateStage[]): string[] | null {
  const edges = new Map(stages.map((stage) => [stage.stageId, stage.dependsOn]))
  const state = new Map<string, 'visiting' | 'done'>()
  const stack: string[] = []
  const visit = (stageId: string): string[] | null => {
    const current = state.get(stageId)
    if (current === 'done') return null
    if (current === 'visiting') return [...stack.slice(stack.indexOf(stageId)), stageId]
    state.set(stageId, 'visiting')
    stack.push(stageId)
    for (const dependency of edges.get(stageId) ?? []) {
      const cycle = visit(dependency)
      if (cycle) return cycle
    }
    stack.pop()
    state.set(stageId, 'done')
    return null
  }
  for (const stage of stages) {
    const cycle = visit(stage.stageId)
    if (cycle) return cycle
  }
  return null
}

export const flowTemplateV1Schema = z
  .object({
    schemaVersion: z.literal(DELIVERY_FLOW_SCHEMA_VERSIONS.flowTemplate),
    templateId: stableIdSchema,
    version: z.number().int().positive(),
    title: shortTextSchema,
    stages: z.array(flowTemplateStageSchema).min(1).max(30),
    approvalPolicy: z.object({
      rejectionReturnsTo: z.literal('stage_owner'),
      staleApprovalRequiresReapproval: z.literal(true),
    }),
  })
  .superRefine((template, ctx) => {
    checkUniqueIds(ctx, template.stages.map((stage) => stage.stageId), 'stages', 'stageId')
    const known = new Set(template.stages.map((stage) => stage.stageId))
    template.stages.forEach((stage, stageIndex) => {
      stage.dependsOn.forEach((dependency, dependencyIndex) => {
        if (!known.has(dependency)) {
          addDeliveryIssue(ctx, 'foreign_dependency', ['stages', stageIndex, 'dependsOn', dependencyIndex], `Unknown stage ${dependency}`)
        }
      })
    })
    const cycle = findStageCycle(template.stages)
    if (cycle) addDeliveryIssue(ctx, 'cycle', ['stages'], `Stage dependency cycle: ${cycle.join(' -> ')}`)
    for (const stageId of FLOW_APPROVAL_STAGE_ORDER) {
      const matching = template.stages.filter((stage) => stage.kind === stageId)
      if (matching.length !== 1) {
        addDeliveryFlowIssue(ctx, 'stage_unknown', ['stages'], `Template must have exactly one ${stageId} stage`)
      }
    }
    const approvalOrder = FLOW_APPROVAL_STAGE_ORDER as readonly string[]
    template.stages.forEach((stage, stageIndex) => {
      const isApprovalStage = approvalOrder.includes(stage.kind)
      if (isApprovalStage && stage.stageId !== stage.kind) {
        addDeliveryFlowIssue(ctx, 'stage_unknown', ['stages', stageIndex, 'stageId'], `Approval stage ${stage.kind} must use stageId ${stage.kind}`)
      }
      if (!isApprovalStage) return
      stage.dependsOn.forEach((dependency, dependencyIndex) => {
        if (approvalOrder.includes(dependency) && approvalOrder.indexOf(dependency) >= approvalOrder.indexOf(stage.kind)) {
          addDeliveryIssue(ctx, 'foreign_dependency', ['stages', stageIndex, 'dependsOn', dependencyIndex], `${dependency} is not upstream of ${stage.kind} in the approval order`)
        }
      })
    })
  })
export type FlowTemplateV1 = z.infer<typeof flowTemplateV1Schema>

export const flowTemplateRefSchema = z.object({
  templateId: stableIdSchema,
  version: z.number().int().positive(),
  hash: sha256Schema,
})
export type FlowTemplateRef = z.infer<typeof flowTemplateRefSchema>

export const flowPinRequestSchema = z.object({
  templateId: stableIdSchema,
  templateVersion: z.number().int().positive(),
})
export type FlowPinRequest = z.infer<typeof flowPinRequestSchema>

export const flowPinResponseSchema = z.object({
  projectId: uuidSchema,
  template: flowTemplateRefSchema,
  pinnedAt: isoDateTimeSchema,
  projectUpdatedAt: isoDateTimeSchema,
})
export type FlowPinResponse = z.infer<typeof flowPinResponseSchema>

export const flowInstanceLinkSchema = z.object({
  projectId: uuidSchema,
  workflowInstanceId: uuidSchema,
  definitionId: uuidSchema,
  workflowId: z.string().min(1).max(100),
  version: z.number().int().positive(),
})
export type FlowInstanceLink = z.infer<typeof flowInstanceLinkSchema>

// --- Intake (brief wizard + scoping) ----------------------------------------

export const intakeStepSchema = z.enum(['brief', 'scoping', 'platform', 'review', 'submitted'])
export type IntakeStep = z.infer<typeof intakeStepSchema>

const stringListSchema = z.array(shortTextSchema).max(100)

export const briefV1Schema = z.object({
  businessGoal: longTextSchema.nullable(),
  audience: longTextSchema.nullable(),
  problem: longTextSchema.nullable(),
  content: longTextSchema.nullable(),
  features: stringListSchema,
  integrations: stringListSchema,
  constraints: stringListSchema,
  inspirations: z.array(z.string().min(1).max(500)).max(50),
  materials: z.array(attachmentRefSchema).max(50),
  unknowns: stringListSchema,
})
export type BriefV1 = z.infer<typeof briefV1Schema>

export const intakeQuestionSchema = z.object({
  id: stableIdSchema,
  text: z.string().min(1).max(4000),
  askedBy: z.enum(['agent', 'human']),
  blocking: z.boolean(),
  answer: z.object({ text: z.string().min(1).max(8000), answeredAt: isoDateTimeSchema }).nullable(),
})
export type IntakeQuestion = z.infer<typeof intakeQuestionSchema>

export const platformProfileRefSchema = z.object({
  profileId: stableIdSchema,
  profileVersion: z.number().int().positive(),
})

export const platformRecommendationSchema = platformProfileRefSchema.extend({
  rationale: longTextSchema,
  alternatives: z.array(platformProfileRefSchema.extend({ reason: longTextSchema })).max(10),
})
export type PlatformRecommendation = z.infer<typeof platformRecommendationSchema>

export const platformChoiceSchema = platformProfileRefSchema.extend({
  chosenBy: uuidSchema,
  chosenAt: isoDateTimeSchema,
})
export type PlatformChoice = z.infer<typeof platformChoiceSchema>

export const toolChoiceSchema = z.object({
  stageId: stableIdSchema,
  kind: z.enum(['platform', 'design', 'execution', 'deploy']),
  ref: stableIdSchema,
  rationale: longTextSchema.nullable(),
})
export type ToolChoice = z.infer<typeof toolChoiceSchema>

export const intakeProposalRefSchema = z.object({
  proposalId: manifestIdSchema,
  kind: z.enum(['scope', 'platform']),
  contentHash: sha256Schema,
  proposedAt: isoDateTimeSchema,
  status: z.enum(['proposed', 'accepted', 'discarded']),
})

const intakeShape = {
  schemaVersion: z.literal(DELIVERY_FLOW_SCHEMA_VERSIONS.intake),
  projectId: uuidSchema,
  step: intakeStepSchema,
  brief: briefV1Schema,
  questions: z.array(intakeQuestionSchema).max(200),
  proposals: z.array(intakeProposalRefSchema).max(50),
  platform: z.object({
    recommendation: platformRecommendationSchema.nullable(),
    chosen: platformChoiceSchema.nullable(),
  }),
  tools: z.array(toolChoiceSchema).max(20),
}

type IntakeShapeInput = {
  questions: readonly IntakeQuestion[]
  proposals: readonly { proposalId: string }[]
  tools: readonly ToolChoice[]
}

function refineIntake(intake: IntakeShapeInput, ctx: z.RefinementCtx): void {
  checkUniqueIds(ctx, intake.questions.map((question) => question.id), 'questions', 'id')
  checkUniqueIds(ctx, intake.proposals.map((proposal) => proposal.proposalId), 'proposals', 'proposalId')
  checkUniqueIds(ctx, intake.tools.map((tool) => `${tool.stageId}:${tool.kind}`), 'tools', 'stageId')
}

export const intakeV1Schema = z.object(intakeShape).superRefine(refineIntake)
export type IntakeV1 = z.infer<typeof intakeV1Schema>

const { projectId: _intakeProjectId, proposals: _intakeProposals, ...intakeUpdateShape } = intakeShape
export const intakeUpdateRequestSchema = z
  .object(intakeUpdateShape)
  .superRefine((intake, ctx) => refineIntake({ ...intake, proposals: [] }, ctx))
export type IntakeUpdateRequest = z.infer<typeof intakeUpdateRequestSchema>

export const intakeResponseSchema = z.object({
  intake: intakeV1Schema,
  targetProfile: platformProfileRefSchema,
  updatedAt: isoDateTimeSchema,
})
export type IntakeResponse = z.infer<typeof intakeResponseSchema>

export const scopePageSchema = z.object({ id: stableIdSchema, title: shortTextSchema, purpose: longTextSchema.nullable() })
export const scopeKeyFlowSchema = z.object({ id: stableIdSchema, title: shortTextSchema, steps: z.array(shortTextSchema).max(30) })

export const scopeContentSchema = z
  .object({
    summary: longTextSchema,
    inScope: z.array(shortTextSchema).max(200),
    outOfScope: z.array(shortTextSchema).max(200),
    pages: z.array(scopePageSchema).max(100),
    keyFlows: z.array(scopeKeyFlowSchema).max(50),
    requirements: z.array(requirementSchema).max(200),
    acceptanceCriteria: z.array(acceptanceCriterionSchema).min(1).max(500),
    risks: z.array(proposalRiskSchema).max(100),
    assumptions: z.array(shortTextSchema).max(100),
    openQuestionIds: z.array(stableIdSchema).max(200),
    platform: platformProfileRefSchema.extend({ rationale: longTextSchema }),
    tools: z.array(toolChoiceSchema).max(20),
  })
  .superRefine((scope, ctx) => {
    checkRequirementsAndCriteria(ctx, scope.requirements, scope.acceptanceCriteria)
    checkUniqueIds(ctx, scope.pages.map((page) => page.id), 'pages', 'id')
    checkUniqueIds(ctx, scope.keyFlows.map((flow) => flow.id), 'keyFlows', 'id')
    checkUniqueIds(ctx, scope.risks.map((risk) => risk.id), 'risks', 'id')
  })
export type ScopeContent = z.infer<typeof scopeContentSchema>

export const scopingProposalV1Schema = z
  .object({
    schemaVersion: z.literal(DELIVERY_FLOW_SCHEMA_VERSIONS.scopingProposal),
    projectId: uuidSchema,
    manifestId: manifestIdSchema,
    kind: z.enum(['scope', 'platform']),
    questions: z.array(intakeQuestionSchema).max(100),
    scope: scopeContentSchema.nullable(),
    platform: platformRecommendationSchema.nullable(),
    producedBy: z.object({ tool: shortTextSchema, sessionRef: z.string().max(300).nullable() }),
  })
  .superRefine((proposal, ctx) => {
    checkUniqueIds(ctx, proposal.questions.map((question) => question.id), 'questions', 'id')
    if (proposal.kind === 'scope' && !proposal.scope) {
      addDeliveryIssue(ctx, 'manifest_required', ['scope'], 'A scope proposal must carry scope content')
    }
    if (proposal.kind === 'platform' && !proposal.platform) {
      addDeliveryIssue(ctx, 'manifest_required', ['platform'], 'A platform proposal must carry a recommendation')
    }
  })
export type ScopingProposalV1 = z.infer<typeof scopingProposalV1Schema>

export const scopingProposalImportResponseSchema = z.object({
  projectId: uuidSchema,
  manifestId: manifestIdSchema,
  manifestHash: sha256Schema,
  duplicate: z.boolean(),
  intakeUpdatedAt: isoDateTimeSchema,
})

// --- Stage artifacts and decisions -----------------------------------------

export const figmaRefSchema = z.object({
  fileKey: z.string().min(1).max(200),
  nodeId: z.string().min(1).max(200).nullable(),
  name: shortTextSchema,
  figmaVersion: z.string().min(1).max(200).nullable(),
  url: z.url().max(2000).nullable(),
})
export type FigmaRef = z.infer<typeof figmaRefSchema>

export const designStageContentSchema = z.object({
  summary: longTextSchema,
  figmaRefs: z.array(figmaRefSchema).max(100),
  screens: z.array(designScreenSchema).max(100),
  tokens: designTokensSchema.optional(),
  notes: longTextSchema.nullable(),
  resolvedThreadKeys: z.array(z.string().min(1).max(200)).max(500),
})
export type DesignStageContent = z.infer<typeof designStageContentSchema>

export const stageArtifactDependencySchema = z.object({
  stageId: flowStageIdSchema,
  artifactId: uuidSchema,
  version: z.number().int().positive(),
  contentHash: sha256Schema,
})
export type StageArtifactDependency = z.infer<typeof stageArtifactDependencySchema>

export const stageArtifactSourceSchema = z.enum(['manual', 'intake', 'agent', 'figma'])

const stageArtifactBaseShape = {
  schemaVersion: z.literal(DELIVERY_FLOW_SCHEMA_VERSIONS.stageArtifact),
  projectId: uuidSchema,
  source: stageArtifactSourceSchema,
  dependsOn: z.array(stageArtifactDependencySchema).max(3),
  attachments: z.array(attachmentRefSchema).max(100),
  producedBy: z.object({ tool: shortTextSchema, sessionRef: z.string().max(300).nullable() }).nullable(),
}

function checkStageDependencies(
  ctx: z.RefinementCtx,
  stageId: FlowStageId,
  dependsOn: readonly StageArtifactDependency[],
): void {
  const ownIndex = FLOW_APPROVAL_STAGE_ORDER.indexOf(stageId)
  checkUniqueIds(ctx, dependsOn.map((dependency) => dependency.stageId), 'dependsOn', 'stageId')
  dependsOn.forEach((dependency, index) => {
    if (FLOW_APPROVAL_STAGE_ORDER.indexOf(dependency.stageId) >= ownIndex) {
      addDeliveryIssue(ctx, 'foreign_dependency', ['dependsOn', index, 'stageId'], `${dependency.stageId} is not upstream of ${stageId}`)
    }
  })
}

export const stageArtifactV1Schema = z
  .discriminatedUnion('stageId', [
    z.object({ ...stageArtifactBaseShape, stageId: z.literal('scope'), content: scopeContentSchema }),
    z.object({ ...stageArtifactBaseShape, stageId: z.literal('ux'), content: designStageContentSchema }),
    z.object({ ...stageArtifactBaseShape, stageId: z.literal('key_visual'), content: designStageContentSchema }),
    z.object({ ...stageArtifactBaseShape, stageId: z.literal('design_system_ui'), content: designStageContentSchema }),
  ])
  .superRefine((artifact, ctx) => checkStageDependencies(ctx, artifact.stageId, artifact.dependsOn))
export type StageArtifactV1 = z.infer<typeof stageArtifactV1Schema>

export const stageArtifactRefSchema = z.object({
  artifactId: uuidSchema,
  version: z.number().int().positive(),
  contentHash: sha256Schema,
})
export type StageArtifactRef = z.infer<typeof stageArtifactRefSchema>

export const stageArtifactCreateResponseSchema = z.object({
  artifactId: uuidSchema,
  projectId: uuidSchema,
  stageId: flowStageIdSchema,
  version: z.number().int().positive(),
  contentHash: sha256Schema,
  duplicate: z.boolean(),
  downstreamNowStale: z.array(flowStageIdSchema).max(4),
  projectUpdatedAt: isoDateTimeSchema,
})
export type StageArtifactCreateResponse = z.infer<typeof stageArtifactCreateResponseSchema>

export const clientApprovalEvidenceSchema = z.object({
  kind: z.enum(['email', 'meeting', 'signed_document', 'other']),
  reference: z.string().min(1).max(1000),
  attachment: attachmentRefSchema.nullable(),
  recordedAt: isoDateTimeSchema,
})

export const clientApprovalSchema = z.object({
  approverName: z.string().trim().min(1).max(300),
  approverRole: z.string().max(200).nullable(),
  evidence: clientApprovalEvidenceSchema,
})
export type ClientApproval = z.infer<typeof clientApprovalSchema>

export const stageDecisionVerdictSchema = z.enum(['approved', 'rejected'])
export type StageDecisionVerdict = z.infer<typeof stageDecisionVerdictSchema>

export const stageDecisionRequestSchema = z
  .object({
    artifactId: uuidSchema,
    subjectHash: sha256Schema,
    subjectVersion: z.number().int().positive(),
    verdict: stageDecisionVerdictSchema,
    reason: z.string().min(1).max(4000).nullable().optional(),
    clientApproval: clientApprovalSchema.nullable().optional(),
    deferredThreadKeys: z.array(z.string().min(1).max(200)).max(200).optional(),
  })
  .superRefine((decision, ctx) => {
    if (decision.verdict === 'rejected' && !decision.reason) {
      addDeliveryIssue(ctx, 'reason_required', ['reason'], 'A rejection needs a reason')
    }
  })
export type StageDecisionRequest = z.infer<typeof stageDecisionRequestSchema>

export const stageCurrencySchema = z.enum(['approved', 'stale', 'pending', 'rejected', 'missing'])
export type StageCurrency = z.infer<typeof stageCurrencySchema>

export const FLOW_GATE_DETAIL_CODES = ['stage_not_approved', 'stage_dependency_stale'] as const
export type FlowGateDetailCode = (typeof FLOW_GATE_DETAIL_CODES)[number]

export const stageDecisionResponseSchema = z.object({
  decisionId: uuidSchema,
  projectId: uuidSchema,
  stageId: flowStageIdSchema,
  artifactId: uuidSchema,
  subjectHash: sha256Schema,
  subjectVersion: z.number().int().positive(),
  verdict: stageDecisionVerdictSchema,
  clientApproved: z.boolean(),
  currency: stageCurrencySchema,
  duplicate: z.boolean(),
  projectUpdatedAt: isoDateTimeSchema,
})
export type StageDecisionResponse = z.infer<typeof stageDecisionResponseSchema>

export const STAGE_HISTORY_MAX_PAGE_SIZE = 100

export const stageArtifactListItemSchema = z.object({
  artifactId: uuidSchema,
  projectId: uuidSchema,
  stageId: flowStageIdSchema,
  version: z.number().int().positive(),
  contentHash: sha256Schema,
  source: stageArtifactSourceSchema,
  content: z.record(z.string(), z.unknown()),
  dependsOn: z.array(stageArtifactDependencySchema).max(3),
  attachmentIds: z.array(uuidSchema).max(200),
  templateHash: sha256Schema,
  createdBy: uuidSchema.nullable(),
  createdAt: isoDateTimeSchema,
})
export type StageArtifactListItem = z.infer<typeof stageArtifactListItemSchema>

export const stageArtifactListResponseSchema = z.object({
  items: z.array(stageArtifactListItemSchema).max(STAGE_HISTORY_MAX_PAGE_SIZE),
  total: z.number().int().min(0),
})
export type StageArtifactListResponse = z.infer<typeof stageArtifactListResponseSchema>

export const stageDecisionListItemSchema = z.object({
  decisionId: uuidSchema,
  projectId: uuidSchema,
  stageId: flowStageIdSchema,
  artifactId: uuidSchema,
  subjectHash: sha256Schema,
  subjectVersion: z.number().int().positive(),
  verdict: stageDecisionVerdictSchema,
  reason: z.string().max(4000).nullable(),
  actorUserId: uuidSchema,
  decidedAt: isoDateTimeSchema,
  clientApproved: z.boolean(),
  clientApproval: clientApprovalSchema.nullable(),
  deferredThreadKeys: z.array(z.string().min(1).max(200)).max(200),
  templateHash: sha256Schema,
})
export type StageDecisionListItem = z.infer<typeof stageDecisionListItemSchema>

export const stageDecisionListResponseSchema = z.object({
  items: z.array(stageDecisionListItemSchema).max(STAGE_HISTORY_MAX_PAGE_SIZE),
  total: z.number().int().min(0),
})
export type StageDecisionListResponse = z.infer<typeof stageDecisionListResponseSchema>

// --- Flow status (read model) ----------------------------------------------

export const flowBlockerKindSchema = z.enum([
  'template_not_pinned',
  'intake_incomplete',
  'artifact_missing',
  'decision_pending',
  'rejected',
  'upstream_not_approved',
  'upstream_stale',
  'open_comments',
  'attempt_active',
])
export type FlowBlockerKind = z.infer<typeof flowBlockerKindSchema>

export const flowBlockerSchema = z.object({
  kind: flowBlockerKindSchema,
  stageId: stableIdSchema.nullable(),
  ref: z.string().max(200).nullable(),
})
export type FlowBlocker = z.infer<typeof flowBlockerSchema>

export const flowGateSchema = z.object({ ok: z.boolean(), blocking: z.array(flowBlockerSchema).max(200) })
export type FlowGate = z.infer<typeof flowGateSchema>

export const flowPendingApprovalSchema = z.object({
  stageId: flowStageIdSchema,
  artifactId: uuidSchema,
  contentHash: sha256Schema,
  version: z.number().int().positive(),
  approverFeatures: z.array(z.string().min(1).max(200)).max(20),
  clientApprovalRequired: z.boolean(),
})
export type FlowPendingApproval = z.infer<typeof flowPendingApprovalSchema>

export const flowStageStatusSchema = z.object({
  stageId: stableIdSchema,
  kind: flowTemplateStageKindSchema,
  title: shortTextSchema,
  currency: stageCurrencySchema.nullable(),
  currentArtifact: stageArtifactRefSchema.nullable(),
  approvedArtifact: stageArtifactRefSchema.nullable(),
  latestDecision: z
    .object({ decisionId: uuidSchema, verdict: stageDecisionVerdictSchema, decidedAt: isoDateTimeSchema, clientApproved: z.boolean() })
    .nullable(),
  pendingApproval: flowPendingApprovalSchema.nullable(),
  blockers: z.array(flowBlockerSchema).max(50),
  openThreads: z.number().int().min(0),
})
export type FlowStageStatus = z.infer<typeof flowStageStatusSchema>

export const flowNextActionSchema = z.object({
  kind: z.enum([
    'pin_template',
    'complete_intake',
    'create_artifact',
    'approve_stage',
    'resolve_comments',
    'fix_rejection',
    'dispatch',
    'publish',
    'release',
    'none',
  ]),
  stageId: stableIdSchema.nullable(),
})

export const flowStatusV1Schema = z.object({
  schemaVersion: z.literal(DELIVERY_FLOW_SCHEMA_VERSIONS.flowStatus),
  projectId: uuidSchema,
  template: flowTemplateRefSchema.nullable(),
  workflowInstanceId: uuidSchema.nullable(),
  intakeStep: intakeStepSchema.nullable(),
  currentStageId: stableIdSchema.nullable(),
  stages: z.array(flowStageStatusSchema).max(30),
  pendingApprovals: z.array(flowPendingApprovalSchema).max(4),
  blockers: z.array(flowBlockerSchema).max(200),
  gates: z.object({ dispatchable: flowGateSchema, publishable: flowGateSchema }),
  nextAction: flowNextActionSchema,
  updatedAt: isoDateTimeSchema,
})
export type FlowStatusV1 = z.infer<typeof flowStatusV1Schema>

export const deliveryReportFlowSectionSchema = z.object({
  template: flowTemplateRefSchema.nullable(),
  stages: z
    .array(
      z.object({
        stageId: flowStageIdSchema,
        currency: stageCurrencySchema,
        approvedArtifact: stageArtifactRefSchema.nullable(),
        decisionId: uuidSchema.nullable(),
        clientApproved: z.boolean(),
      }),
    )
    .max(4),
  gate: flowGateSchema,
})
export type DeliveryReportFlowSection = z.infer<typeof deliveryReportFlowSectionSchema>

/** F15: the R22 answer — v1 report plus the optional flow section (present only for pinned projects). */
export const deliveryReportWithFlowSchema = deliveryReportV1Schema.extend({ flow: deliveryReportFlowSectionSchema.optional() })
export type DeliveryReportWithFlow = z.infer<typeof deliveryReportWithFlowSchema>

// --- Staff Kanban link and comment import ----------------------------------

const externalKeySchema = z.string().min(1).max(200)

export const staffLinkRequestSchema = z.object({ staffProjectId: uuidSchema })
export type StaffLinkRequest = z.infer<typeof staffLinkRequestSchema>

export const staffSyncCursorSchema = z.object({
  cursor: z.string().max(500).nullable(),
  lastSyncAt: isoDateTimeSchema.nullable(),
  lastError: z.string().max(1000).nullable(),
})

export const staffLinkSchema = z.object({
  projectId: uuidSchema,
  staffProjectId: uuidSchema,
  linkedBy: uuidSchema,
  linkedAt: isoDateTimeSchema,
  syncCursors: z.record(z.string().min(1).max(200), staffSyncCursorSchema),
  updatedAt: isoDateTimeSchema,
})
export type StaffLink = z.infer<typeof staffLinkSchema>

export const commentAuthorSchema = z.object({
  name: z.string().trim().min(1).max(300),
  externalId: z.string().max(200).nullable(),
  email: z.string().max(320).nullable(),
})
export type CommentAuthor = z.infer<typeof commentAuthorSchema>

export const commentReplySchema = z.object({
  commentKey: externalKeySchema,
  author: commentAuthorSchema,
  body: z.string().min(1).max(20000),
  createdAt: isoDateTimeSchema,
  editedAt: isoDateTimeSchema.nullable(),
  deleted: z.boolean(),
})
export type CommentReply = z.infer<typeof commentReplySchema>

export const commentThreadSchema = z
  .object({
    threadKey: externalKeySchema,
    nodeId: z.string().min(1).max(200).nullable(),
    sourceUrl: z.url().max(2000),
    author: commentAuthorSchema,
    body: z.string().min(1).max(20000),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema.nullable(),
    status: z.enum(['open', 'resolved', 'deleted']),
    figmaVersion: z.string().min(1).max(200).nullable(),
    replies: z.array(commentReplySchema).max(500),
  })
  .superRefine((thread, ctx) => {
    checkUniqueIds(ctx, thread.replies.map((reply) => reply.commentKey), 'replies', 'commentKey')
  })
export type CommentThread = z.infer<typeof commentThreadSchema>

export const commentImportBatchV1Schema = z
  .object({
    schemaVersion: z.literal(DELIVERY_FLOW_SCHEMA_VERSIONS.commentImport),
    projectId: uuidSchema,
    source: z.literal('figma'),
    fileKey: z.string().min(1).max(200),
    stageId: flowStageIdSchema,
    artifactId: uuidSchema.nullable(),
    fetchedAt: isoDateTimeSchema,
    cursor: z.object({ after: z.string().max(500).nullable(), next: z.string().max(500).nullable() }),
    threads: z.array(commentThreadSchema).max(200),
  })
  .superRefine((batch, ctx) => {
    checkUniqueIds(ctx, batch.threads.map((thread) => thread.threadKey), 'threads', 'threadKey')
  })
export type CommentImportBatchV1 = z.infer<typeof commentImportBatchV1Schema>

export const commentImportOutcomeSchema = z.enum(['created', 'updated', 'unchanged', 'skipped'])

export const commentImportResultSchema = z.object({
  projectId: uuidSchema,
  fileKey: z.string().min(1).max(200),
  stageId: flowStageIdSchema,
  cursor: z.object({ after: z.string().max(500).nullable(), next: z.string().max(500).nullable() }),
  counts: z.object({
    threadsCreated: z.number().int().min(0),
    threadsUpdated: z.number().int().min(0),
    repliesCreated: z.number().int().min(0),
    repliesUpdated: z.number().int().min(0),
    skipped: z.number().int().min(0),
  }),
  threads: z
    .array(
      z.object({
        threadKey: externalKeySchema,
        threadId: uuidSchema,
        staffTaskId: uuidSchema,
        versionConfirmed: z.boolean(),
        outcome: commentImportOutcomeSchema,
        replies: z
          .array(z.object({ commentKey: externalKeySchema, staffCommentId: uuidSchema.nullable(), outcome: commentImportOutcomeSchema }))
          .max(500),
      }),
    )
    .max(200),
  replayed: z.boolean(),
})
export type CommentImportResult = z.infer<typeof commentImportResultSchema>

export const commentThreadTriageStatusSchema = z.enum(['new', 'triaged', 'deferred', 'resolved'])

export const commentThreadTriageRequestSchema = z
  .object({
    triageStatus: commentThreadTriageStatusSchema,
    deferral: z
      .object({ artifactId: uuidSchema, contentHash: sha256Schema, reason: z.string().min(1).max(4000) })
      .nullable()
      .optional(),
    linkedDeliveryTaskId: uuidSchema.nullable().optional(),
  })
  .superRefine((triage, ctx) => {
    if (triage.triageStatus === 'deferred' && !triage.deferral) {
      addDeliveryIssue(ctx, 'reason_required', ['deferral'], 'A deferral must name the artifact version and a reason')
    }
  })
export type CommentThreadTriageRequest = z.infer<typeof commentThreadTriageRequestSchema>

// --- Publication result ----------------------------------------------------

export const publicationTargetSchema = z.object({
  kind: z.enum(['wordpress', 'static', 'preview']),
  environment: z.string().min(1).max(100),
  ref: z.string().min(1).max(500),
})

export const publicationVerificationSchema = z
  .object({
    status: z.enum(['verified', 'unverified']),
    method: z.enum(['http', 'browser', 'manual']).nullable(),
    checkedAt: isoDateTimeSchema.nullable(),
    httpStatus: z.number().int().min(100).max(599).nullable(),
    evidenceId: uuidSchema.nullable(),
  })
  .superRefine((verification, ctx) => {
    if (verification.status !== 'verified') return
    if (!verification.checkedAt || !verification.evidenceId || !verification.method) {
      addDeliveryIssue(ctx, 'deployment_unverified', ['verification'], 'A verified publication needs method, checkedAt and evidenceId')
    }
  })

export const publicationResultV1Schema = z.object({
  schemaVersion: z.literal(DELIVERY_FLOW_SCHEMA_VERSIONS.publicationResult),
  projectId: uuidSchema,
  baselineId: uuidSchema,
  sourceRevision: sourceRevisionSchema,
  snapshotRef: attachmentRefSchema.nullable(),
  target: publicationTargetSchema,
  url: z.url().max(2000),
  deployDecisionId: uuidSchema,
  publishedAt: isoDateTimeSchema,
  publishedBy: uuidSchema.nullable(),
  verification: publicationVerificationSchema,
  releaseDecisionId: uuidSchema.nullable(),
})
export type PublicationResultV1 = z.infer<typeof publicationResultV1Schema>

export const publicationRecordResponseSchema = z.object({
  publicationId: uuidSchema,
  deploymentEvidenceId: uuidSchema,
  duplicate: z.boolean(),
})

export const deliveryFlowDocumentSchemas = {
  [DELIVERY_FLOW_SCHEMA_VERSIONS.intake]: intakeV1Schema,
  [DELIVERY_FLOW_SCHEMA_VERSIONS.scopingProposal]: scopingProposalV1Schema,
  [DELIVERY_FLOW_SCHEMA_VERSIONS.flowTemplate]: flowTemplateV1Schema,
  [DELIVERY_FLOW_SCHEMA_VERSIONS.stageArtifact]: stageArtifactV1Schema,
  [DELIVERY_FLOW_SCHEMA_VERSIONS.commentImport]: commentImportBatchV1Schema,
  [DELIVERY_FLOW_SCHEMA_VERSIONS.flowStatus]: flowStatusV1Schema,
  [DELIVERY_FLOW_SCHEMA_VERSIONS.publicationResult]: publicationResultV1Schema,
} as const

// --- Publication list (F14 GET) ----------------------------------------------

export const PUBLICATION_LIST_MAX_PAGE_SIZE = 100

export const publicationListItemSchema = publicationResultV1Schema.omit({ releaseDecisionId: true }).extend({
  publicationId: uuidSchema,
  deploymentEvidenceId: uuidSchema,
  recordedBy: uuidSchema.nullable(),
  createdAt: isoDateTimeSchema,
})
export type PublicationListItem = z.infer<typeof publicationListItemSchema>

export const publicationListResponseSchema = z.object({
  items: z.array(publicationListItemSchema).max(PUBLICATION_LIST_MAX_PAGE_SIZE),
  total: z.number().int().min(0),
})
export type PublicationListResponse = z.infer<typeof publicationListResponseSchema>
