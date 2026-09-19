import { baselineContentV1Schema, type BaselineContentV1, type DeliveryCheckResult } from '../contracts'
import {
  assertStableIds,
  buildBaselineContent,
  checkTaskReadiness,
  collectReadinessReasons,
  hashBaseline,
  latestBaselineDecisions,
  nextBaselineVersion,
  resolveActiveBaseline,
  type BaselineDecisionRecord,
  type BaselineDraftComment,
  type BaselineDraftInput,
  type TaskReadinessInput,
} from '../baseline'
import { loadBaselineContentFixture } from '../fixtures/index'
import { getTargetProfile } from '../targetProfiles'

const BASELINE_ID = '44444444-4444-4444-8444-444444444444'
const OTHER_HASH = 'f'.repeat(64)

function draftFromFixture(): BaselineDraftInput & { comments: BaselineDraftComment[] } {
  const { schemaVersion: _schemaVersion, resolvedComments, importedManifestHashes: _hashes, ...sections } = loadBaselineContentFixture()
  return {
    ...sections,
    comments: [
      ...resolvedComments.map((comment) => ({ ...comment, status: 'resolved' as const })),
      { id: 'C-open', screenAttachmentId: null, anchor: null, body: 'Still discussing the empty state', status: 'open' as const },
    ],
  }
}

function buildOrThrow(draft: BaselineDraftInput): { content: BaselineContentV1; contentHash: string } {
  const built = buildBaselineContent(draft)
  if (!built.ok) throw new Error(`[internal] expected a valid baseline, got ${built.body.code}`)
  return built
}

function errorCode(result: { ok: boolean; body?: { code: string } }): string | null {
  return result.ok ? null : (result.body?.code ?? null)
}

function detailCodes(result: DeliveryCheckResult): string[] {
  return result.ok ? [] : result.body.details.map((detail) => detail.code)
}

describe('buildBaselineContent', () => {
  it('reproduces the frozen baseline fixture from its draft', () => {
    const built = buildBaselineContent(draftFromFixture())
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.content).toEqual(loadBaselineContentFixture())
    expect(built.contentHash).toBe(hashBaseline(loadBaselineContentFixture()))
    expect(baselineContentV1Schema.safeParse(built.content).success).toBe(true)
  })

  it('leaves open comments out of the snapshot and reports them', () => {
    const built = buildBaselineContent(draftFromFixture())
    expect(built.ok && built.openCommentIds).toEqual(['C-open'])
    expect(built.ok && built.content.resolvedComments.map((comment) => comment.id)).not.toContain('C-open')
  })

  it('is not changed by a draft mutated after the build', () => {
    const draft = draftFromFixture()
    const built = buildOrThrow(draft)
    const hashBefore = built.contentHash
    const requirements = draft.requirements as { title: string }[]
    requirements[0].title = 'Changed after approval'
    ;(draft.tokens as Record<string, unknown>).injected = { color: '#000000' }
    ;(draft.acTestMap as Record<string, string[]>)['AC-001'].push('sneaked-in test')
    expect(hashBaseline(built.content)).toBe(hashBefore)
    expect(built.content).toEqual(loadBaselineContentFixture())
    expect(buildOrThrow(draft).contentHash).not.toBe(hashBefore)
  })

  it('hashes independently of key order and records imported manifest hashes', () => {
    const draft = draftFromFixture()
    const reordered = Object.fromEntries(Object.entries(draft).reverse()) as BaselineDraftInput
    expect(buildOrThrow(reordered).contentHash).toBe(buildOrThrow(draft).contentHash)
    const withImport = buildBaselineContent(draft, { importedManifestHashes: [OTHER_HASH] })
    expect(withImport.ok && withImport.content.importedManifestHashes).toEqual([OTHER_HASH])
    expect(withImport.ok && withImport.contentHash).not.toBe(buildOrThrow(draft).contentHash)
  })

  it('rejects a draft without acceptance criteria', () => {
    const result = buildBaselineContent({ ...draftFromFixture(), acceptanceCriteria: [], acTestMap: {}, manualChecks: {} })
    expect(errorCode(result)).toBe('missing_acceptance_criteria')
    expect(errorCode(buildBaselineContent({}))).toBe('missing_acceptance_criteria')
  })

  it('rejects duplicate ids, foreign requirements and maps pointing at unknown criteria', () => {
    const draft = draftFromFixture()
    const criteria = draft.acceptanceCriteria as { id: string; requirementId: string; description: string }[]
    expect(errorCode(buildBaselineContent({ ...draft, acceptanceCriteria: [...criteria, criteria[0]] }))).toBe('duplicate_stable_id')
    expect(
      errorCode(buildBaselineContent({ ...draft, acceptanceCriteria: [{ ...criteria[0], requirementId: 'REQ-foreign' }, ...criteria.slice(1)] })),
    ).toBe('foreign_reference')
    expect(errorCode(buildBaselineContent({ ...draft, acTestMap: { 'AC-unknown': ['some test'] } }))).toBe('unknown_ac')
  })

  it('answers validation_failed instead of throwing for a draft that is not canonical JSON', () => {
    const draft = draftFromFixture()
    let nested: Record<string, unknown> = { leaf: true }
    for (let level = 0; level < 70; level += 1) nested = { nested }
    expect(errorCode(buildBaselineContent({ ...draft, tokens: { deep: nested } }))).toBe('validation_failed')
    expect(errorCode(buildBaselineContent({ ...draft, tokens: { callback: () => undefined } }))).toBe('validation_failed')
  })

  it('rejects a resolved comment without a resolution', () => {
    const draft = draftFromFixture()
    const comments: BaselineDraftComment[] = [{ id: 'C-1', screenAttachmentId: null, anchor: null, body: 'Button colour', status: 'resolved' }]
    expect(errorCode(buildBaselineContent({ ...draft, comments }))).toBe('validation_failed')
  })
})

