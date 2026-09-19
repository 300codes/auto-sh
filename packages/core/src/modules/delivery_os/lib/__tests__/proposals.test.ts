import { draftSpecV1Schema, type DraftSpecV1 } from '../../data/validators'
import {
  DELIVERY_SCHEMA_VERSIONS,
  MAX_PLAN_PROPOSAL_TASKS,
  baselineContentV1Schema,
  type BaselineContentV1,
  type PlanProposalV1,
  type RequirementsProposalV1,
} from '../contracts'
import { hashBaseline } from '../baseline'
import {
  MAX_PLAN_SUMMARY_LENGTH,
  summarizePlan,
  validatePlanProposal,
  validateRequirementsProposal,
  type PlanProposalContext,
  type PlanTaskDraft,
} from '../proposals'
import { getTargetProfile } from '../targetProfiles'
import {
  loadBaselineContentFixture,
  loadPlanProposalContextFixture,
  loadPlanProposalFixture,
  loadRequirementsProposalFixture,
} from '../fixtures'

const FOREIGN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const AC1_TEST = 'service catalogue AC-001: service list renders seeded services'
const AC2_TEST = 'service catalogue AC-002: category filter narrows the list'

type Failure = { ok: false; status: number; body: { code: string; details: { path?: string; code: string }[] } }

function expectFailure(result: { ok: boolean }, code: string, status = 422): Failure {
  expect(result.ok).toBe(false)
  const failure = result as unknown as Failure
  expect(failure.body.code).toBe(code)
  expect(failure.status).toBe(status)
  return failure
}

function detailCodes(failure: Failure): string[] {
  return failure.body.details.map((detail) => detail.code)
}

function withBaselineContent(content: BaselineContentV1): { context: PlanProposalContext; plan: PlanProposalV1 } {
  const context = loadPlanProposalContextFixture()
  const contentHash = hashBaseline(content)
  return {
    context: { ...context, baseline: { ...context.baseline, content, contentHash } },
    plan: { ...loadPlanProposalFixture(), baselineHash: contentHash },
  }
}

function planWith(change: (plan: PlanProposalV1) => void): PlanProposalV1 {
  const plan = loadPlanProposalFixture()
  change(plan)
  return plan
}

describe('plan proposal fixture context', () => {
  it('is the pre-plan baseline the shipped plan proposal was prepared for', () => {
    const context = loadPlanProposalContextFixture()
    const plan = loadPlanProposalFixture()
    expect(context.baseline.contentHash).toBe(plan.baselineHash)
    expect(context.baseline.id).toBe(plan.baselineId)
    expect(context.project.id).toBe(plan.projectId)
    expect(baselineContentV1Schema.safeParse(context.baseline.content).success).toBe(true)
  })
})

