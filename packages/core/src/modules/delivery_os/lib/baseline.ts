import {
  DELIVERY_SCHEMA_VERSIONS,
  baselineContentV1Schema,
  buildDeliveryError,
  deliveryErrorFromZod,
  stableIdSchema,
  type BaselineContentV1,
  type DeliveryCheckResult,
  type DeliveryErrorCode,
  type DeliveryErrorDetail,
  type DeliveryErrorResult,
} from './contracts'
import { hashCanonical } from './hash'
import type { TargetProfile } from './targetProfiles'

export type BaselineDraftComment = {
  id: string
  screenAttachmentId: string | null
  anchor: { x: number; y: number } | null
  body: string
  status: 'open' | 'resolved'
  resolution?: string
}

export type BaselineDraftInput = {
  requirements?: unknown
  acceptanceCriteria?: unknown
  screens?: unknown
  tokens?: unknown
  architectureSummary?: string | null
  planSummary?: string | null
  acTestMap?: unknown
  manualChecks?: unknown
  declaredTests?: unknown
  attachments?: unknown
  comments?: readonly BaselineDraftComment[]
}

export type BaselineBuildExtras = { importedManifestHashes?: readonly string[] }

export type BaselineBuildResult =
  | { ok: true; content: BaselineContentV1; contentHash: string; openCommentIds: string[] }
  | ({ ok: false } & DeliveryErrorResult)

export type BaselineDecisionKind = 'requirements' | 'design'

export type BaselineDecisionRecord = {
  kind: string
  verdict: 'approved' | 'rejected'
  subjectHash: string
  subjectVersion: number | null
  decidedAt: string | Date
}

export type BaselineSubject = { contentHash: string; version: number }

export type ReadinessTask = {
  baselineId: string | null
  acIds: readonly string[]
  targetProfileId: string
  targetProfileVersion: number
}

export type ReadinessBaseline = BaselineSubject & { id: string; content: BaselineContentV1 }

export type TaskReadinessInput = {
  task: ReadinessTask
  baseline: ReadinessBaseline
  decisions: readonly BaselineDecisionRecord[]
  profile: TargetProfile | undefined
}

export type ReadinessReason = { code: DeliveryErrorCode; error: string; detail: DeliveryErrorDetail }

const BASELINE_DECISION_KINDS: readonly BaselineDecisionKind[] = ['requirements', 'design']

export function hashBaseline(content: BaselineContentV1): string {
  return hashCanonical(content)
}

function tryHashBaseline(content: BaselineContentV1): string | null {
  try {
    return hashBaseline(content)
  } catch {
    return null
  }
}

function cloneDraft(draft: BaselineDraftInput): BaselineDraftInput | null {
  try {
    return structuredClone(draft)
  } catch {
    return null
  }
}

function notCanonical(): { ok: false } & DeliveryErrorResult {
  return {
    ok: false,
    ...buildDeliveryError('validation_failed', 'Validation failed', [
      { path: 'draftSpec', code: 'not_canonical_json', message: 'The draft must be plain JSON nested at most 64 levels deep' },
    ]),
  }
}

export function buildBaselineContent(draft: BaselineDraftInput, extras: BaselineBuildExtras = {}): BaselineBuildResult {
  const source = cloneDraft(draft)
  if (source === null) return notCanonical()
  const comments = source.comments ?? []
  const candidate = {
    schemaVersion: DELIVERY_SCHEMA_VERSIONS.baselineContent,
    requirements: source.requirements ?? [],
    acceptanceCriteria: source.acceptanceCriteria ?? [],
    screens: source.screens ?? [],
    tokens: source.tokens ?? {},
    architectureSummary: source.architectureSummary ?? null,
    planSummary: source.planSummary ?? null,
    acTestMap: source.acTestMap ?? {},
    manualChecks: source.manualChecks ?? {},
    declaredTests: source.declaredTests ?? [],
    attachments: source.attachments ?? [],
    resolvedComments: comments
      .filter((comment) => comment.status === 'resolved')
      .map((comment) => ({
        id: comment.id,
        screenAttachmentId: comment.screenAttachmentId,
        anchor: comment.anchor,
        body: comment.body,
        resolution: comment.resolution,
      })),
    importedManifestHashes: [...(extras.importedManifestHashes ?? [])],
  }
  const parsed = baselineContentV1Schema.safeParse(candidate)
  if (!parsed.success) return { ok: false, ...deliveryErrorFromZod(parsed.error) }
  const contentHash = tryHashBaseline(parsed.data)
  if (contentHash === null) return notCanonical()
  return {
    ok: true,
    content: parsed.data,
    contentHash,
    openCommentIds: comments.filter((comment) => comment.status !== 'resolved').map((comment) => comment.id),
  }
}