describe('nextBaselineVersion', () => {
  it('continues after the highest known version', () => {
    expect(nextBaselineVersion([])).toBe(1)
    expect(nextBaselineVersion([1, 2, 3])).toBe(4)
    expect(nextBaselineVersion([3, 1])).toBe(4)
    expect(nextBaselineVersion([2, Number.NaN, -5, 1.5])).toBe(3)
  })
})

describe('assertStableIds', () => {
  const valid = { requirements: [{ id: 'REQ-001' }, { id: 'REQ-002' }], acceptanceCriteria: [{ id: 'AC-001' }] }

  it('accepts unique ids, also when a requirement and a criterion share one', () => {
    expect(assertStableIds(valid)).toEqual({ ok: true })
    expect(assertStableIds({ requirements: [{ id: 'X-1' }], acceptanceCriteria: [{ id: 'X-1' }] })).toEqual({ ok: true })
  })

  it('rejects duplicates and empty ids', () => {
    const duplicate = assertStableIds({ ...valid, acceptanceCriteria: [{ id: 'AC-001' }, { id: 'AC-001' }] })
    expect(errorCode(duplicate)).toBe('duplicate_stable_id')
    expect(!duplicate.ok && duplicate.body.details[0].path).toBe('acceptanceCriteria.1.id')
    expect(errorCode(assertStableIds({ ...valid, requirements: [{ id: '' }] }))).toBe('validation_failed')
    expect(errorCode(assertStableIds({ ...valid, requirements: [{ id: '1-starts-with-digit' }] }))).toBe('validation_failed')
  })
})

