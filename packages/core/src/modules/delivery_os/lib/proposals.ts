import { z } from 'zod'
import {
  DELIVERY_SCHEMA_VERSIONS,
  baselineContentV1Schema,
  buildDeliveryError,
  deliveryErrorFromZod,
  parseVersioned,
  planProposalV1Schema,
  proposalQuestionSchema,
  proposalRiskSchema,
  requirementsProposalV1Schema,
  type AcceptanceCriterion,
  type BaselineContentV1,
  type DeclaredTest,
  type DeliveryErrorCode,
  type DeliveryErrorDetail,
  type DeliveryErrorResult,
  type PlanProposalV1,
  type Requirement,
  type RequirementsProposalV1,
} from './contracts'
import { ALLOWED_PATH_DIRECTORY_SUFFIX, collectAllowedPathIssues, describeAllowedPathIssue } from './allowedPaths'
import { hashBaseline } from './baseline'
import { findDependencyCycle } from './dag'
import { hashCanonical } from './hash'
import type { TargetProfile } from './targetProfiles'

export const MAX_PLAN_SUMMARY_LENGTH = 8000

type ProposalQuestion = z.infer<typeof proposalQuestionSchema>
type ProposalRisk = z.infer<typeof proposalRiskSchema>
type ProposalFailure = { ok: false } & DeliveryErrorResult

export type RequirementsDraftSections = {
  requirements: Requirement[]
  acceptanceCriteria: AcceptanceCriterion[]
  questions: ProposalQuestion[]
  risks: ProposalRisk[]
  acTestMap: Record<string, string[]>
  manualChecks: Record<string, string>
}

export type RequirementsProposalContext<TDraft extends RequirementsDraftSections> = {
  projectId: string
  draftSpec: TDraft
}

export type RequirementsProposalIdentity = {
  ok: true
  manifest: RequirementsProposalV1
  manifestId: string
  manifestHash: string
}

export type RequirementsProposalResult<TDraft extends RequirementsDraftSections> =
  | {
      ok: true
      manifest: RequirementsProposalV1
      manifestId: string
      manifestHash: string
      draftSpec: TDraft
      prunedAcIds: string[]
    }
  | ProposalFailure

export type PlanProposalContext = {
  project: { id: string; targetProfileId: string; targetProfileVersion: number }
  baseline: { id: string; projectId: string; contentHash: string; content: BaselineContentV1 }
  profile: TargetProfile
}

export type PlanTaskDraft = {
  proposalTaskKey: string
  title: string
  description: string
  acIds: string[]
  dependsOn: string[]
  allowedPaths: string[]
}

export type PlanProposalResult =
  | {
      ok: true
      manifest: PlanProposalV1
      manifestId: string
      manifestHash: string
      tasks: PlanTaskDraft[]
      acTestMap: Readonly<Record<string, readonly string[]>>
      declaredTests: DeclaredTest[]
      baselineContent: BaselineContentV1
      contentHash: string
    }
  | ProposalFailure

type ContentProblem = { code: DeliveryErrorCode; detail: DeliveryErrorDetail }

const CONTENT_PROBLEM_PRIORITY: readonly DeliveryErrorCode[] = [
  'unknown_ac',
  'unknown_test_id',
  'duplicate_stable_id',
  'missing_required_tests',
  'path_not_allowed',
  'cycle',
]

const CONTENT_PROBLEM_ERRORS: Partial<Record<DeliveryErrorCode, string>> = {
  unknown_ac: 'Acceptance criterion is not part of the baseline',
  unknown_test_id: 'Required test is not declared',
  duplicate_stable_id: 'Test id is defined twice with different files',
  missing_required_tests: 'Acceptance criterion has no required tests',
  path_not_allowed: 'Path is not allowed for the target profile',
  cycle: 'Dependency graph contains a cycle',
}

const requirementsProposalSchemas = {
  [DELIVERY_SCHEMA_VERSIONS.requirementsProposal]: requirementsProposalV1Schema,
}

const planProposalSchemas = {
  [DELIVERY_SCHEMA_VERSIONS.planProposal]: planProposalV1Schema,
}

