import { z } from 'zod'
import { MAX_CANONICAL_DEPTH, SHA256_HEX_PATTERN } from './hash'

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

function addDeliveryIssue(
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

const uuidSchema = z.uuid()
const sha256Schema = z.string().regex(SHA256_HEX_PATTERN)
const commitShaSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)
const isoDateTimeSchema = z.iso.datetime({ offset: true })
const stableIdSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9._-]{0,63}$/)
const testIdSchema = z.string().min(1).max(512)
const shortTextSchema = z.string().min(1).max(300)
const longTextSchema = z.string().max(8000)
const idempotencyKeySchema = z.string().regex(/^[\x21-\x7E]{1,200}$/)

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

function checkUniqueIds(ctx: z.RefinementCtx, ids: string[], field: string, idField: string): void {
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
})
export type DesignScreen = z.infer<typeof designScreenSchema>

export const screenRefSchema = designScreenSchema.extend({
  fileKey: z.string().min(1).max(200).nullable(),
  nodeId: z.string().min(1).max(200).nullable(),
})
export type ScreenRef = z.infer<typeof screenRefSchema>

const designTokensSchema = z.record(z.string().min(1).max(200), z.json())

export const attachmentRefSchema = z.object({ attachmentId: uuidSchema, sha256: sha256Schema })
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

const commentAnchorSchema = z.object({ x: z.number(), y: z.number() }).superRefine((value, ctx) => {
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

const manifestIdSchema = z.string().regex(/^[\x21-\x7E]{1,200}$/)

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
    tasks: z.array(planProposalTaskSchema).min(1).max(100),
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

export const deliveryDocumentSchemas = {
  [DELIVERY_SCHEMA_VERSIONS.taskPackage]: taskPackageV1Schema,
  [DELIVERY_SCHEMA_VERSIONS.resultManifest]: resultManifestV1Schema,
  [DELIVERY_SCHEMA_VERSIONS.baselineContent]: baselineContentV1Schema,
  [DELIVERY_SCHEMA_VERSIONS.requirementsProposal]: requirementsProposalV1Schema,
  [DELIVERY_SCHEMA_VERSIONS.planProposal]: planProposalV1Schema,
  [DELIVERY_SCHEMA_VERSIONS.designManifest]: designManifestV1Schema,
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
