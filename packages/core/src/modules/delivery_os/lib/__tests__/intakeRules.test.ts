import {
  deliveryFlowDocumentSchemas,
  parseFlowVersioned,
  type IntakeUpdateRequest,
  type IntakeV1,
  type ScopingProposalV1,
} from '../contracts'
import {
  applyIntakeUpdate,
  checkIntakeStableIds,
  checkIntakeStepTransition,
  checkIntakeSubmittable,
  defaultIntake,
  hashScopingProposal,
  mergeScopingProposal,
} from '../intakeRules'
import { loadIntakeFixture, loadNegativeFlowFixtures, loadScopingProposalFixture } from '../fixtures/flow/index'

const project = { projectId: '11111111-1111-4111-8111-111111111111', targetProfileId: 'wordpress-theme', targetProfileVersion: 1 }
const now = '2026-09-19T12:00:00.000Z'

function toRequest(intake: IntakeV1): IntakeUpdateRequest {
  const { projectId: _projectId, proposals: _proposals, ...request } = intake
  return request
}

function codeOf(result: { ok: boolean; body?: { code: string } }): string | undefined {
  return result.ok ? undefined : result.body?.code
}

describe('intake step transitions', () => {
  it('allows staying, one step forward and any step back, including reopening a submitted intake', () => {
    expect(checkIntakeStepTransition('brief', 'brief').ok).toBe(true)
    expect(checkIntakeStepTransition('brief', 'scoping').ok).toBe(true)
    expect(checkIntakeStepTransition('platform', 'review').ok).toBe(true)
    expect(checkIntakeStepTransition('review', 'brief').ok).toBe(true)
    expect(checkIntakeStepTransition('submitted', 'review').ok).toBe(true)
  })

  it('refuses skipping forward with intake_step_invalid', () => {
    const result = checkIntakeStepTransition('brief', 'platform')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(422)
      expect(result.body.code).toBe('intake_step_invalid')
      expect(result.body.details[0]).toMatchObject({ path: 'step', code: 'step_skipped' })
    }
    expect(codeOf(checkIntakeStepTransition('scoping', 'submitted'))).toBe('intake_step_invalid')
  })
})

describe('intake submission', () => {
  it('accepts the fixture: every blocking question answered and a platform chosen', () => {
    expect(checkIntakeSubmittable(loadIntakeFixture()).ok).toBe(true)
  })

  it('refuses an unanswered blocking question and a missing platform choice, one detail each', () => {
    const intake = loadIntakeFixture()
    const questions = [...intake.questions, { id: 'Q-002', text: 'Which slots?', askedBy: 'agent' as const, blocking: true, answer: null }]
    const result = checkIntakeSubmittable({ questions, platform: { ...intake.platform, chosen: null } })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.body.code).toBe('intake_step_invalid')
      expect(result.body.details.map((detail) => detail.code)).toEqual(['blocking_question_unanswered', 'platform_not_chosen'])
      expect(result.body.details[0].path).toBe('questions.1.answer')
    }
  })

  it('ignores unanswered non-blocking questions', () => {
    const intake = loadIntakeFixture()
    const questions = [...intake.questions, { id: 'Q-003', text: 'Nice to have?', askedBy: 'human' as const, blocking: false, answer: null }]
    expect(checkIntakeSubmittable({ questions, platform: intake.platform }).ok).toBe(true)
  })
})

