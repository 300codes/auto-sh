import {
  DELIVERY_FLOW_SCHEMA_VERSIONS,
  buildDeliveryFlowError,
  deliveryFlowErrorFromZod,
  intakeStepSchema,
  intakeV1Schema,
  type DeliveryErrorDetail,
  type DeliveryFlowCheckResult,
  type DeliveryFlowErrorResult,
  type ImportedManifest,
  type IntakeQuestion,
  type IntakeStep,
  type IntakeUpdateRequest,
  type IntakeV1,
  type ScopingProposalV1,
} from './contracts'
import { checkPlatformChoiceFrozen, type FrozenTargetProfile } from './flowRules'
import { hashCanonical } from './hash'

export const INTAKE_STEP_ORDER: readonly IntakeStep[] = intakeStepSchema.options

export type IntakeProjectContext = FrozenTargetProfile & { projectId: string }

export type IntakeFailure = { ok: false } & DeliveryFlowErrorResult

export type IntakeUpdateOutcome = { ok: true; intake: IntakeV1 } | IntakeFailure

export type ScopingProposalMergeOutcome =
  | { ok: true; duplicate: boolean; manifestHash: string; intake: IntakeV1; importedManifests: ImportedManifest[] }
  | IntakeFailure

function fail(result: DeliveryFlowErrorResult): IntakeFailure {
  return { ok: false, ...result }
}

const SEEDED_BUSINESS_GOAL_LIMIT = 8000

/** The project brief is free text captured at creation; it seeds the wizard's business goal when it fits the field. */
export function defaultIntake(projectId: string, projectBrief?: string | null): IntakeV1 {
  const seeded = typeof projectBrief === 'string' ? projectBrief.trim() : ''
  return {
    schemaVersion: DELIVERY_FLOW_SCHEMA_VERSIONS.intake,
    projectId,
    step: 'brief',
    brief: {
      businessGoal: seeded.length > 0 && seeded.length <= SEEDED_BUSINESS_GOAL_LIMIT ? seeded : null,
      audience: null,
      problem: null,
      content: null,
      features: [],
      integrations: [],
      constraints: [],
      inspirations: [],
      materials: [],
      unknowns: [],
    },
    questions: [],
    proposals: [],
    platform: { recommendation: null, chosen: null },
    tools: [],
  }
}

/**
 * The wizard may stay, go back to any earlier step (also out of `submitted`, which reopens the intake) or advance by
 * exactly one step; skipping forward would bypass scoping or the platform choice.
 */
export function checkIntakeStepTransition(from: IntakeStep, to: IntakeStep): DeliveryFlowCheckResult {
  const fromIndex = INTAKE_STEP_ORDER.indexOf(from)
  const toIndex = INTAKE_STEP_ORDER.indexOf(to)
  if (toIndex <= fromIndex + 1) return { ok: true }
  return fail(
    buildDeliveryFlowError('intake_step_invalid', 'Intake step cannot be skipped', [
      { path: 'step', code: 'step_skipped', message: `Cannot move from ${from} to ${to}` },
    ]),
  )
}

/** `submitted` needs a chosen platform and an answer to every blocking question. */
export function checkIntakeSubmittable(intake: Pick<IntakeV1, 'questions' | 'platform'>): DeliveryFlowCheckResult {
  const details: DeliveryErrorDetail[] = []
  intake.questions.forEach((question, index) => {
    if (question.blocking && !question.answer) {
      details.push({ path: `questions.${index}.answer`, code: 'blocking_question_unanswered', message: `Question ${question.id} is blocking and unanswered` })
    }
  })
  if (!intake.platform.chosen) {
    details.push({ path: 'platform.chosen', code: 'platform_not_chosen', message: 'A platform must be chosen before submitting' })
  }
  if (details.length === 0) return { ok: true }
  return fail(buildDeliveryFlowError('intake_step_invalid', 'Intake cannot be submitted yet', details))
}

function collectDuplicates(ids: readonly string[], field: string, idField: string, details: DeliveryErrorDetail[]): void {
  const seen = new Set<string>()
  ids.forEach((id, index) => {
    if (seen.has(id)) details.push({ path: `${field}.${index}.${idField}`, code: 'duplicate_stable_id', message: `Duplicate id ${id}` })
    seen.add(id)
  })
}

export function checkIntakeStableIds(intake: Pick<IntakeV1, 'questions' | 'proposals' | 'tools'>): DeliveryFlowCheckResult {
  const details: DeliveryErrorDetail[] = []
  collectDuplicates(intake.questions.map((question) => question.id), 'questions', 'id', details)
  collectDuplicates(intake.proposals.map((proposal) => proposal.proposalId), 'proposals', 'proposalId', details)
  collectDuplicates(intake.tools.map((tool) => `${tool.stageId}:${tool.kind}`), 'tools', 'stageId', details)
  if (details.length === 0) return { ok: true }
  return fail(buildDeliveryFlowError('duplicate_stable_id', 'Duplicate stable id', details))
}