describe('validatePlanProposal — rejection rules with passing twins', () => {
  const context = loadPlanProposalContextFixture()

  it('accepts the shipped plan proposal', () => {
    expect(validatePlanProposal(loadPlanProposalFixture(), context).ok).toBe(true)
  })

  it('rejects an unknown schemaVersion and a document of another type', () => {
    const unknown = validatePlanProposal({ ...loadPlanProposalFixture(), schemaVersion: 'delivery.plan-proposal/v2' }, context)
    expectFailure(unknown, 'unsupported_schema_version')
    expectFailure(validatePlanProposal(loadRequirementsProposalFixture(), context), 'unsupported_schema_version')
    expectFailure(validatePlanProposal(null, context), 'unsupported_schema_version')
  })

  it('rejects a malformed shape with validation_failed', () => {
    const { tasks: _tasks, ...withoutTasks } = loadPlanProposalFixture()
    expectFailure(validatePlanProposal(withoutTasks, context), 'validation_failed', 400)
  })

  it('rejects a foreign projectId', () => {
    const failure = expectFailure(validatePlanProposal({ ...loadPlanProposalFixture(), projectId: FOREIGN_ID }, context), 'foreign_reference')
    expect(detailCodes(failure)).toEqual(['foreign_project'])
  })

  it('rejects a baseline that is not the project baseline', () => {
    const foreignId = expectFailure(validatePlanProposal({ ...loadPlanProposalFixture(), baselineId: FOREIGN_ID }, context), 'foreign_reference')
    expect(detailCodes(foreignId)).toEqual(['foreign_baseline'])
    const otherProjectBaseline = { ...context, baseline: { ...context.baseline, projectId: FOREIGN_ID } }
    const foreignOwner = expectFailure(validatePlanProposal(loadPlanProposalFixture(), otherProjectBaseline), 'foreign_reference')
    expect(detailCodes(foreignOwner)).toEqual(['foreign_baseline'])
  })

  it('rejects a plan prepared for another baseline version (stale hash)', () => {
    const failure = expectFailure(validatePlanProposal({ ...loadPlanProposalFixture(), baselineHash: 'b'.repeat(64) }, context), 'foreign_reference')
    expect(detailCodes(failure)).toEqual(['baseline_hash_mismatch'])
  })

  it('rejects a profile that is not the project profile', () => {
    const openMercato = getTargetProfile('open-mercato-module', 1)
    if (!openMercato) throw new Error('[internal] missing profile')
    const failure = expectFailure(validatePlanProposal(loadPlanProposalFixture(), { ...context, profile: openMercato }), 'unknown_target_profile')
    expect(detailCodes(failure)).toEqual(['target_profile_mismatch'])
  })

  it('rejects a task AC that is not in the baseline', () => {
    const failure = expectFailure(validatePlanProposal(planWith((plan) => { plan.tasks[0].acIds = ['AC-999'] }), context), 'unknown_ac')
    expect(failure.body.details).toEqual([expect.objectContaining({ path: 'tasks.0.acIds.0', code: 'unknown_ac' })])
    expect(validatePlanProposal(planWith((plan) => { plan.tasks[0].acIds = ['AC-001', 'AC-001'] }), context).ok).toBe(true)
  })

  it('rejects an acTestMap key that is not in the baseline', () => {
    const failure = expectFailure(validatePlanProposal(planWith((plan) => { plan.acTestMap['AC-999'] = [AC1_TEST] }), context), 'unknown_ac')
    expect(failure.body.details).toEqual([expect.objectContaining({ path: 'acTestMap.AC-999', code: 'unknown_ac' })])
    expect(validatePlanProposal(planWith((plan) => { plan.acTestMap['AC-003'] = [AC1_TEST] }), context).ok).toBe(true)
  })

  it('rejects a mapping to a test that is neither declared nor in the profile catalogue', () => {
    const failure = expectFailure(
      validatePlanProposal(planWith((plan) => { plan.acTestMap['AC-002'] = ['service catalogue AC-002: invented'] }), context),
      'unknown_test_id',
    )
    expect(failure.body.details).toEqual([expect.objectContaining({ path: 'acTestMap.AC-002.0', code: 'unknown_test_id' })])
    const catalogueOnly = planWith((plan) => { plan.declaredTests = plan.declaredTests.filter((test) => test.testId !== AC1_TEST) })
    expect(validatePlanProposal(catalogueOnly, context).ok).toBe(true)
  })

  it('accepts a mapping to a test declared by the parent baseline', () => {
    const parent = { ...loadPlanProposalContextFixture().baseline.content, declaredTests: [{ testId: AC2_TEST, file: 'src/__tests__/filter.test.tsx' }] }
    const { context: withParentTests, plan } = withBaselineContent(parent)
    plan.declaredTests = plan.declaredTests.filter((test) => test.testId !== AC2_TEST)
    expect(validatePlanProposal(plan, withParentTests).ok).toBe(true)
  })

  it('rejects a test id redefined with another file', () => {
    const failure = expectFailure(
      validatePlanProposal(planWith((plan) => { plan.declaredTests[0].file = 'src/__tests__/other.test.tsx' }), context),
      'duplicate_stable_id',
    )
    expect(failure.body.details).toEqual([expect.objectContaining({ path: 'declaredTests.0.testId', code: 'test_definition_conflict' })])
    expect(validatePlanProposal(planWith((plan) => { plan.declaredTests[1].file = 'src/__tests__/filter.test.tsx' }), context).ok).toBe(true)
  })

  it('rejects a declared test file outside the profile roots', () => {
    const failure = expectFailure(
      validatePlanProposal(planWith((plan) => { plan.declaredTests[1].file = 'e2e/filter.spec.ts' }), context),
      'path_not_allowed',
    )
    expect(failure.body.details).toEqual([expect.objectContaining({ path: 'declaredTests.1.file', code: 'declared_test_outside_roots' })])
    expect(validatePlanProposal(planWith((plan) => { plan.declaredTests[1].file = 'tests/filter.spec.ts' }), context).ok).toBe(true)
  })

  it('rejects a task AC without any required test unless the baseline has a manual check for it', () => {
    const coversAc3 = (plan: PlanProposalV1) => { plan.tasks[0].acIds = ['AC-001', 'AC-003'] }
    const failure = expectFailure(validatePlanProposal(planWith(coversAc3), context), 'missing_required_tests')
    expect(failure.body.details).toEqual([expect.objectContaining({ path: 'acTestMap.AC-003', code: 'missing_required_tests' })])
    const { context: withManualCheck, plan } = withBaselineContent({
      ...loadPlanProposalContextFixture().baseline.content,
      manualChecks: { 'AC-003': 'MC-visual-001' },
    })
    coversAc3(plan)
    expect(validatePlanProposal(plan, withManualCheck).ok).toBe(true)
  })

  it('rejects an empty required-test list that would erase the coverage of an AC', () => {
    const failure = expectFailure(validatePlanProposal(planWith((plan) => { plan.acTestMap['AC-002'] = [] }), context), 'missing_required_tests')
    expect(detailCodes(failure)).toEqual(['missing_required_tests'])
  })

  it('rejects an empty required-test list even for an AC no task covers yet', () => {
    const failure = expectFailure(validatePlanProposal(planWith((plan) => { plan.acTestMap['AC-003'] = [] }), context), 'missing_required_tests')
    expect(failure.body.details).toEqual([expect.objectContaining({ path: 'acTestMap.AC-003', code: 'missing_required_tests' })])
    const { context: withManualCheck, plan } = withBaselineContent({
      ...loadPlanProposalContextFixture().baseline.content,
      manualChecks: { 'AC-003': 'MC-visual-001' },
    })
    plan.acTestMap['AC-003'] = []
    expect(validatePlanProposal(plan, withManualCheck).ok).toBe(true)
  })

  it('rejects a declared test that points at a directory instead of a file', () => {
    const failure = expectFailure(
      validatePlanProposal(planWith((plan) => { plan.declaredTests[1].file = 'src/__tests__/**' }), context),
      'path_not_allowed',
    )
    expect(failure.body.details).toEqual([expect.objectContaining({ path: 'declaredTests.1.file', code: 'declared_test_not_a_file' })])
  })

  it('rejects allowedPaths outside the profile grammar with the task index', () => {
    const failure = expectFailure(
      validatePlanProposal(planWith((plan) => { plan.tasks[1].allowedPaths = ['src/**', 'src/*.tsx', '**'] }), context),
      'path_not_allowed',
    )
    expect(failure.body.details.map((detail) => [detail.path, detail.code])).toEqual([
      ['tasks.1.allowedPaths.1', 'unsupported_glob'],
      ['tasks.1.allowedPaths.2', 'outside_profile_roots'],
    ])
    expect(validatePlanProposal(planWith((plan) => { plan.tasks[1].allowedPaths = ['src/**', 'src/components/**'] }), context).ok).toBe(true)
  })

  it('rejects absolute and traversal paths already at the schema', () => {
    expectFailure(validatePlanProposal(planWith((plan) => { plan.tasks[0].allowedPaths = ['/etc/**'] }), context), 'path_not_allowed')
    expectFailure(validatePlanProposal(planWith((plan) => { plan.tasks[0].allowedPaths = ['src/../../**'] }), context), 'path_not_allowed')
    expect(validatePlanProposal(planWith((plan) => { plan.tasks[0].allowedPaths = ['src/**', 'tests/**'] }), context).ok).toBe(true)
  })

  it('rejects a duplicate proposalTaskKey', () => {
    expectFailure(validatePlanProposal(planWith((plan) => { plan.tasks[1].proposalTaskKey = 'service-list'; plan.tasks[1].dependsOn = [] }), context), 'duplicate_stable_id')
    expect(validatePlanProposal(planWith((plan) => { plan.tasks[1].proposalTaskKey = 'service-filter-2' }), context).ok).toBe(true)
  })

  it('rejects unknown and self dependencies', () => {
    expectFailure(validatePlanProposal(planWith((plan) => { plan.tasks[1].dependsOn = ['missing-task'] }), context), 'foreign_dependency')
    expectFailure(validatePlanProposal(planWith((plan) => { plan.tasks[1].dependsOn = ['service-filter'] }), context), 'cycle')
    expect(validatePlanProposal(planWith((plan) => { plan.tasks[1].dependsOn = ['service-list'] }), context).ok).toBe(true)
  })

  it('rejects a multi-task cycle and accepts the same graph without the back edge', () => {
    const failure = expectFailure(validatePlanProposal(planWith((plan) => { plan.tasks[0].dependsOn = ['service-filter'] }), context), 'cycle')
    expect(failure.body.details).toEqual([expect.objectContaining({ code: 'cycle', message: expect.stringContaining('service-list') })])
    expect(validatePlanProposal(planWith((plan) => { plan.tasks[0].dependsOn = [] }), context).ok).toBe(true)
  })

  it(`rejects more than ${MAX_PLAN_PROPOSAL_TASKS} tasks and accepts exactly the cap`, () => {
    const withTasks = (count: number) =>
      planWith((plan) => {
        plan.tasks = Array.from({ length: count }, (_, index) => ({
          proposalTaskKey: `task-${index}`,
          title: `Task ${index}`,
          description: '',
          acIds: ['AC-001'],
          dependsOn: index === 0 ? [] : [`task-${index - 1}`],
          allowedPaths: ['src/**'],
        }))
      })
    const failure = expectFailure(validatePlanProposal(withTasks(MAX_PLAN_PROPOSAL_TASKS + 1), context), 'validation_failed', 400)
    expect(failure.body.details[0].path).toBe('tasks')
    const atCap = validatePlanProposal(withTasks(MAX_PLAN_PROPOSAL_TASKS), context)
    expect(atCap.ok).toBe(true)
    if (atCap.ok) expect(atCap.baselineContent.planSummary?.length).toBeLessThanOrEqual(MAX_PLAN_SUMMARY_LENGTH)
  })

  it('reports every content problem in one body with a fixed-priority top code', () => {
    const failure = expectFailure(
      validatePlanProposal(
        planWith((plan) => {
          plan.tasks[0].dependsOn = ['service-filter']
          plan.tasks[1].allowedPaths = ['package.json']
          plan.acTestMap['AC-002'] = ['invented test']
          plan.tasks[1].acIds = ['AC-002', 'AC-404']
        }),
        context,
      ),
      'unknown_ac',
    )
    expect(detailCodes(failure)).toEqual(['unknown_ac', 'unknown_test_id', 'outside_profile_roots', 'cycle'])
  })

  it('ranks unknown_test_id above problems found earlier while building the catalogue', () => {
    const failure = expectFailure(
      validatePlanProposal(
        planWith((plan) => {
          plan.declaredTests[1].file = 'e2e/filter.spec.ts'
          plan.acTestMap['AC-001'] = ['invented test']
        }),
        context,
      ),
      'unknown_test_id',
    )
    expect(detailCodes(failure)).toEqual(['declared_test_outside_roots', 'unknown_test_id'])
  })
})