function hasOwn(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function unique<TValue>(values: readonly TValue[]): TValue[] {
  return [...new Set(values)]
}

function failure(code: DeliveryErrorCode, error: string, details: DeliveryErrorDetail[]): ProposalFailure {
  return { ok: false, ...buildDeliveryError(code, error, details) }
}

function notCanonical(path: string): ProposalFailure {
  return failure('validation_failed', 'Validation failed', [
    { path, code: 'not_canonical_json', message: 'The document must be plain JSON nested at most 64 levels deep' },
  ])
}

function tryClone<TValue>(value: TValue): TValue | null {
  try {
    return structuredClone(value)
  } catch {
    return null
  }
}

function tryHash(compute: () => string): string | null {
  try {
    return compute()
  } catch {
    return null
  }
}

export function hashProposalManifest(manifest: RequirementsProposalV1 | PlanProposalV1): string {
  return hashCanonical(manifest)
}

function pickKnown<TValue>(record: Record<string, TValue>, knownKeys: ReadonlySet<string>): Record<string, TValue> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => knownKeys.has(key)))
}

export function parseRequirementsProposal(manifest: unknown, projectId: string): RequirementsProposalIdentity | ProposalFailure {
  const parsed = parseVersioned(requirementsProposalSchemas, manifest)
  if (!parsed.ok) return parsed
  const proposal = parsed.data
  if (proposal.projectId !== projectId) {
    return failure('foreign_reference', 'Proposal belongs to another project', [
      { path: 'projectId', code: 'foreign_project', message: 'The manifest projectId is not this project' },
    ])
  }
  const manifestHash = tryHash(() => hashProposalManifest(proposal))
  if (manifestHash === null) return notCanonical('manifest')
  return { ok: true, manifest: proposal, manifestId: proposal.manifestId, manifestHash }
}

export function validateRequirementsProposal<TDraft extends RequirementsDraftSections>(
  manifest: unknown,
  context: RequirementsProposalContext<TDraft>,
): RequirementsProposalResult<TDraft> {
  const identity = parseRequirementsProposal(manifest, context.projectId)
  if (!identity.ok) return identity
  const proposal = identity.manifest
  const draft = tryClone(context.draftSpec)
  if (draft === null) return notCanonical('draftSpec')
  const proposedAcIds = new Set(proposal.acceptanceCriteria.map((criterion) => criterion.id))
  const prunedAcIds = unique(
    [...Object.keys(draft.acTestMap), ...Object.keys(draft.manualChecks)].filter((acId) => !proposedAcIds.has(acId)),
  )
  const draftSpec: TDraft = {
    ...draft,
    requirements: proposal.requirements,
    acceptanceCriteria: proposal.acceptanceCriteria,
    questions: proposal.questions,
    risks: proposal.risks,
    acTestMap: pickKnown(draft.acTestMap, proposedAcIds),
    manualChecks: pickKnown(draft.manualChecks, proposedAcIds),
  }
  return { ...identity, draftSpec, prunedAcIds }
}

function checkPlanCorrelation(proposal: PlanProposalV1, context: PlanProposalContext): DeliveryErrorDetail[] {
  const { project, baseline } = context
  const details: DeliveryErrorDetail[] = []
  if (proposal.projectId !== project.id) {
    details.push({ path: 'projectId', code: 'foreign_project', message: 'The manifest projectId is not this project' })
  }
  if (baseline.projectId !== project.id || proposal.baselineId !== baseline.id) {
    details.push({ path: 'baselineId', code: 'foreign_baseline', message: 'The manifest baselineId is not the baseline of this project' })
  } else if (proposal.baselineHash !== baseline.contentHash) {
    details.push({ path: 'baselineHash', code: 'baseline_hash_mismatch', message: 'The plan was prepared for another version of the baseline content' })
  }
  return details
}

function buildTestCatalogue(
  proposal: PlanProposalV1,
  context: PlanProposalContext,
  problems: ContentProblem[],
): Map<string, string> {
  const catalogue = new Map<string, string>()
  for (const test of [...context.profile.testCatalogue, ...context.baseline.content.declaredTests]) {
    if (!catalogue.has(test.testId)) catalogue.set(test.testId, test.file)
  }
  proposal.declaredTests.forEach((test, index) => {
    const known = catalogue.get(test.testId)
    if (known !== undefined && known !== test.file) {
      problems.push({
        code: 'duplicate_stable_id',
        detail: { path: `declaredTests.${index}.testId`, code: 'test_definition_conflict', message: `${test.testId} is already declared in ${known}` },
      })
    }
    if (test.file.endsWith(ALLOWED_PATH_DIRECTORY_SUFFIX)) {
      problems.push({
        code: 'path_not_allowed',
        detail: { path: `declaredTests.${index}.file`, code: 'declared_test_not_a_file', message: 'A declared test must point at one test file, not a directory' },
      })
    } else if (collectAllowedPathIssues([test.file], context.profile).length > 0) {
      problems.push({
        code: 'path_not_allowed',
        detail: {
          path: `declaredTests.${index}.file`,
          code: 'declared_test_outside_roots',
          message: `Test file must be inside the ${context.profile.id}@${context.profile.version} roots`,
        },
      })
    }
    if (known === undefined) catalogue.set(test.testId, test.file)
  })
  return catalogue
}

