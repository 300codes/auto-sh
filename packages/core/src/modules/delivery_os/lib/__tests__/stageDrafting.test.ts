import { buildScopeArtifact, buildScopeDraftPrompt, scopeDraftSchema } from '../stageDrafting'
import { stageArtifactV1Schema, type IntakeV1 } from '../contracts'

const projectId = '44444444-4444-4444-8444-444444444444'

const intake: IntakeV1 = {
  projectId,
  step: 'submitted',
  brief: {
    businessGoal: 'Sell three services',
    audience: 'Local companies',
    problem: 'The old site does not convert',
    content: 'Home, services, contact',
    features: ['Contact form'],
    integrations: ['Google Analytics'],
    constraints: ['Launch in six weeks'],
    inspirations: ['https://example.test'],
    materials: [],
    unknowns: ['Who supplies the photos?'],
  },
  questions: [{ id: 'Q-1', text: 'Which language versions?', answer: 'Polish only' }],
  proposals: [],
  platform: { recommendation: null, chosen: { profileId: 'wordpress-theme', profileVersion: 2, chosenBy: '55555555-5555-4555-8555-555555555555', chosenAt: '2026-09-20T10:00:00.000Z' } },
  tools: [{ stageId: 'scope', kind: 'execution', ref: 'cezar', rationale: null }],
}

const draft = scopeDraftSchema.parse({
  summary: 'A five-page company site for Aster Works',
  inScope: ['Home page'],
  outOfScope: ['Online shop'],
  pages: [{ id: 'PAGE-HOME', title: 'Home', purpose: 'Present the offer' }],
  keyFlows: [{ id: 'FLOW-CONTACT', title: 'Contact', steps: ['Open the form', 'Send it'] }],
  requirements: [{ id: 'REQ-1', title: 'Contact form', description: 'A form that reaches the mailbox' }],
  acceptanceCriteria: [{ id: 'AC-1', requirementId: 'REQ-1', description: 'Sending the form delivers an email' }],
  risks: [{ id: 'RISK-1', text: 'Photos may be late', mitigation: 'Use placeholders' }],
  assumptions: ['Copy comes from the client'],
  platformRationale: 'A content site fits a WordPress theme',
})

describe('scope stage drafting', () => {
  it('carries every intake answer into the prompt without inventing anything', () => {
    const prompt = buildScopeDraftPrompt(intake, 'Aster Works', 'wordpress-theme')
    for (const fragment of ['Sell three services', 'Local companies', 'Contact form', 'Google Analytics', 'Launch in six weeks', 'Who supplies the photos?', 'Which language versions? -> Polish only', 'wordpress-theme']) {
      expect(prompt).toContain(fragment)
    }
  })

  it('completes a draft into a valid stage artifact owned by the intake', () => {
    const artifact = buildScopeArtifact({ draft, projectId, intake, targetProfileId: 'wordpress-theme', targetProfileVersion: 1, producedBy: { tool: 'agent-cli', sessionRef: null } })
    expect(stageArtifactV1Schema.safeParse(artifact).success).toBe(true)
    expect(artifact).toMatchObject({ stageId: 'scope', source: 'agent', dependsOn: [], attachments: [] })
    expect(artifact.content).toMatchObject({
      openQuestionIds: [],
      platform: { profileId: 'wordpress-theme', profileVersion: 2, rationale: draft.platformRationale },
      tools: intake.tools,
    })
  })

  it('falls back to the project profile when the intake chose none', () => {
    const artifact = buildScopeArtifact({ draft, projectId, intake: { ...intake, platform: { recommendation: null, chosen: null } }, targetProfileId: 'wordpress-theme', targetProfileVersion: 7, producedBy: { tool: 'api-model', sessionRef: null } })
    expect(artifact.content.platform).toMatchObject({ profileId: 'wordpress-theme', profileVersion: 7 })
  })

  it('refuses a draft whose criteria reference an unknown requirement', () => {
    expect(() => buildScopeArtifact({
      draft: { ...draft, acceptanceCriteria: [{ id: 'AC-1', requirementId: 'REQ-9', description: 'Dangling' }] },
      projectId,
      intake,
      targetProfileId: 'wordpress-theme',
      targetProfileVersion: 1,
      producedBy: { tool: 'agent-cli', sessionRef: null },
    })).toThrow()
  })

  it('refuses a draft without requirements or criteria', () => {
    expect(scopeDraftSchema.safeParse({ ...draft, requirements: [], acceptanceCriteria: [] }).success).toBe(false)
  })
})
