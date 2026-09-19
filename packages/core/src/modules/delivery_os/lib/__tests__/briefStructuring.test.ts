import { applyExtractedBrief, buildBriefStructuringPrompt, extractedBriefSchema } from '../briefStructuring'
import { defaultIntake } from '../intakeRules'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const empty = () => defaultIntake(PROJECT_ID)

function extraction(overrides: Record<string, unknown> = {}) {
  return extractedBriefSchema.parse({
    businessGoal: 'Sell three services online',
    audience: 'Local studios',
    features: ['Services section', ' Contact form ', 'Services section'],
    ...overrides,
  })
}

describe('applyExtractedBrief', () => {
  it('fills the empty wizard fields and normalizes the lists', () => {
    const intake = applyExtractedBrief(empty(), extraction())
    expect(intake.brief).toMatchObject({
      businessGoal: 'Sell three services online',
      audience: 'Local studios',
      features: ['Services section', 'Contact form'],
      problem: null,
      integrations: [],
    })
    expect({ ...intake, brief: empty().brief }).toEqual(empty())
  })

  it('never overwrites what the operator already wrote', () => {
    const current = empty()
    current.brief.businessGoal = 'Operator wording'
    current.brief.features = ['Kept feature']
    const intake = applyExtractedBrief(current, extraction())
    expect(intake.brief.businessGoal).toBe('Operator wording')
    expect(intake.brief.features).toEqual(['Kept feature'])
    expect(intake.brief.audience).toBe('Local studios')
  })

  it('ignores values that do not fit the wizard fields', () => {
    const intake = applyExtractedBrief(empty(), extractedBriefSchema.parse({ businessGoal: null, features: [] }))
    expect(intake.brief.businessGoal).toBeNull()
    expect(intake.brief.features).toEqual([])
  })

  it('refuses an oversized extraction instead of truncating it', () => {
    expect(extractedBriefSchema.safeParse({ businessGoal: 'x'.repeat(8001) }).success).toBe(false)
    expect(extractedBriefSchema.safeParse({ features: ['y'.repeat(301)] }).success).toBe(false)
  })
})

describe('buildBriefStructuringPrompt', () => {
  it('carries the brief and the target profile and names every wizard field', () => {
    const prompt = buildBriefStructuringPrompt('Studio site with three services', 'wordpress-theme')
    expect(prompt).toContain('Studio site with three services')
    expect(prompt).toContain('wordpress-theme')
    for (const field of ['businessGoal', 'audience', 'problem', 'content', 'features', 'integrations', 'constraints', 'unknowns']) {
      expect(prompt).toContain(field)
    }
  })
})