function finalize(candidate: IntakeV1): IntakeUpdateOutcome {
  const parsed = intakeV1Schema.safeParse(candidate)
  if (!parsed.success) return fail(deliveryFlowErrorFromZod(parsed.error))
  return { ok: true, intake: parsed.data }
}

/**
 * Applies a wizard autosave (F2). `projectId` and the server-owned `proposals` always come from the stored row (or
 * the empty default on the first write); anything the body sends for them is ignored.
 */
export function applyIntakeUpdate(input: {
  stored: IntakeV1 | null
  request: IntakeUpdateRequest
  project: IntakeProjectContext
}): IntakeUpdateOutcome {
  const base = input.stored ?? defaultIntake(input.project.projectId)
  const { request } = input
  const candidate: IntakeV1 = {
    schemaVersion: DELIVERY_FLOW_SCHEMA_VERSIONS.intake,
    projectId: base.projectId,
    step: request.step,
    brief: request.brief,
    questions: request.questions,
    proposals: base.proposals,
    platform: request.platform,
    tools: request.tools,
  }
  const stableIds = checkIntakeStableIds(candidate)
  if (!stableIds.ok) return stableIds
  const frozen = checkPlatformChoiceFrozen(input.project, candidate.platform.chosen)
  if (!frozen.ok) return frozen
  const transition = checkIntakeStepTransition(base.step, candidate.step)
  if (!transition.ok) return transition
  if (candidate.step === 'submitted') {
    const submittable = checkIntakeSubmittable(candidate)
    if (!submittable.ok) return submittable
  }
  return finalize(candidate)
}

export function hashScopingProposal(proposal: ScopingProposalV1): string {
  return hashCanonical(proposal)
}

function mergeQuestions(existing: readonly IntakeQuestion[], proposed: readonly IntakeQuestion[]): IntakeQuestion[] {
  const known = new Set(existing.map((question) => question.id))
  const added = proposed.filter((question) => !known.has(question.id)).map((question) => ({ ...question, answer: null }))
  return [...existing, ...added]
}

/**
 * Merges an agent scoping proposal (F3) into the intake. Replay is decided by `importedManifests`: the same
 * `manifestId` with the same hash is a duplicate (nothing changes), with another hash an `idempotency_conflict`.
 * A proposal ref already on the intake is held to the same rule, so the two lists can never disagree silently.
 * Questions merge by id and an existing question wins, so an agent re-ask never erases a human answer; new questions
 * arrive unanswered (the agent proposes, a human answers). A new blocking question reopens a submitted intake to
 * `review`. The platform recommendation is stored as proposed; only `platform.chosen` is held against the frozen
 * profile.
 */
export function mergeScopingProposal(input: {
  stored: IntakeV1 | null
  importedManifests: readonly ImportedManifest[]
  proposal: ScopingProposalV1
  project: IntakeProjectContext
  now: string
}): ScopingProposalMergeOutcome {
  const { proposal, project } = input
  if (proposal.projectId !== project.projectId) {
    return fail(
      buildDeliveryFlowError('foreign_reference', 'Proposal belongs to another project', [
        { path: 'projectId', code: 'foreign_project', message: 'projectId does not match the path project' },
      ]),
    )
  }
  const manifestHash = hashScopingProposal(proposal)
  const base = input.stored ?? defaultIntake(project.projectId)
  const previousHash =
    input.importedManifests.find((manifest) => manifest.manifestId === proposal.manifestId)?.manifestHash ??
    base.proposals.find((ref) => ref.proposalId === proposal.manifestId)?.contentHash
  if (previousHash !== undefined) {
    if (previousHash === manifestHash) {
      return { ok: true, duplicate: true, manifestHash, intake: base, importedManifests: [...input.importedManifests] }
    }
    return fail(
      buildDeliveryFlowError('idempotency_conflict', 'Manifest id was already imported with other content', [
        { path: 'manifestId', code: 'idempotency_conflict', message: `${proposal.manifestId} was imported with another hash` },
      ]),
    )
  }
  const frozen = checkPlatformChoiceFrozen(project, base.platform.chosen)
  if (!frozen.ok) return frozen
  const questions = mergeQuestions(base.questions, proposal.questions)
  const reopen = base.step === 'submitted' && !checkIntakeSubmittable({ questions, platform: base.platform }).ok
  const candidate: IntakeV1 = {
    ...base,
    step: reopen ? 'review' : base.step,
    questions,
    proposals: [
      ...base.proposals,
      { proposalId: proposal.manifestId, kind: proposal.kind, contentHash: manifestHash, proposedAt: input.now, status: 'proposed' },
    ],
    platform: { ...base.platform, recommendation: proposal.platform ?? base.platform.recommendation },
  }
  const outcome = finalize(candidate)
  if (!outcome.ok) return outcome
  return {
    ok: true,
    duplicate: false,
    manifestHash,
    intake: outcome.intake,
    importedManifests: [...input.importedManifests, { manifestId: proposal.manifestId, manifestHash }],
  }
}
