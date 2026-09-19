import { buildDesignAgentInstructions, buildDesignArtifact, buildDesignDraftPrompt, buildScopeArtifact, buildScopeDraftPrompt, isDesignStageId, readDesignFileKey, scopeDraftSchema } from '../stageDrafting'
import { figmaDesignResultSchema } from '../designAgent'
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

describe('design stage drafting in Figma', () => {
  const scope = buildScopeArtifact({ draft, projectId, intake, targetProfileId: 'wordpress-theme', targetProfileVersion: 1, producedBy: { tool: 'agent-cli', sessionRef: null } })
  const dependsOn = [{ stageId: 'scope' as const, artifactId: '66666666-6666-4666-8666-666666666666', version: 1, contentHash: 'a'.repeat(64) }]
  const design = figmaDesignResultSchema.parse({
    fileKey: 'ES4noLJGt7u47StnPl5y1a',
    fileUrl: 'https://www.figma.com/design/ES4noLJGt7u47StnPl5y1a',
    summary: 'Cztery widoki z jedną ścieżką do kontaktu',
    notes: 'Nagłówek H1\nSekcja problemów',
    nodes: [{ nodeId: '1:2', name: 'Strona główna — desktop', width: 1440, height: 1024 }],
  })
  const build = (stageId: 'ux' | 'key_visual' | 'design_system_ui') =>
    buildDesignArtifact({ stageId, design, projectId, dependsOn, producedBy: { tool: 'figma-mcp', sessionRef: design.fileKey } })

  it('feeds the approved scope into the design brief', () => {
    const prompt = buildDesignDraftPrompt({ stageId: 'ux', intake, scope: scope.content, projectName: 'Aster Works', targetProfileId: 'wordpress-theme' })
    expect(prompt).toContain('Stage: ux')
    expect(prompt).toContain(draft.summary)
    expect(prompt).toContain('AC-1 Sending the form delivers an email')
  })

  it('tells the agent to build the stage through the Figma MCP server', () => {
    const instructions = buildDesignAgentInstructions('key_visual')
    expect(instructions).toContain('figma MCP server')
    expect(instructions).toContain('Build the visual direction in Figma')
  })

  it.each(['ux', 'key_visual', 'design_system_ui'] as const)('turns the %s Figma nodes into a valid artifact', (stageId) => {
    const artifact = build(stageId)
    expect(stageArtifactV1Schema.safeParse(artifact).success).toBe(true)
    expect(artifact).toMatchObject({ stageId, source: 'figma', dependsOn })
    expect(artifact.content).toMatchObject({
      figmaRefs: [{ fileKey: design.fileKey, nodeId: '1:2', name: 'Strona główna — desktop', url: 'https://www.figma.com/design/ES4noLJGt7u47StnPl5y1a?node-id=1-2' }],
      screens: [],
    })
  })

  it('records the node size a reviewer can check but claims no rendered screen', () => {
    const artifact = build('ux')
    expect('notes' in artifact.content && artifact.content.notes).toContain('1440×1024 (1:2)')
    expect('screens' in artifact.content && artifact.content.screens).toHaveLength(0)
  })

  it('reuses the Figma file an earlier design stage created', () => {
    expect(readDesignFileKey([build('ux').content])).toBe(design.fileKey)
    expect(readDesignFileKey([scope.content, {}])).toBeNull()
  })

  it('refuses an answer whose node ids are not Figma node ids', () => {
    expect(figmaDesignResultSchema.safeParse({ ...design, nodes: [{ ...design.nodes[0], nodeId: 'frame-1' }] }).success).toBe(false)
    expect(figmaDesignResultSchema.safeParse({ ...design, nodes: [] }).success).toBe(false)
  })

  it('refuses a design stage that depends on a later stage', () => {
    expect(() => buildDesignArtifact({
      stageId: 'ux',
      design,
      projectId,
      dependsOn: [{ stageId: 'design_system_ui', artifactId: dependsOn[0].artifactId, version: 1, contentHash: dependsOn[0].contentHash }],
      producedBy: { tool: 'figma-mcp', sessionRef: null },
    })).toThrow()
  })

  it('marks only the three design stages as Figma stages', () => {
    expect(['ux', 'key_visual', 'design_system_ui'].every(isDesignStageId)).toBe(true)
    expect(isDesignStageId('scope')).toBe(false)
  })
})
