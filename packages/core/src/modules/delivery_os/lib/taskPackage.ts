import { checkAttemptOpen } from './attempts'
import {
  DELIVERY_SCHEMA_VERSIONS,
  baselineContentV1Schema,
  buildDeliveryError,
  deliveryErrorFromZod,
  taskPackageV1Schema,
  type DeliveryErrorCode,
  type DeliveryErrorDetail,
  type DeliveryErrorResult,
  type DeliveryLimits,
  type ExecutionAttempt,
  type TaskPackageV1,
} from './contracts'
import { hashCanonical } from './hash'
import { assertRevisionKind, type TargetProfile } from './targetProfiles'

export type TaskPackageProject = {
  id: string
  repositoryRef?: string | null
  limits: DeliveryLimits
}

export type TaskPackageTask = {
  id: string
  projectId: string
  baselineId: string
  title: string
  description?: string | null
  acIds: readonly string[]
  allowedPaths: readonly string[]
  targetProfileId: string
  targetProfileVersion: number
}

export type TaskPackageBaseline = {
  id: string
  projectId: string
  contentHash: string
  content: unknown
}

export type TaskPackageInput = {
  project: TaskPackageProject
  task: TaskPackageTask
  baseline: TaskPackageBaseline
  attempt: ExecutionAttempt | undefined
  profile: TargetProfile
}

export type TaskPackageFailure = { ok: false } & DeliveryErrorResult

export type TaskPackageResult = { ok: true; taskPackage: TaskPackageV1 } | TaskPackageFailure

export type TaskPackageOptions = { attemptGate?: 'open' | 'none' }

function fail(code: DeliveryErrorCode, error: string, details: DeliveryErrorDetail[]): TaskPackageFailure {
  return { ok: false, ...buildDeliveryError(code, error, details) }
}

function checkPins(input: TaskPackageInput, attempt: ExecutionAttempt): TaskPackageFailure | null {
  const { project, task, baseline, profile } = input
  if (task.projectId !== project.id || baseline.projectId !== project.id) {
    return fail('correlation_mismatch', 'Task and baseline must belong to the project', [
      { path: 'projectId', code: 'correlation_mismatch' },
    ])
  }
  const details: DeliveryErrorDetail[] = []
  if (task.baselineId !== baseline.id) details.push({ path: 'task.baselineId', code: 'baseline_mismatch' })
  if (attempt.baselineId !== baseline.id) details.push({ path: 'attempt.baselineId', code: 'baseline_mismatch' })
  if (attempt.baselineHash !== baseline.contentHash) details.push({ path: 'attempt.baselineHash', code: 'baseline_mismatch' })
  if (details.length > 0) return fail('baseline_mismatch', 'The attempt is pinned to another baseline', details)
  if (profile.id !== task.targetProfileId || profile.version !== task.targetProfileVersion) {
    return fail('unknown_target_profile', 'Unknown target profile', [
      {
        path: 'targetProfileId',
        code: 'unknown_target_profile',
        message: `Task is pinned to ${task.targetProfileId} v${task.targetProfileVersion}`,
      },
    ])
  }
  return null
}

function isStoredHashIntact(baseline: TaskPackageBaseline): boolean {
  try {
    return hashCanonical(baseline.content) === baseline.contentHash
  } catch {
    return false
  }
}

export function buildTaskPackageV1(input: TaskPackageInput, options: TaskPackageOptions = {}): TaskPackageResult {
  const { project, task, baseline, attempt, profile } = input
  if (!attempt) {
    return fail('attempt_not_found', 'Attempt not found', [
      { path: 'attemptId', code: 'attempt_not_found', message: 'No such attempt on this task' },
    ])
  }
  if (options.attemptGate !== 'none') {
    const open = checkAttemptOpen(attempt)
    if (!open.ok) return open
  }
  const pinFailure = checkPins(input, attempt)
  if (pinFailure) return pinFailure
  const revisionKind = assertRevisionKind(profile, attempt.baseRevision)
  if (!revisionKind.ok) return revisionKind

  const content = baselineContentV1Schema.safeParse(baseline.content)
  if (!content.success) {
    return fail('hash_mismatch', 'Stored baseline content is not readable', [
      { path: 'content', code: 'unreadable_baseline_content' },
    ])
  }
  if (!isStoredHashIntact(baseline)) {
    return fail('hash_mismatch', 'Stored baseline content does not match its hash', [
      { path: 'baselineId', code: 'stored_content_altered' },
    ])
  }
  const taskAcIds = new Set(task.acIds)
  const acceptanceCriteria = content.data.acceptanceCriteria.filter((criterion) => taskAcIds.has(criterion.id))
  const foundAcIds = new Set(acceptanceCriteria.map((criterion) => criterion.id))
  const unknownAcIds = task.acIds.filter((acId) => !foundAcIds.has(acId))
  if (unknownAcIds.length > 0) {
    return fail(
      'unknown_ac',
      'Unknown acceptance criterion',
      unknownAcIds.map((acId) => ({ path: `acIds.${acId}`, code: 'unknown_ac', message: `${acId} is not part of the pinned baseline` })),
    )
  }
  const requirementIds = new Set(acceptanceCriteria.map((criterion) => criterion.requirementId))
  const requiredTests = Object.fromEntries(
    Object.entries(content.data.acTestMap).filter(([acId]) => taskAcIds.has(acId)),
  )

  const candidate = {
    schemaVersion: DELIVERY_SCHEMA_VERSIONS.taskPackage,
    projectId: project.id,
    taskId: task.id,
    attemptId: attempt.attemptId,
    baselineId: baseline.id,
    baselineHash: baseline.contentHash,
    targetProfileId: profile.id,
    targetProfileVersion: profile.version,
    title: task.title,
    ...(task.description ? { description: task.description } : {}),
    requirements: content.data.requirements.filter((requirement) => requirementIds.has(requirement.id)),
    acceptanceCriteria,
    designArtifactRefs: content.data.screens,
    repositoryRef: project.repositoryRef ?? null,
    baseRevision: attempt.baseRevision,
    ...(attempt.baseRevision.kind === 'git' ? { baseCommit: attempt.baseRevision.commitSha } : {}),
    allowedPaths: [...task.allowedPaths],
    validationProfile: {
      version: profile.version,
      requiredTests,
      checks: profile.checks.map((check) => ({ ...check })),
    },
    limits: { ...project.limits },
    idempotencyKey: attempt.idempotencyKey,
  }
  const parsed = taskPackageV1Schema.safeParse(candidate)
  if (!parsed.success) return { ok: false, ...deliveryErrorFromZod(parsed.error) }
  return { ok: true, taskPackage: parsed.data }
}