export function nextBaselineVersion(existingVersions: readonly number[]): number {
  const known = existingVersions.filter((version) => Number.isInteger(version) && version > 0)
  return known.length === 0 ? 1 : Math.max(...known) + 1
}

function collectIdIssues(entries: readonly { id: string }[], field: string): DeliveryErrorDetail[] {
  const seen = new Set<string>()
  const issues: DeliveryErrorDetail[] = []
  entries.forEach((entry, index) => {
    const path = `${field}.${index}.id`
    if (!stableIdSchema.safeParse(entry.id).success) {
      issues.push({ path, code: 'invalid_stable_id', message: 'A stable id starts with a letter and has at most 64 characters' })
    } else if (seen.has(entry.id)) {
      issues.push({ path, code: 'duplicate_stable_id', message: `Duplicate id ${entry.id}` })
    }
    seen.add(entry.id)
  })
  return issues
}

export function assertStableIds(input: {
  requirements: readonly { id: string }[]
  acceptanceCriteria: readonly { id: string }[]
}): DeliveryCheckResult {
  const issues = [
    ...collectIdIssues(input.requirements, 'requirements'),
    ...collectIdIssues(input.acceptanceCriteria, 'acceptanceCriteria'),
  ]
  if (issues.length === 0) return { ok: true }
  const hasInvalid = issues.some((issue) => issue.code === 'invalid_stable_id')
  return hasInvalid
    ? { ok: false, ...buildDeliveryError('validation_failed', 'Validation failed', issues) }
    : { ok: false, ...buildDeliveryError('duplicate_stable_id', 'Stable ids must be unique', issues) }
}

function decidedAtMillis(decision: BaselineDecisionRecord): number {
  return decision.decidedAt instanceof Date ? decision.decidedAt.getTime() : Date.parse(decision.decidedAt)
}

function supersedes(candidate: BaselineDecisionRecord, current: BaselineDecisionRecord): boolean {
  const candidateAt = decidedAtMillis(candidate)
  const currentAt = decidedAtMillis(current)
  if (Number.isNaN(currentAt)) return false
  if (Number.isNaN(candidateAt)) return true
  if (candidateAt !== currentAt) return candidateAt > currentAt
  return candidate.verdict === 'rejected'
}

export function latestBaselineDecisions(
  decisions: readonly BaselineDecisionRecord[],
  subject: BaselineSubject,
): Partial<Record<BaselineDecisionKind, BaselineDecisionRecord>> {
  const latest: Partial<Record<BaselineDecisionKind, BaselineDecisionRecord>> = {}
  for (const kind of BASELINE_DECISION_KINDS) {
    const forSubject = decisions.filter(
      (decision) =>
        decision.kind === kind &&
        decision.subjectHash === subject.contentHash &&
        (decision.subjectVersion === subject.version || decision.verdict === 'rejected'),
    )
    for (const decision of forSubject) {
      const current = latest[kind]
      if (!current || supersedes(decision, current)) latest[kind] = decision
    }
  }
  return latest
}

function isApproved(decision: BaselineDecisionRecord | undefined): boolean {
  return decision !== undefined && decision.verdict === 'approved' && !Number.isNaN(decidedAtMillis(decision))
}