describe('baseline decisions', () => {
  const subject = { contentHash: 'a'.repeat(64), version: 2 }

  function decision(overrides: Partial<BaselineDecisionRecord>): BaselineDecisionRecord {
    return { kind: 'requirements', verdict: 'approved', subjectHash: subject.contentHash, subjectVersion: subject.version, decidedAt: '2026-09-19T10:00:00.000Z', ...overrides }
  }

  const bothApproved = [decision({ kind: 'requirements' }), decision({ kind: 'design' })]

  it('is active only when both kinds are approved for this hash and version', () => {
    expect(resolveActiveBaseline(bothApproved, subject)).toBe(true)
    expect(resolveActiveBaseline([decision({ kind: 'requirements' })], subject)).toBe(false)
    expect(resolveActiveBaseline([decision({ kind: 'design' })], subject)).toBe(false)
    expect(resolveActiveBaseline([], subject)).toBe(false)
  })

  it('ignores decisions made for another hash or version', () => {
    const forOldHash = [decision({ kind: 'requirements' }), decision({ kind: 'design', subjectHash: OTHER_HASH })]
    expect(resolveActiveBaseline(forOldHash, subject)).toBe(false)
    const forOldVersion = [decision({ kind: 'requirements' }), decision({ kind: 'design', subjectVersion: 1 })]
    expect(resolveActiveBaseline(forOldVersion, subject)).toBe(false)
    const rejectOfOldHash = [...bothApproved, decision({ kind: 'design', verdict: 'rejected', subjectHash: OTHER_HASH, decidedAt: '2026-09-19T12:00:00.000Z' })]
    expect(resolveActiveBaseline(rejectOfOldHash, subject)).toBe(true)
  })

  it('lets a later reject of the same content void the approval whatever version it names', () => {
    const later = '2026-09-19T12:00:00.000Z'
    expect(resolveActiveBaseline([...bothApproved, decision({ kind: 'design', verdict: 'rejected', subjectVersion: null, decidedAt: later })], subject)).toBe(false)
    expect(resolveActiveBaseline([...bothApproved, decision({ kind: 'design', verdict: 'rejected', subjectVersion: 1, decidedAt: later })], subject)).toBe(false)
    const earlier = decision({ kind: 'design', verdict: 'rejected', subjectVersion: 1, decidedAt: '2026-09-19T09:00:00.000Z' })
    expect(resolveActiveBaseline([earlier, ...bothApproved], subject)).toBe(true)
  })

  it('lets a later reject void an earlier approve, and a later approve restore it, in any input order', () => {
    const rejected = decision({ kind: 'design', verdict: 'rejected', decidedAt: '2026-09-19T11:00:00.000Z' })
    expect(resolveActiveBaseline([...bothApproved, rejected], subject)).toBe(false)
    expect(resolveActiveBaseline([rejected, ...bothApproved], subject)).toBe(false)
    const reapproved = decision({ kind: 'design', decidedAt: new Date('2026-09-19T12:00:00.000Z') })
    expect(resolveActiveBaseline([reapproved, rejected, ...bothApproved], subject)).toBe(true)
    expect(latestBaselineDecisions([reapproved, rejected, ...bothApproved], subject).design).toBe(reapproved)
  })

  it('fails closed on a tie and on an unreadable decision time', () => {
    const tie = decision({ kind: 'design', verdict: 'rejected' })
    expect(resolveActiveBaseline([...bothApproved, tie], subject)).toBe(false)
    expect(resolveActiveBaseline([tie, ...bothApproved], subject)).toBe(false)
    const unreadable = decision({ kind: 'design', decidedAt: 'yesterday' })
    expect(resolveActiveBaseline([decision({ kind: 'requirements' }), unreadable], subject)).toBe(false)
    expect(resolveActiveBaseline([unreadable, ...bothApproved], subject)).toBe(false)
  })

  it('does not count deploy or release decisions', () => {
    expect(resolveActiveBaseline([decision({ kind: 'requirements' }), decision({ kind: 'deploy' })], subject)).toBe(false)
  })
})