describe('validatePlanProposal — normalized output', () => {
  const context = loadPlanProposalContextFixture()

  it('returns tasks in dependency order with deduplicated references', () => {
    const plan = planWith((draft) => {
      draft.tasks.reverse()
      draft.tasks[0].acIds = ['AC-002', 'AC-002']
      draft.tasks[0].dependsOn = ['service-list', 'service-list']
    })
    const result = validatePlanProposal(plan, context)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.tasks.map((task) => task.proposalTaskKey)).toEqual(['service-list', 'service-filter'])
    expect(result.tasks[1]).toEqual({
      proposalTaskKey: 'service-filter',
      title: 'Category filter',
      description: 'Add a category select that narrows the list.',
      acIds: ['AC-002'],
      dependsOn: ['service-list'],
      allowedPaths: ['src/**'],
    })
  })

  it('freezes the AC→test map and merges it into a new baseline version', () => {
    const result = validatePlanProposal(loadPlanProposalFixture(), context)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.acTestMap).toEqual({ 'AC-001': [AC1_TEST], 'AC-002': [AC2_TEST] })
    expect(Object.isFrozen(result.acTestMap)).toBe(true)
    expect(Object.isFrozen(result.acTestMap['AC-001'])).toBe(true)
    const content = result.baselineContent
    expect(baselineContentV1Schema.safeParse(content).success).toBe(true)
    expect(result.contentHash).toBe(hashBaseline(content))
    expect(result.contentHash).not.toBe(context.baseline.contentHash)
    expect(content.acTestMap).toEqual({ 'AC-001': [AC1_TEST], 'AC-002': [AC2_TEST] })
    expect(content.declaredTests.map((test) => test.testId)).toEqual([AC1_TEST, AC2_TEST])
    expect(content.architectureSummary).toBe(loadPlanProposalFixture().architectureSummary)
    expect(content.planSummary).toBe('service-list: Service catalogue list [AC-001]\nservice-filter: Category filter [AC-002] after service-list')
    expect(content.importedManifestHashes).toEqual([result.manifestHash])
    expect(content.screens).toEqual(context.baseline.content.screens)
    expect(content.requirements).toEqual(context.baseline.content.requirements)
  })

  it('keeps parent mappings the plan does not override and appends the manifest hash to the parent list', () => {
    const first = validatePlanProposal(loadPlanProposalFixture(), context)
    if (!first.ok) throw new Error('[internal] fixture plan must validate')
    const parentWithMapping = { ...first.baselineContent, acTestMap: { ...first.baselineContent.acTestMap } }
    const { context: mergedContext, plan } = withBaselineContent(parentWithMapping)
    plan.acTestMap = { 'AC-002': [AC2_TEST] }
    const replay = validatePlanProposal(plan, mergedContext)
    expect(replay.ok).toBe(true)
    if (!replay.ok) return
    expect(replay.acTestMap['AC-001']).toEqual([AC1_TEST])
    expect(replay.baselineContent.declaredTests.map((test) => test.testId)).toEqual([AC1_TEST, AC2_TEST])
    expect(replay.baselineContent.importedManifestHashes).toEqual([first.manifestHash, replay.manifestHash])
  })

  it('hashes the manifest canonically: key order and unknown fields do not change it, content does', () => {
    const plan = loadPlanProposalFixture()
    const reordered = Object.fromEntries(Object.entries(plan).reverse())
    const first = validatePlanProposal(plan, context)
    const second = validatePlanProposal({ ...reordered, unknownExtra: true }, context)
    const changed = validatePlanProposal({ ...plan, architectureSummary: 'Another architecture' }, context)
    if (!first.ok || !second.ok || !changed.ok) throw new Error('[internal] expected valid plans')
    expect(second.manifestHash).toBe(first.manifestHash)
    expect(changed.manifestHash).not.toBe(first.manifestHash)
    expect(first.manifestId).toBe(plan.manifestId)
  })

  it('does not mutate the context it validated against', () => {
    const snapshot = structuredClone(context.baseline)
    validatePlanProposal(loadPlanProposalFixture(), context)
    expect(context.baseline).toEqual(snapshot)
  })

  it('never splits a surrogate pair when capping the plan summary', () => {
    const title = `${'a'.repeat(MAX_PLAN_SUMMARY_LENGTH - 5)}\u{1F600}${'b'.repeat(20)}`
    const summary = summarizePlan([{ proposalTaskKey: 'k', title, description: '', acIds: ['AC-001'], dependsOn: [], allowedPaths: ['src/**'] }])
    expect(summary.endsWith('…')).toBe(true)
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(summary)).toBe(false)
  })

  it('caps a long plan summary', () => {
    const longTask: PlanTaskDraft = { proposalTaskKey: 'long', title: 'x'.repeat(300), description: '', acIds: ['AC-001'], dependsOn: [], allowedPaths: ['src/**'] }
    const summary = summarizePlan(Array.from({ length: 40 }, () => longTask))
    expect(summary.length).toBe(MAX_PLAN_SUMMARY_LENGTH)
    expect(summary.endsWith('…')).toBe(true)
  })
})