export function resolveActiveBaseline(decisions: readonly BaselineDecisionRecord[], subject: BaselineSubject): boolean {
  const latest = latestBaselineDecisions(decisions, subject)
  return BASELINE_DECISION_KINDS.every((kind) => isApproved(latest[kind]))
}

function reason(code: DeliveryErrorCode, error: string, path: string, detailCode: string, message: string): ReadinessReason {
  return { code, error, detail: { path, code: detailCode, message } }
}

export function collectReadinessReasons(input: TaskReadinessInput): ReadinessReason[] {
  const { task, baseline, decisions, profile } = input
  const reasons: ReadinessReason[] = []
  if (!profile) {
    reasons.push(
      reason('unknown_target_profile', 'Unknown target profile', 'targetProfileId', 'unknown_target_profile', `No profile ${task.targetProfileId} v${task.targetProfileVersion}`),
    )
  } else if (profile.id !== task.targetProfileId || profile.version !== task.targetProfileVersion) {
    reasons.push(
      reason('unknown_target_profile', 'Target profile does not match the task', 'targetProfileVersion', 'target_profile_mismatch', `Task is pinned to ${task.targetProfileId} v${task.targetProfileVersion}, got ${profile.id} v${profile.version}`),
    )
  }
  if (task.baselineId !== baseline.id) {
    reasons.push(reason('baseline_mismatch', 'Task is pinned to another baseline', 'baselineId', 'baseline_mismatch', `Task baseline is ${task.baselineId ?? 'not set'}`))
  }
  if (tryHashBaseline(baseline.content) !== baseline.contentHash) {
    reasons.push(reason('hash_mismatch', 'Baseline content does not match its hash', 'contentHash', 'hash_mismatch', 'The stored baseline content was altered'))
  }
  const latest = latestBaselineDecisions(decisions, baseline)
  for (const kind of BASELINE_DECISION_KINDS) {
    if (isApproved(latest[kind])) continue
    const decided = latest[kind]
    const detailCode = !decided ? `${kind}_decision_missing` : decided.verdict === 'rejected' ? `${kind}_rejected` : `${kind}_decision_invalid`
    reasons.push(
      reason('baseline_not_approved', 'Baseline is not approved', `decisions.${kind}`, detailCode, `No valid approved ${kind} decision for baseline v${baseline.version} (${baseline.contentHash.slice(0, 12)})`),
    )
  }
  if (task.acIds.length === 0) {
    reasons.push(reason('missing_acceptance_criteria', 'Task has no acceptance criteria', 'acIds', 'missing_acceptance_criteria', 'Link at least one acceptance criterion'))
  }
  const knownAcIds = new Set(baseline.content.acceptanceCriteria.map((criterion) => criterion.id))
  const hasOwn = (record: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(record, key)
  for (const acId of task.acIds) {
    if (!knownAcIds.has(acId)) {
      reasons.push(reason('unknown_ac', 'Unknown acceptance criterion', `acIds.${acId}`, 'unknown_ac', `${acId} is not part of baseline v${baseline.version}`))
    }
  }
  if (baseline.content.screens.length === 0) {
    reasons.push(reason('missing_render', 'Baseline has no design render', 'screens', 'missing_render', 'Attach a stored render or snapshot before execution'))
  }
  for (const acId of task.acIds) {
    if (!knownAcIds.has(acId)) continue
    const requiredTests = hasOwn(baseline.content.acTestMap, acId) ? baseline.content.acTestMap[acId] : []
    if (requiredTests.length > 0 || hasOwn(baseline.content.manualChecks, acId)) continue
    reasons.push(
      reason('missing_required_tests', 'Acceptance criterion has no required tests', `acTestMap.${acId}`, 'missing_required_tests', `${acId} needs required test ids or a manual check`),
    )
  }
  return reasons
}

export function checkTaskReadiness(input: TaskReadinessInput): DeliveryCheckResult {
  const reasons = collectReadinessReasons(input)
  if (reasons.length === 0) return { ok: true }
  const [first] = reasons
  return { ok: false, ...buildDeliveryError(first.code, first.error, reasons.map((entry) => entry.detail)) }
}