describe('checkTaskReadiness', () => {
  const profile = getTargetProfile('react-vite', 1)
  const content = loadBaselineContentFixture()
  const contentHash = hashBaseline(content)

  function approvals(hash = contentHash, version = 1): BaselineDecisionRecord[] {
    return (['requirements', 'design'] as const).map((kind) => ({
      kind,
      verdict: 'approved' as const,
      subjectHash: hash,
      subjectVersion: version,
      decidedAt: '2026-09-19T10:00:00.000Z',
    }))
  }

  function readyInput(overrides: Partial<TaskReadinessInput> = {}): TaskReadinessInput {
    return {
      task: { baselineId: BASELINE_ID, acIds: ['AC-001', 'AC-003'], targetProfileId: 'react-vite', targetProfileVersion: 1 },
      baseline: { id: BASELINE_ID, version: 1, contentHash, content },
      decisions: approvals(),
      profile,
      ...overrides,
    }
  }

  function withContent(changes: Partial<BaselineContentV1>): TaskReadinessInput {
    const changed = { ...content, ...changes }
    const changedHash = hashBaseline(changed)
    return readyInput({ baseline: { id: BASELINE_ID, version: 1, contentHash: changedHash, content: changed }, decisions: approvals(changedHash) })
  }

  it('passes for an approved baseline with a render, known criteria and required tests or a manual check', () => {
    expect(profile).toBeDefined()
    expect(checkTaskReadiness(readyInput())).toEqual({ ok: true })
    expect(collectReadinessReasons(readyInput())).toEqual([])
  })

  it('rejects a task without acceptance criteria', () => {
    const result = checkTaskReadiness(readyInput({ task: { ...readyInput().task, acIds: [] } }))
    expect(errorCode(result)).toBe('missing_acceptance_criteria')
  })

  it('rejects an acceptance criterion the baseline does not know', () => {
    const result = checkTaskReadiness(readyInput({ task: { ...readyInput().task, acIds: ['AC-001', 'AC-999'] } }))
    expect(errorCode(result)).toBe('unknown_ac')
    expect(!result.ok && result.body.details.map((detail) => detail.path)).toEqual(['acIds.AC-999'])
  })

  it('rejects a baseline without a stored render', () => {
    expect(checkTaskReadiness(withContent({})).ok).toBe(true)
    expect(errorCode(checkTaskReadiness(withContent({ screens: [] })))).toBe('missing_render')
  })

  it.each<[string, BaselineDecisionRecord[], string]>([
    ['no decisions', [], 'requirements_decision_missing'],
    ['only the requirements decision', approvals().slice(0, 1), 'design_decision_missing'],
    ['only the design decision', approvals().slice(1), 'requirements_decision_missing'],
    ['decisions for an older hash', approvals(OTHER_HASH), 'requirements_decision_missing'],
    ['decisions for an older version', approvals(contentHash, 7), 'requirements_decision_missing'],
    [
      'a later reject',
      [...approvals(), { kind: 'design', verdict: 'rejected', subjectHash: contentHash, subjectVersion: 1, decidedAt: '2026-09-19T11:00:00.000Z' }],
      'design_rejected',
    ],
  ])('rejects %s as baseline_not_approved', (_label, decisions, detailCode) => {
    const result = checkTaskReadiness(readyInput({ decisions }))
    expect(errorCode(result)).toBe('baseline_not_approved')
    expect(!result.ok && result.status).toBe(422)
    expect(detailCodes(result)).toContain(detailCode)
  })

  it('names an approval with an unreadable time as invalid, not as rejected', () => {
    const decisions = approvals().map((entry) => (entry.kind === 'design' ? { ...entry, decidedAt: 'yesterday' } : entry))
    expect(detailCodes(checkTaskReadiness(readyInput({ decisions })))).toEqual(['design_decision_invalid'])
  })

  it('rejects a required criterion with an empty or missing test map and no manual check', () => {
    const emptyList = checkTaskReadiness(withContent({ acTestMap: { ...content.acTestMap, 'AC-001': [] } }))
    expect(errorCode(emptyList)).toBe('missing_required_tests')
    expect(!emptyList.ok && emptyList.body.details[0].path).toBe('acTestMap.AC-001')
    const noManualCheck = checkTaskReadiness(withContent({ manualChecks: {} }))
    expect(errorCode(noManualCheck)).toBe('missing_required_tests')
    expect(!noManualCheck.ok && noManualCheck.body.details[0].path).toBe('acTestMap.AC-003')
  })

  it('does not treat inherited object keys as a test mapping', () => {
    const result = checkTaskReadiness(readyInput({ task: { ...readyInput().task, acIds: ['constructor'] } }))
    expect(errorCode(result)).toBe('unknown_ac')
  })

  it('rejects an unknown or mismatching target profile', () => {
    const unknown = checkTaskReadiness(readyInput({ profile: undefined }))
    expect(errorCode(unknown)).toBe('unknown_target_profile')
    expect(detailCodes(unknown)).toEqual(['unknown_target_profile'])
    const mismatch = checkTaskReadiness(readyInput({ profile: getTargetProfile('wordpress-theme', 1) }))
    expect(errorCode(mismatch)).toBe('unknown_target_profile')
    expect(detailCodes(mismatch)).toEqual(['target_profile_mismatch'])
    const versionMismatch = checkTaskReadiness(readyInput({ task: { ...readyInput().task, targetProfileVersion: 2 } }))
    expect(detailCodes(versionMismatch)).toEqual(['target_profile_mismatch'])
  })

  it('rejects a task pinned to another baseline and a baseline whose content was altered', () => {
    const otherBaseline = checkTaskReadiness(readyInput({ task: { ...readyInput().task, baselineId: null } }))
    expect(errorCode(otherBaseline)).toBe('baseline_mismatch')
    const altered = checkTaskReadiness(readyInput({ baseline: { id: BASELINE_ID, version: 1, contentHash, content: { ...content, planSummary: 'edited in place' } } }))
    expect(errorCode(altered)).toBe('hash_mismatch')
  })

  it('reports every reason at once so the user can fix them in one pass', () => {
    const result = checkTaskReadiness({ ...withContent({ screens: [], manualChecks: {} }), decisions: [] })
    expect(errorCode(result)).toBe('baseline_not_approved')
    expect(detailCodes(result)).toEqual(['requirements_decision_missing', 'design_decision_missing', 'missing_render', 'missing_required_tests'])
  })
})