describe('intake stable ids', () => {
  it('passes for the fixture and reports duplicate question, proposal and tool ids', () => {
    const intake = loadIntakeFixture()
    expect(checkIntakeStableIds(intake).ok).toBe(true)
    const result = checkIntakeStableIds({
      questions: [...intake.questions, intake.questions[0]],
      proposals: [...intake.proposals, intake.proposals[0]],
      tools: [...intake.tools, intake.tools[0]],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(422)
      expect(result.body.code).toBe('duplicate_stable_id')
      expect(result.body.details.map((detail) => detail.path)).toEqual(['questions.1.id', 'proposals.1.proposalId', 'tools.2.stageId'])
    }
  })
})

describe('applyIntakeUpdate', () => {
  it('saves a wizard step and keeps projectId and proposals from the stored row, never from the body', () => {
    const stored = loadIntakeFixture()
    const forged = { ...toRequest(stored), step: 'review', proposals: [], projectId: '22222222-2222-4222-8222-222222222222' } as IntakeUpdateRequest
    const result = applyIntakeUpdate({ stored, request: forged, project })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.intake.step).toBe('review')
      expect(result.intake.projectId).toBe(project.projectId)
      expect(result.intake.proposals).toEqual(stored.proposals)
    }
  })

  it('starts from the empty default intake on the first write', () => {
    const request = { ...toRequest(defaultIntake(project.projectId)), step: 'scoping' as const }
    const result = applyIntakeUpdate({ stored: null, request, project })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.intake.proposals).toEqual([])
    expect(codeOf(applyIntakeUpdate({ stored: null, request: { ...request, step: 'platform' }, project }))).toBe('intake_step_invalid')
  })

  it('resumes from the stored step: a saved platform step may be submitted after review only', () => {
    const stored = loadIntakeFixture()
    expect(codeOf(applyIntakeUpdate({ stored, request: { ...toRequest(stored), step: 'submitted' }, project }))).toBe('intake_step_invalid')
    const reviewed = { ...stored, step: 'review' as const }
    const submitted = applyIntakeUpdate({ stored: reviewed, request: { ...toRequest(reviewed), step: 'submitted' }, project })
    expect(submitted.ok).toBe(true)
  })

  it('refuses staying submitted after adding an unanswered blocking question', () => {
    const stored = { ...loadIntakeFixture(), step: 'submitted' as const }
    const questions = [...stored.questions, { id: 'Q-004', text: 'Hosting?', askedBy: 'human' as const, blocking: true, answer: null }]
    expect(codeOf(applyIntakeUpdate({ stored, request: { ...toRequest(stored), questions }, project }))).toBe('intake_step_invalid')
  })

  it('refuses submitting with an unanswered blocking question', () => {
    const stored = { ...loadIntakeFixture(), step: 'review' as const }
    const questions = stored.questions.map((question) => ({ ...question, answer: null }))
    const result = applyIntakeUpdate({ stored, request: { ...toRequest(stored), questions, step: 'submitted' }, project })
    expect(codeOf(result)).toBe('intake_step_invalid')
  })

  it('refuses a chosen platform other than the frozen project profile', () => {
    const stored = loadIntakeFixture()
    const chosen = { ...stored.platform.chosen!, profileId: 'react-vite' }
    const result = applyIntakeUpdate({ stored, request: { ...toRequest(stored), platform: { ...stored.platform, chosen } }, project })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(422)
      expect(result.body.code).toBe('target_profile_frozen')
      expect(result.body.details[0].path).toBe('platform.chosen')
    }
    const newerVersion = { ...stored.platform.chosen!, profileVersion: 2 }
    expect(codeOf(applyIntakeUpdate({ stored, request: { ...toRequest(stored), platform: { ...stored.platform, chosen: newerVersion } }, project }))).toBe('target_profile_frozen')
  })

  it('refuses duplicate question ids', () => {
    const stored = loadIntakeFixture()
    const result = applyIntakeUpdate({ stored, request: { ...toRequest(stored), questions: [...stored.questions, stored.questions[0]] }, project })
    expect(codeOf(result)).toBe('duplicate_stable_id')
  })

  it('negative intake fixtures are refused by the schema before any rule runs', () => {
    const negatives = loadNegativeFlowFixtures().filter((fixture) => fixture.name.startsWith('intake.'))
    expect(negatives.length).toBeGreaterThan(0)
    for (const fixture of negatives) {
      const parsed = parseFlowVersioned(deliveryFlowDocumentSchemas, fixture.document)
      expect(parsed.ok).toBe(false)
      if (!parsed.ok) expect([parsed.body.code, parsed.status]).toEqual([fixture.expected.code, fixture.expected.status])
    }
  })
})