function checkAcceptanceCriteria(proposal: PlanProposalV1, knownAcIds: ReadonlySet<string>, problems: ContentProblem[]): void {
  proposal.tasks.forEach((task, taskIndex) => {
    task.acIds.forEach((acId, acIndex) => {
      if (knownAcIds.has(acId)) return
      problems.push({
        code: 'unknown_ac',
        detail: { path: `tasks.${taskIndex}.acIds.${acIndex}`, code: 'unknown_ac', message: `${acId} is not part of the baseline` },
      })
    })
  })
  for (const acId of Object.keys(proposal.acTestMap)) {
    if (knownAcIds.has(acId)) continue
    problems.push({ code: 'unknown_ac', detail: { path: `acTestMap.${acId}`, code: 'unknown_ac', message: `${acId} is not part of the baseline` } })
  }
}

function checkTestMapping(
  proposal: PlanProposalV1,
  context: PlanProposalContext,
  catalogue: ReadonlyMap<string, string>,
  mergedMap: Record<string, string[]>,
  knownAcIds: ReadonlySet<string>,
  problems: ContentProblem[],
): void {
  for (const [acId, testIds] of Object.entries(proposal.acTestMap)) {
    testIds.forEach((testId, index) => {
      if (catalogue.has(testId)) return
      problems.push({
        code: 'unknown_test_id',
        detail: { path: `acTestMap.${acId}.${index}`, code: 'unknown_test_id', message: `${testId} is neither declared nor in the profile test catalogue` },
      })
    })
  }
  const manualChecks = context.baseline.content.manualChecks
  const acIdsNeedingTests = unique([...proposal.tasks.flatMap((task) => task.acIds), ...Object.keys(proposal.acTestMap)])
  for (const acId of acIdsNeedingTests) {
    if (!knownAcIds.has(acId)) continue
    const requiredTests = hasOwn(mergedMap, acId) ? mergedMap[acId] : []
    if (requiredTests.length > 0 || hasOwn(manualChecks, acId)) continue
    problems.push({
      code: 'missing_required_tests',
      detail: { path: `acTestMap.${acId}`, code: 'missing_required_tests', message: `${acId} needs at least one required test or a manual check` },
    })
  }
}

function checkTaskPaths(proposal: PlanProposalV1, profile: TargetProfile, problems: ContentProblem[]): void {
  proposal.tasks.forEach((task, taskIndex) => {
    for (const issue of collectAllowedPathIssues(task.allowedPaths, profile)) {
      problems.push({ code: 'path_not_allowed', detail: describeAllowedPathIssue(issue, `tasks.${taskIndex}.allowedPaths.`, profile) })
    }
  })
}

function checkTaskCycles(proposal: PlanProposalV1, problems: ContentProblem[]): void {
  const cycle = findDependencyCycle(proposal.tasks.map((task) => ({ key: task.proposalTaskKey, dependsOn: task.dependsOn })))
  if (cycle) problems.push({ code: 'cycle', detail: { path: 'tasks', code: 'cycle', message: cycle.join(' -> ') } })
}

function contentFailure(problems: readonly ContentProblem[]): ProposalFailure | null {
  if (problems.length === 0) return null
  const code = CONTENT_PROBLEM_PRIORITY.find((candidate) => problems.some((problem) => problem.code === candidate)) ?? problems[0].code
  return failure(code, CONTENT_PROBLEM_ERRORS[code] ?? 'Validation failed', problems.map((problem) => problem.detail))
}

function orderByDependencies(tasks: readonly PlanTaskDraft[]): PlanTaskDraft[] {
  const ordered: PlanTaskDraft[] = []
  const placed = new Set<string>()
  const pending = [...tasks]
  while (pending.length > 0) {
    const nextIndex = pending.findIndex((task) => task.dependsOn.every((key) => placed.has(key)))
    const [next] = pending.splice(nextIndex < 0 ? 0 : nextIndex, 1)
    ordered.push(next)
    placed.add(next.proposalTaskKey)
  }
  return ordered
}

