import { buildPlanDraftPrompt, buildPlanProposal, normalizeAllowedPath, normalizePlanDraft, planDraftSchema, TESTS_ROOT, uncoveredCriteria } from '../planDrafting'
import { planProposalV1Schema } from '../contracts'

const projectId = '44444444-4444-4444-8444-444444444444'
const baselineId = '55555555-5555-4555-8555-555555555555'
const baselineHash = 'a'.repeat(64)

const baseline = {
  architectureSummary: 'Motyw WordPress z tokenami design systemu',
  planSummary: 'Cztery widoki serwisu Aster Works',
  requirements: [{ id: 'REQ-1', title: 'Strona główna', description: 'Hero, problemy, proces, kontakt' }],
  acceptanceCriteria: [
    { id: 'AC-1', requirementId: 'REQ-1', description: 'Hero pokazuje H1 i dwa CTA' },
    { id: 'AC-2', requirementId: 'REQ-1', description: 'Menu prowadzi do sekcji strony głównej' },
  ],
}

const draft = planDraftSchema.parse({
  architectureSummary: 'Motyw klasyczny z szablonami części',
  tasks: [
    { proposalTaskKey: 'TASK-1', title: 'Hero strony głównej', description: 'Zbuduj sekcję hero', acIds: ['AC-1'], dependsOn: [], allowedPaths: ['parts/**', 'style.css'] },
    { proposalTaskKey: 'TASK-2', title: 'Nawigacja', description: 'Zbuduj menu', acIds: ['AC-2'], dependsOn: ['TASK-1'], allowedPaths: ['functions.php'] },
  ],
})

describe('plan drafting', () => {
  it('hands the agent the baseline requirements, criteria and repository layout', () => {
    const prompt = buildPlanDraftPrompt({ baseline, projectName: 'Aster Works', targetProfileId: 'wordpress-theme', pathHint: 'A WordPress theme: style.css, functions.php.' })
    expect(prompt).toContain('REQ-1 Strona główna')
    expect(prompt).toContain('AC-1 (REQ-1) Hero pokazuje H1 i dwa CTA')
    expect(prompt).toContain('A WordPress theme: style.css, functions.php.')
  })

  it('builds a valid proposal bound to the active baseline, with one acTestMap entry per criterion', () => {
    const proposal = buildPlanProposal({
      draft,
      projectId,
      baselineId,
      baselineHash,
      acceptanceCriterionIds: ['AC-1', 'AC-2'],
      manifestId: 'plan-1234',
      producedBy: { tool: 'agent-cli', sessionRef: null },
    })
    expect(planProposalV1Schema.safeParse(proposal).success).toBe(true)
    expect(proposal).toMatchObject({ projectId, baselineId, baselineHash, manifestId: 'plan-1234' })
    expect(proposal.acTestMap).toEqual({ 'AC-1': [], 'AC-2': [] })
    expect(proposal.declaredTests).toEqual([])
  })

  it('names the criteria the plan leaves unplanned, so the operator sees them before importing', () => {
    expect(uncoveredCriteria(draft, ['AC-1', 'AC-2', 'AC-3'])).toEqual(['AC-3'])
    expect(uncoveredCriteria(draft, ['AC-1', 'AC-2'])).toEqual([])
  })

  it.each([
    ['assets/', 'assets/**'],
    ['assets/**', 'assets/**'],
    ['inc/*.php', 'inc/**'],
    ['inc/*', 'inc/**'],
    [' style.css ', 'style.css'],
    ['functions.php', 'functions.php'],
  ])('rewrites agent notation %s into %s', (raw, expected) => {
    expect(normalizeAllowedPath(raw)).toBe(expected)
  })

  it('normalizes a whole draft and drops the duplicates that trimming creates', () => {
    const normalized = normalizePlanDraft({
      architectureSummary: 'x',
      tasks: [{ proposalTaskKey: 'TASK-1', title: 't', description: 'd', acIds: ['AC-1'], dependsOn: [], allowedPaths: ['assets/', 'assets/**', 'style.css'] }],
    }) as { tasks: { allowedPaths: string[] }[] }
    expect(normalized.tasks[0].allowedPaths).toEqual(['assets/**', 'style.css', TESTS_ROOT])
  })

  it('still refuses a path that escapes the repository, because notation is not the problem there', () => {
    const normalized = normalizePlanDraft({
      architectureSummary: 'x',
      tasks: [{ proposalTaskKey: 'TASK-1', title: 't', description: 'd', acIds: ['AC-1'], dependsOn: [], allowedPaths: ['../etc/passwd'] }],
    })
    expect(planDraftSchema.safeParse(normalized).success).toBe(false)
  })

  it('leaves an answer it cannot read untouched for the schema to refuse', () => {
    expect(normalizePlanDraft(null)).toBeNull()
    expect(normalizePlanDraft({ tasks: 'nope' })).toEqual({ tasks: 'nope' })
  })
})

test('gives every task the tests tree, so it can ship the proof of its own criteria', () => {
  const normalized = normalizePlanDraft({
    architectureSummary: 'x',
    tasks: [{ proposalTaskKey: 'TASK-1', title: 't', description: 'd', acIds: ['AC-1'], dependsOn: [], allowedPaths: ['style.css'] }],
  }) as { tasks: { allowedPaths: string[] }[] }
  expect(normalized.tasks[0].allowedPaths).toContain('tests/**')
})

test('does not duplicate the tests tree when the plan already named it', () => {
  const normalized = normalizePlanDraft({
    architectureSummary: 'x',
    tasks: [{ proposalTaskKey: 'TASK-1', title: 't', description: 'd', acIds: ['AC-1'], dependsOn: [], allowedPaths: ['tests/', 'style.css'] }],
  }) as { tasks: { allowedPaths: string[] }[] }
  expect(normalized.tasks[0].allowedPaths.filter((entry) => entry === 'tests/**')).toHaveLength(1)
})