describe('validateRequirementsProposal', () => {
  const PROJECT_ID = '11111111-1111-4111-8111-111111111111'

  function existingDraft(): DraftSpecV1 {
    const baseline = loadBaselineContentFixture()
    return draftSpecV1Schema.parse({
      requirements: [{ id: 'REQ-OLD', title: 'Old requirement' }],
      acceptanceCriteria: [{ id: 'AC-OLD', requirementId: 'REQ-OLD', description: 'Old criterion' }],
      questions: [{ id: 'Q-OLD', text: 'Old question' }],
      risks: [],
      adr: [],
      screens: baseline.screens,
      tokens: baseline.tokens,
      architectureSummary: 'Kept summary',
      acTestMap: { 'AC-001': [AC1_TEST], 'AC-OLD': ['old test'] },
      manualChecks: { 'AC-003': 'MC-visual-001', 'AC-OLD': 'MC-old' },
      declaredTests: [{ testId: AC1_TEST, file: 'src/__tests__/service-catalogue.test.tsx' }],
      attachments: baseline.attachments,
      comments: [{ id: 'C-1', screenAttachmentId: baseline.screens[0].attachmentId, anchor: { x: 0.2, y: 0.3 }, body: 'Keep', status: 'open' }],
    })
  }

  function requirementsWith(change: (proposal: RequirementsProposalV1) => void): RequirementsProposalV1 {
    const proposal = loadRequirementsProposalFixture()
    change(proposal)
    return proposal
  }

  const context = () => ({ projectId: PROJECT_ID, draftSpec: existingDraft() })

  it('accepts the shipped requirements proposal', () => {
    expect(validateRequirementsProposal(loadRequirementsProposalFixture(), context()).ok).toBe(true)
  })

  it('rejects an unknown schemaVersion and a plan posted in its place', () => {
    expectFailure(
      validateRequirementsProposal({ ...loadRequirementsProposalFixture(), schemaVersion: DELIVERY_SCHEMA_VERSIONS.planProposal }, context()),
      'unsupported_schema_version',
    )
    expectFailure(validateRequirementsProposal(loadPlanProposalFixture(), context()), 'unsupported_schema_version')
  })

  it('rejects a foreign projectId', () => {
    const failure = expectFailure(validateRequirementsProposal(loadRequirementsProposalFixture(), { ...context(), projectId: FOREIGN_ID }), 'foreign_reference')
    expect(detailCodes(failure)).toEqual(['foreign_project'])
  })

  it('rejects duplicate requirement and AC ids', () => {
    expectFailure(validateRequirementsProposal(requirementsWith((proposal) => { proposal.requirements[1].id = 'REQ-1' }), context()), 'duplicate_stable_id')
    expectFailure(validateRequirementsProposal(requirementsWith((proposal) => { proposal.acceptanceCriteria[1].id = 'AC-001' }), context()), 'duplicate_stable_id')
    expect(validateRequirementsProposal(requirementsWith((proposal) => { proposal.acceptanceCriteria[1].id = 'AC-004' }), context()).ok).toBe(true)
  })

  it('rejects duplicate question and risk ids', () => {
    expectFailure(
      validateRequirementsProposal(requirementsWith((proposal) => { proposal.questions.push({ id: 'Q-1', text: 'Again?' }) }), context()),
      'duplicate_stable_id',
    )
    expectFailure(
      validateRequirementsProposal(requirementsWith((proposal) => { proposal.risks.push({ id: 'R-1', text: 'Again' }) }), context()),
      'duplicate_stable_id',
    )
    expect(validateRequirementsProposal(requirementsWith((proposal) => { proposal.risks.push({ id: 'R-2', text: 'Another' }) }), context()).ok).toBe(true)
  })

  it('answers validation_failed instead of throwing for a draft that is not plain JSON', () => {
    const draftSpec = { ...existingDraft(), tokens: { broken: (() => 1) as unknown as string } }
    const failure = expectFailure(validateRequirementsProposal(loadRequirementsProposalFixture(), { projectId: PROJECT_ID, draftSpec }), 'validation_failed', 400)
    expect(detailCodes(failure)).toEqual(['not_canonical_json'])
  })

  it('rejects invalid ids and an AC pointing at an unknown requirement', () => {
    expectFailure(validateRequirementsProposal(requirementsWith((proposal) => { proposal.requirements[0].id = '1 bad id' }), context()), 'validation_failed', 400)
    expectFailure(
      validateRequirementsProposal(requirementsWith((proposal) => { proposal.acceptanceCriteria[0].requirementId = 'REQ-404' }), context()),
      'foreign_reference',
    )
  })

  it('replaces the requirement sections, keeps the rest of the draft and prunes orphan AC maps', () => {
    const input = context()
    const before = structuredClone(input.draftSpec)
    const result = validateRequirementsProposal(loadRequirementsProposalFixture(), input)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const proposal = loadRequirementsProposalFixture()
    expect(result.draftSpec.requirements).toEqual(proposal.requirements)
    expect(result.draftSpec.acceptanceCriteria).toEqual(proposal.acceptanceCriteria)
    expect(result.draftSpec.questions).toEqual(proposal.questions)
    expect(result.draftSpec.risks).toEqual(proposal.risks)
    expect(result.draftSpec.acTestMap).toEqual({ 'AC-001': [AC1_TEST] })
    expect(result.draftSpec.manualChecks).toEqual({ 'AC-003': 'MC-visual-001' })
    expect(result.prunedAcIds).toEqual(['AC-OLD'])
    for (const section of ['screens', 'tokens', 'adr', 'attachments', 'comments', 'declaredTests', 'architectureSummary', 'planSummary'] as const) {
      expect(result.draftSpec[section]).toEqual(before[section])
    }
    expect(draftSpecV1Schema.safeParse(result.draftSpec).success).toBe(true)
    expect(input.draftSpec).toEqual(before)
  })

  it('hashes the manifest canonically', () => {
    const proposal = loadRequirementsProposalFixture()
    const first = validateRequirementsProposal(proposal, context())
    const reordered = validateRequirementsProposal(Object.fromEntries(Object.entries(proposal).reverse()), context())
    const changed = validateRequirementsProposal(requirementsWith((draft) => { draft.risks = [] }), context())
    if (!first.ok || !reordered.ok || !changed.ok) throw new Error('[internal] expected valid proposals')
    expect(reordered.manifestHash).toBe(first.manifestHash)
    expect(changed.manifestHash).not.toBe(first.manifestHash)
    expect(first.manifestId).toBe(proposal.manifestId)
  })
})