function normalizeTasks(proposal: PlanProposalV1): PlanTaskDraft[] {
  return orderByDependencies(
    proposal.tasks.map((task) => ({
      proposalTaskKey: task.proposalTaskKey,
      title: task.title,
      description: task.description,
      acIds: unique(task.acIds),
      dependsOn: unique(task.dependsOn),
      allowedPaths: [...task.allowedPaths],
    })),
  )
}

export function summarizePlan(tasks: readonly PlanTaskDraft[]): string {
  const summary = tasks
    .map((task) => {
      const after = task.dependsOn.length > 0 ? ` after ${task.dependsOn.join(', ')}` : ''
      return `${task.proposalTaskKey}: ${task.title} [${task.acIds.join(', ')}]${after}`
    })
    .join('\n')
  if (summary.length <= MAX_PLAN_SUMMARY_LENGTH) return summary
  const cut = summary.slice(0, MAX_PLAN_SUMMARY_LENGTH - 1)
  return `${/[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut}…`
}

function freezeTestMap(map: Record<string, string[]>): Readonly<Record<string, readonly string[]>> {
  return Object.freeze(Object.fromEntries(Object.entries(map).map(([acId, testIds]) => [acId, Object.freeze([...testIds])])))
}

export function validatePlanProposal(manifest: unknown, context: PlanProposalContext): PlanProposalResult {
  const parsed = parseVersioned(planProposalSchemas, manifest)
  if (!parsed.ok) return parsed
  const proposal = parsed.data
  const correlation = checkPlanCorrelation(proposal, context)
  if (correlation.length > 0) {
    return failure('foreign_reference', 'Plan does not belong to this project baseline', correlation)
  }
  const { project, profile, baseline } = context
  if (profile.id !== project.targetProfileId || profile.version !== project.targetProfileVersion) {
    return failure('unknown_target_profile', 'Target profile does not match the project', [
      {
        path: 'targetProfile',
        code: 'target_profile_mismatch',
        message: `Project is pinned to ${project.targetProfileId}@${project.targetProfileVersion}, got ${profile.id}@${profile.version}`,
      },
    ])
  }

  const problems: ContentProblem[] = []
  const knownAcIds = new Set(baseline.content.acceptanceCriteria.map((criterion) => criterion.id))
  const mergedMap: Record<string, string[]> = {}
  for (const [acId, testIds] of Object.entries({ ...baseline.content.acTestMap, ...proposal.acTestMap })) {
    if (knownAcIds.has(acId)) mergedMap[acId] = unique(testIds)
  }
  checkAcceptanceCriteria(proposal, knownAcIds, problems)
  const catalogue = buildTestCatalogue(proposal, context, problems)
  checkTestMapping(proposal, context, catalogue, mergedMap, knownAcIds, problems)
  checkTaskPaths(proposal, profile, problems)
  checkTaskCycles(proposal, problems)
  const rejected = contentFailure(problems)
  if (rejected) return rejected

  const manifestHash = tryHash(() => hashProposalManifest(proposal))
  if (manifestHash === null) return notCanonical('manifest')
  const tasks = normalizeTasks(proposal)
  const declaredTestIds = new Set(baseline.content.declaredTests.map((test) => test.testId))
  const declaredTests = [
    ...baseline.content.declaredTests.map((test) => ({ ...test })),
    ...proposal.declaredTests.filter((test) => !declaredTestIds.has(test.testId)).map((test) => ({ ...test })),
  ]
  const parent = tryClone(baseline.content)
  if (parent === null) return notCanonical('baseline.content')
  const candidate = {
    ...parent,
    architectureSummary: proposal.architectureSummary,
    planSummary: summarizePlan(tasks),
    acTestMap: structuredClone(mergedMap),
    declaredTests,
    importedManifestHashes: unique([...parent.importedManifestHashes, manifestHash]),
  }
  const content = baselineContentV1Schema.safeParse(candidate)
  if (!content.success) return { ok: false, ...deliveryErrorFromZod(content.error) }
  const contentHash = tryHash(() => hashBaseline(content.data))
  if (contentHash === null) return notCanonical('baseline.content')
  return {
    ok: true,
    manifest: proposal,
    manifestId: proposal.manifestId,
    manifestHash,
    tasks,
    acTestMap: freezeTestMap(mergedMap),
    declaredTests: declaredTests.map((test) => ({ ...test })),
    baselineContent: content.data,
    contentHash,
  }
}
