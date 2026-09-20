import { applyExtractedBrief, buildBriefStructuringPrompt, extractedBriefSchema, readJsonObject } from '../briefStructuring'
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

describe('reading an agent answer', () => {
  const answer = { fileKey: 'ES4noLJGt7u47StnPl5y1a', nodes: [{ nodeId: '1:2' }] }

  it('reads a plain answer', () => {
    expect(readJsonObject(JSON.stringify(answer))).toEqual(answer)
  })

  it('reads the answer a CLI printed twice around its run log', () => {
    const output = `run log\n${JSON.stringify(answer)}\ntokens used\n140 858\n${JSON.stringify(answer)}\n`
    expect(readJsonObject(output)).toEqual(answer)
  })

  it('reads a fenced answer wrapped in prose', () => {
    expect(readJsonObject(`Here you go:\n\`\`\`json\n${JSON.stringify(answer)}\n\`\`\`\nDone.`)).toEqual(answer)
  })

  it('returns null when the answer holds no JSON object', () => {
    expect(readJsonObject('I cannot help with that.')).toBeNull()
    expect(readJsonObject('[1, 2, 3]')).toBeNull()
  })
})
