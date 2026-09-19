import { listUnprovenAcIds, proveAcceptanceCriteria, type AcProofEvidence, type AcProofInput } from '../acProof'
import type { CheckStatus, DeliveryEvidenceKind, SourceRevision } from '../contracts'
import { loadBaselineContentFixture, loadResultManifestFixture } from '../fixtures'

const BASELINE_ID = '5a5a5a5a-5555-4555-8555-555555555555'
const OTHER_BASELINE_ID = '6b6b6b6b-6666-4666-8666-666666666666'
const manifest = loadResultManifestFixture('git')
const content = loadBaselineContentFixture()
const REVISION = manifest.resultRevision
const OTHER_REVISION: SourceRevision = { kind: 'git', commitSha: 'c'.repeat(40) }
const TEST_AC_001 = content.acTestMap['AC-001'][0]
const TEST_AC_002 = content.acTestMap['AC-002'][0]
const MANUAL_CHECK_ID = content.manualChecks['AC-003']

let nextRow = 0

function row(kind: DeliveryEvidenceKind, payload: unknown, overrides: Partial<AcProofEvidence> = {}): AcProofEvidence {
  nextRow += 1
  return { id: `evidence-${nextRow}`, kind, baselineId: BASELINE_ID, sourceRevision: REVISION, payload, ...overrides }
}

function check(testId: string, status: CheckStatus, sourceRevision: SourceRevision = REVISION) {
  return { testId, status, sourceRevision, acIds: [] }
}

function manualReview(verdict: 'approved' | 'changes_requested', reviewerKind: 'human' | 'agent' = 'human', manualCheckId = MANUAL_CHECK_ID) {
  return row('review', { verdict, summary: 'checked by eye', manualCheckId, reviewer: { kind: reviewerKind } })
}

function prove(evidence: AcProofEvidence[], overrides: Partial<AcProofInput> = {}) {
  return proveAcceptanceCriteria({
    acIds: ['AC-001', 'AC-002'],
    acTestMap: content.acTestMap,
    manualChecks: content.manualChecks,
    baselineId: BASELINE_ID,
    revision: REVISION,
    evidence,
    ...overrides,
  })
}

function statuses(evidence: AcProofEvidence[], overrides: Partial<AcProofInput> = {}) {
  return Object.fromEntries(prove(evidence, overrides).map((proof) => [proof.acId, proof.status]))
}

describe('proveAcceptanceCriteria: required tests', () => {
  it('proves every AC when the accepted manifest passed all required tests', () => {
    const result = row('result_manifest', manifest)
    const proofs = prove([result])
    expect(proofs.map((proof) => [proof.acId, proof.status, proof.proven])).toEqual([
      ['AC-001', 'passed', true],
      ['AC-002', 'passed', true],
    ])
    expect(proofs[0].tests).toEqual([{ testId: TEST_AC_001, status: 'passed', evidenceId: result.id }])
    expect(listUnprovenAcIds(proofs)).toEqual([])
  })

  it.each(['not_run', 'failed'] as const)('never folds %s into passed', (status) => {
    const evidence = [row('test', { checks: [check(TEST_AC_001, 'passed'), check(TEST_AC_002, status)] })]
    expect(statuses(evidence)).toEqual({ 'AC-001': 'passed', 'AC-002': status })
    expect(listUnprovenAcIds(prove(evidence))).toEqual(['AC-002'])
  })

  it('reports a required test nobody ran as missing', () => {
    const proofs = prove([row('test', { checks: [check(TEST_AC_001, 'passed')] })])
    expect(proofs[1]).toMatchObject({ status: 'missing', proven: false, tests: [{ testId: TEST_AC_002, status: 'missing', evidenceId: null }] })
  })

  it('reports an AC without required tests and without a manual check as missing', () => {
    const proofs = prove([row('result_manifest', manifest)], { acIds: ['AC-009'], acTestMap: { ...content.acTestMap, 'AC-009': [] } })
    expect(proofs).toEqual([{ acId: 'AC-009', status: 'missing', proven: false, tests: [], manualCheck: null }])
  })

  it('ignores evidence of another revision or another baseline', () => {
    const passed = { checks: [check(TEST_AC_001, 'passed'), check(TEST_AC_002, 'passed')] }
    expect(statuses([row('test', passed, { sourceRevision: OTHER_REVISION })])).toEqual({ 'AC-001': 'missing', 'AC-002': 'missing' })
    expect(statuses([row('test', passed, { baselineId: OTHER_BASELINE_ID })])).toEqual({ 'AC-001': 'missing', 'AC-002': 'missing' })
    expect(statuses([row('test', passed, { sourceRevision: null })])).toEqual({ 'AC-001': 'missing', 'AC-002': 'missing' })
  })

  it('ignores a check that ran on another revision than its evidence row claims', () => {
    const evidence = [row('test', { checks: [check(TEST_AC_001, 'passed', OTHER_REVISION), check(TEST_AC_002, 'passed')] })]
    expect(statuses(evidence)).toEqual({ 'AC-001': 'missing', 'AC-002': 'passed' })
  })

  it('keeps a failure on the revision even when a later run passed', () => {
    const evidence = [row('test', { checks: [check(TEST_AC_001, 'failed')] }), row('test', { checks: [check(TEST_AC_001, 'passed')] })]
    expect(statuses(evidence)['AC-001']).toBe('failed')
    expect(statuses([...evidence].reverse())['AC-001']).toBe('failed')
  })

  it('lets a real run replace not_run, in either order', () => {
    const notRun = row('result_manifest', { checks: [check(TEST_AC_001, 'not_run')] })
    const passed = row('test', { checks: [check(TEST_AC_001, 'passed')] })
    expect(prove([notRun, passed])[0]).toMatchObject({ status: 'passed', tests: [{ evidenceId: passed.id }] })
    expect(prove([passed, notRun])[0]).toMatchObject({ status: 'passed', tests: [{ evidenceId: passed.id }] })
  })

  it('counts checks only from result manifests and test evidence', () => {
    const passed = { checks: [check(TEST_AC_001, 'passed'), check(TEST_AC_002, 'passed')] }
    const kinds: DeliveryEvidenceKind[] = ['reference_material', 'screenshot', 'scan', 'deployment', 'review']
    expect(statuses(kinds.map((kind) => row(kind, passed)))).toEqual({ 'AC-001': 'missing', 'AC-002': 'missing' })
  })

  it('ignores malformed payloads and does not match inherited keys', () => {
    const evidence = [row('test', null), row('test', { checks: 'none' }), row('test', { checks: [{ testId: TEST_AC_001 }, 7] })]
    expect(statuses(evidence)).toEqual({ 'AC-001': 'missing', 'AC-002': 'missing' })
    expect(prove([], { acIds: ['constructor'] })).toEqual([{ acId: 'constructor', status: 'missing', proven: false, tests: [], manualCheck: null }])
  })
})