describe('mergeScopingProposal', () => {
  const importInto = (stored: IntakeV1 | null, proposal: ScopingProposalV1, importedManifests = [] as { manifestId: string; manifestHash: string }[]) =>
    mergeScopingProposal({ stored, importedManifests, proposal, project, now })

  it('merges the proposal: the existing answer wins, the proposal ref and manifest are recorded', () => {
    const stored = { ...loadIntakeFixture(), proposals: [] }
    const proposal = loadScopingProposalFixture()
    const result = importInto(stored, proposal)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const manifestHash = hashScopingProposal(proposal)
    expect(result.duplicate).toBe(false)
    expect(result.manifestHash).toBe(manifestHash)
    expect(result.intake.questions).toEqual(stored.questions)
    expect(result.intake.questions[0].answer).not.toBeNull()
    expect(result.intake.proposals).toEqual([
      { proposalId: proposal.manifestId, kind: 'scope', contentHash: manifestHash, proposedAt: now, status: 'proposed' },
    ])
    expect(result.importedManifests).toEqual([{ manifestId: proposal.manifestId, manifestHash }])
    expect(result.intake.platform).toEqual(stored.platform)
  })

  it('appends new questions to an empty intake and stores a differing platform recommendation', () => {
    const base = loadScopingProposalFixture()
    const proposal: ScopingProposalV1 = {
      ...base,
      manifestId: 'platform-001',
      kind: 'platform',
      scope: null,
      platform: { profileId: 'react-vite', profileVersion: 1, rationale: 'SPA', alternatives: [] },
    }
    const result = importInto(null, proposal)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.intake.step).toBe('brief')
    expect(result.intake.questions.map((question) => question.id)).toEqual(['Q-001'])
    expect(result.intake.platform.recommendation?.profileId).toBe('react-vite')
    expect(result.intake.platform.chosen).toBeNull()
  })

  it('a replay with the same manifest id and hash is a duplicate and changes nothing', () => {
    const stored = { ...loadIntakeFixture(), proposals: [] }
    const proposal = loadScopingProposalFixture()
    const first = importInto(stored, proposal)
    if (!first.ok) throw new Error('first import failed')
    const replay = importInto(first.intake, proposal, first.importedManifests)
    expect(replay.ok).toBe(true)
    if (!replay.ok) return
    expect(replay.duplicate).toBe(true)
    expect(replay.intake).toEqual(first.intake)
    expect(replay.importedManifests).toEqual(first.importedManifests)
  })

  it('a proposal ref already on the intake is replayed by its hash even when the manifest list lost it', () => {
    const proposal = loadScopingProposalFixture()
    const stored = loadIntakeFixture()
    const conflict = importInto(stored, proposal)
    expect(codeOf(conflict)).toBe('idempotency_conflict')
    const matching = { ...stored, proposals: [{ ...stored.proposals[0], contentHash: hashScopingProposal(proposal), status: 'accepted' as const }] }
    const replay = importInto(matching, proposal)
    expect(replay.ok && replay.duplicate).toBe(true)
    if (replay.ok) expect(replay.intake.proposals[0].status).toBe('accepted')
  })

  it('new agent questions arrive unanswered and a blocking one reopens a submitted intake to review', () => {
    const stored = { ...loadIntakeFixture(), proposals: [], step: 'submitted' as const }
    const base = loadScopingProposalFixture()
    const question = { id: 'Q-010', text: 'Do you need a cookie banner?', askedBy: 'agent' as const, blocking: true, answer: { text: 'Yes', answeredAt: now } }
    const result = importInto(stored, { ...base, questions: [...base.questions, question] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.intake.questions.find((candidate) => candidate.id === 'Q-010')?.answer).toBeNull()
    expect(result.intake.step).toBe('review')
    const nonBlocking = importInto(stored, { ...base, questions: [{ ...question, blocking: false }] })
    expect(nonBlocking.ok && nonBlocking.intake.step).toBe('submitted')
  })

  it('key order does not change the manifest hash', () => {
    const proposal = loadScopingProposalFixture()
    const reordered = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(proposal).reverse()))) as ScopingProposalV1
    expect(hashScopingProposal(reordered)).toBe(hashScopingProposal(proposal))
  })

  it('the same manifest id with other content is an idempotency_conflict', () => {
    const proposal = loadScopingProposalFixture()
    const result = importInto(loadIntakeFixture(), { ...proposal, producedBy: { tool: 'other-session', sessionRef: null } }, [
      { manifestId: proposal.manifestId, manifestHash: hashScopingProposal(proposal) },
    ])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(409)
      expect(result.body.code).toBe('idempotency_conflict')
    }
  })

  it('a proposal of another project is a foreign_reference, checked before replay', () => {
    const proposal = { ...loadScopingProposalFixture(), projectId: '22222222-2222-4222-8222-222222222222' }
    const result = importInto(loadIntakeFixture(), proposal, [{ manifestId: proposal.manifestId, manifestHash: hashScopingProposal(proposal) }])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(422)
      expect(result.body.code).toBe('foreign_reference')
      expect(result.body.details[0]).toMatchObject({ path: 'projectId', code: 'foreign_project' })
    }
  })

  it('refuses the import when the stored choice contradicts the frozen profile', () => {
    const stored = loadIntakeFixture()
    const tampered = { ...stored, proposals: [], platform: { ...stored.platform, chosen: { ...stored.platform.chosen!, profileId: 'react-vite' } } }
    expect(codeOf(importInto(tampered, loadScopingProposalFixture()))).toBe('target_profile_frozen')
  })

  it('a full proposal list answers validation_failed instead of growing past the cap', () => {
    const stored = loadIntakeFixture()
    const proposals = Array.from({ length: 50 }, (_, index) => ({ ...stored.proposals[0], proposalId: `p-${index}` }))
    expect(codeOf(importInto({ ...stored, proposals }, loadScopingProposalFixture()))).toBe('validation_failed')
  })

  it('a scope proposal without content is refused by the schema (negative fixture)', () => {
    const fixture = loadNegativeFlowFixtures().find((candidate) => candidate.name === 'scoping-proposal.scope-without-content')!
    const parsed = parseFlowVersioned(deliveryFlowDocumentSchemas, fixture.document)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.body.code).toBe('manifest_required')
  })
})

describe('defaultIntake seeding', () => {
  it('uses the trimmed project brief as the business goal and keeps every other field empty', () => {
    const intake = defaultIntake('11111111-1111-4111-8111-111111111111', ' Sell three services from the front page. ')
    expect(intake.brief.businessGoal).toBe('Sell three services from the front page.')
    expect({ ...intake.brief, businessGoal: null }).toEqual(defaultIntake('11111111-1111-4111-8111-111111111111').brief)
  })

  it.each([undefined, null, '   ', 'x'.repeat(8001)])('leaves the business goal empty for %p', (brief) => {
    expect(defaultIntake('11111111-1111-4111-8111-111111111111', brief).brief.businessGoal).toBeNull()
  })
})