describe('proveAcceptanceCriteria: manual checks', () => {
  const manualOnly = { acIds: ['AC-003'] }

  it('keeps a manual AC unproven until a human approves its manual check', () => {
    expect(prove([row('result_manifest', manifest)], manualOnly)[0]).toMatchObject({
      status: 'missing',
      proven: false,
      manualCheck: { manualCheckId: MANUAL_CHECK_ID, status: 'missing', evidenceId: null },
    })
    const approval = manualReview('approved')
    expect(prove([approval], manualOnly)[0]).toMatchObject({
      status: 'passed',
      proven: true,
      manualCheck: { manualCheckId: MANUAL_CHECK_ID, status: 'approved', evidenceId: approval.id },
    })
  })

  it('never accepts an agent verdict, a plain review or another manual check id', () => {
    expect(statuses([manualReview('approved', 'agent')], manualOnly)).toEqual({ 'AC-003': 'missing' })
    expect(statuses([row('review', { verdict: 'approved', summary: 'ok', reviewer: { kind: 'human' } })], manualOnly)).toEqual({ 'AC-003': 'missing' })
    expect(statuses([manualReview('approved', 'human', 'MC-other')], manualOnly)).toEqual({ 'AC-003': 'missing' })
  })

  it('reports a human changes_requested as failed and lets the latest human verdict win', () => {
    expect(statuses([manualReview('changes_requested')], manualOnly)).toEqual({ 'AC-003': 'failed' })
    expect(statuses([manualReview('changes_requested'), manualReview('approved')], manualOnly)).toEqual({ 'AC-003': 'passed' })
    expect(statuses([manualReview('approved'), manualReview('changes_requested')], manualOnly)).toEqual({ 'AC-003': 'failed' })
  })

  it('does not count a manual verdict given on another revision', () => {
    const stale = row('review', { verdict: 'approved', summary: 'ok', manualCheckId: MANUAL_CHECK_ID, reviewer: { kind: 'human' } }, { sourceRevision: OTHER_REVISION })
    expect(statuses([stale], manualOnly)).toEqual({ 'AC-003': 'missing' })
  })

  it('needs both the tests and the manual check when an AC has both', () => {
    const both = { acIds: ['AC-001'], manualChecks: { 'AC-001': MANUAL_CHECK_ID } }
    const passed = row('test', { checks: [check(TEST_AC_001, 'passed')] })
    expect(statuses([passed], both)).toEqual({ 'AC-001': 'missing' })
    expect(statuses([manualReview('approved')], both)).toEqual({ 'AC-001': 'missing' })
    expect(statuses([passed, manualReview('approved')], both)).toEqual({ 'AC-001': 'passed' })
  })
})
