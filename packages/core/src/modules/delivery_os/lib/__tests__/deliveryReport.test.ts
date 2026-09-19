import {
  DELIVERY_SCHEMA_VERSIONS,
  deliveryDocumentSchemas,
  deliveryReportV1Schema,
  parseVersioned,
  type CheckStatus,
  type SourceRevision,
} from '../contracts'
import {
  buildDeliveryReport,
  selectDefaultRevision,
  type DeliveryReportDecision,
  type DeliveryReportEvidence,
  type DeliveryReportInput,
} from '../deliveryReport'
import { loadBaselineContentFixture, loadDeliveryReportFixture, loadResultManifestFixture } from '../fixtures'
import { getTargetProfile, type TargetProfile } from '../targetProfiles'
import { hashBaseline } from '../baseline'

const manifest = loadResultManifestFixture('git')
const content = loadBaselineContentFixture()
const PROJECT_ID = manifest.projectId
const BASELINE_ID = manifest.baselineId
const OTHER_BASELINE_ID = '66666666-6666-4666-8666-666666666666'
const TASK_ID = manifest.taskId
const BASELINE_HASH = hashBaseline(content)
const REVISION_A = manifest.resultRevision
const REVISION_B: SourceRevision = { kind: 'git', commitSha: 'b'.repeat(40) }
const TEST_AC_001 = content.acTestMap['AC-001'][0]
const TEST_AC_002 = content.acTestMap['AC-002'][0]
const MANUAL_CHECK_ID = content.manualChecks['AC-003']
const HASH = 'd'.repeat(64)
const SCAN_HASH = 'e'.repeat(64)

function requireProfile(id: string, version: number): TargetProfile {
  const profile = getTargetProfile(id, version)
  if (!profile) throw new Error(`[internal] unknown profile ${id}@${version}`)
  return profile
}
const profile = requireProfile('react-vite', 1)

let nextRow = 0
function uuid(index: number): string {
  return `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`
}

function row(kind: DeliveryReportEvidence['kind'], payload: unknown, overrides: Partial<DeliveryReportEvidence> = {}): DeliveryReportEvidence {
  nextRow += 1
  return {
    id: uuid(nextRow),
    projectId: PROJECT_ID,
    baselineId: BASELINE_ID,
    taskId: TASK_ID,
    kind,
    sourceRevision: REVISION_A,
    payload,
    rawReportHash: null,
    createdAt: new Date(Date.UTC(2026, 8, 19, 10, 0, nextRow)),
    ...overrides,
  }
}

function check(testId: string, status: CheckStatus | 'skipped', sourceRevision: SourceRevision = REVISION_A, checkId = 'unit-tests') {
  return { checkId, testId, status, sourceRevision, acIds: [], rawReportHash: HASH }
}

function tests(checks: readonly unknown[], overrides: Partial<DeliveryReportEvidence> = {}): DeliveryReportEvidence {
  return row('test', { rawReportHash: HASH, checks }, { rawReportHash: HASH, ...overrides })
}

function greenTests(sourceRevision: SourceRevision = REVISION_A): DeliveryReportEvidence {
  return tests([check(TEST_AC_001, 'passed', sourceRevision), check(TEST_AC_002, 'passed', sourceRevision)], { sourceRevision })
}

function scan(status: CheckStatus, sourceRevision: SourceRevision = REVISION_A): DeliveryReportEvidence {
  return row('scan', { checkId: 'dependency-audit', scanner: 'npm audit', status, rawReportHash: SCAN_HASH }, { taskId: null, sourceRevision, rawReportHash: SCAN_HASH })
}

function deployment(verified: boolean, sourceRevision: SourceRevision = REVISION_A): DeliveryReportEvidence {
  return row(
    'deployment',
    {
      url: 'https://preview.example.test/',
      environment: 'preview',
      buildId: 'build-1',
      deployedAt: '2026-09-19T10:05:00.000Z',
      uploadStatus: 'succeeded',
      verification: verified ? { status: 'verified', checkedAt: '2026-09-19T10:06:00.000Z', method: 'http', observedBuildId: 'build-1' } : null,
    },
    { taskId: null, sourceRevision },
  )
}

function review(verdict: 'approved' | 'changes_requested', reviewerKind: 'human' | 'agent' = 'human', sourceRevision: SourceRevision = REVISION_A): DeliveryReportEvidence {
  return row('review', { verdict, summary: 'looked at the screen', manualCheckId: MANUAL_CHECK_ID, reviewer: { kind: reviewerKind } }, { sourceRevision })
}

function deployDecision(sourceRevision: SourceRevision, overrides: Partial<DeliveryReportDecision> = {}): DeliveryReportDecision {
  nextRow += 1
  return {
    id: uuid(nextRow),
    projectId: PROJECT_ID,
    kind: 'deploy',
    subjectType: 'baseline',
    subjectId: BASELINE_ID,
    subjectHash: BASELINE_HASH,
    sourceRevision,
    verdict: 'approved',
    reason: null,
    decidedAt: new Date(Date.UTC(2026, 8, 19, 11, 0, nextRow)),
    ...overrides,
  }
}

function build(evidence: DeliveryReportEvidence[], overrides: Partial<DeliveryReportInput> = {}) {
  return buildDeliveryReport({
    projectId: PROJECT_ID,
    baseline: { id: BASELINE_ID, projectId: PROJECT_ID, contentHash: BASELINE_HASH, content },
    tasks: [{ id: TASK_ID, projectId: PROJECT_ID, baselineId: BASELINE_ID, title: 'Catalogue', status: 'verified', acIds: ['AC-001', 'AC-002', 'AC-003'] }],
    evidence,
    decisions: [],
    profile,
    revision: REVISION_A,
    limit: 100,
    ...overrides,
  })
}

function acStatuses(report: ReturnType<typeof build>) {
  return Object.fromEntries(report.acceptanceCriteria.map((criterion) => [criterion.acId, criterion.status]))
}

function blockingIds(report: ReturnType<typeof build>, gate: 'publishable' | 'releasable') {
  return report.gates[gate].blocking.map((blocker) => `${blocker.kind}:${blocker.id}:${blocker.status}`)
}

const proofEvidence = (sourceRevision: SourceRevision = REVISION_A) => [greenTests(sourceRevision), scan('passed', sourceRevision), review('approved', 'human', sourceRevision)]
const releasableEvidence = (sourceRevision: SourceRevision = REVISION_A) => [...proofEvidence(sourceRevision), deployment(true, sourceRevision)]

describe('buildDeliveryReport: AC status on the selected revision', () => {
  it('wrong: no test on the revision leaves the AC missing and the report not publishable', () => {
    const report = build([greenTests(REVISION_B), scan('passed')])
    expect(acStatuses(report)).toEqual({ 'AC-001': 'missing', 'AC-002': 'missing', 'AC-003': 'manual_pending' })
    expect(report.gates.publishable.ok).toBe(false)
    expect(blockingIds(report, 'publishable')).toEqual(['ac:AC-001:missing', 'ac:AC-002:missing'])
    expect(report.acceptanceCriteria[0].tests).toEqual([{ testId: TEST_AC_001, status: 'missing', evidenceId: null, rawReportHash: null }])
  })

  it('right: the same test on the selected revision proves the AC and publishes', () => {
    const evidence = [greenTests(), scan('passed')]
    const report = build(evidence)
    expect(acStatuses(report)).toEqual({ 'AC-001': 'passed', 'AC-002': 'passed', 'AC-003': 'manual_pending' })
    expect(report.gates.publishable).toEqual({ ok: true, blocking: [] })
    expect(report.acceptanceCriteria[0].tests).toEqual([{ testId: TEST_AC_001, status: 'passed', evidenceId: evidence[0].id, rawReportHash: HASH }])
  })

  it.each(['failed', 'skipped', 'not_run'] as const)('wrong: a %s required test blocks publish and is never folded into passed', (status) => {
    const report = build([tests([check(TEST_AC_001, 'passed'), check(TEST_AC_002, status)]), scan('passed')])
    const expected = status === 'skipped' ? 'not_run' : status
    expect(acStatuses(report)['AC-002']).toBe(expected)
    expect(report.progress).toEqual({ proven: 1, total: 3, unit: 'ac', percent: 33 })
    expect(blockingIds(report, 'publishable')).toEqual([`ac:AC-002:${expected}`])
  })

  it('right: the manifest fixture with every required test passed proves both automated ACs', () => {
    const report = build([row('result_manifest', manifest)])
    expect(acStatuses(report)).toEqual({ 'AC-001': 'passed', 'AC-002': 'passed', 'AC-003': 'manual_pending' })
    expect(report.progress).toEqual({ proven: 2, total: 3, unit: 'ac', percent: 66 })
  })

  it('wrong: evidence of a task commit is not inherited by the integration revision', () => {
    const report = build([greenTests(REVISION_A), scan('passed', REVISION_A)], { revision: REVISION_B })
    expect(report.revision).toEqual(REVISION_B)
    expect(report.revisionSource).toBe('selected')
    expect(acStatuses(report)).toEqual({ 'AC-001': 'missing', 'AC-002': 'missing', 'AC-003': 'manual_pending' })
    expect(report.scans).toEqual([{ checkId: 'dependency-audit', status: 'missing', reportedStatus: null, evidenceId: null, rawReportHash: null }])
  })

  it('right: evidence recorded on the integration revision itself counts', () => {
    const report = build([greenTests(REVISION_B), scan('passed', REVISION_B)], { revision: REVISION_B })
    expect(acStatuses(report)).toEqual({ 'AC-001': 'passed', 'AC-002': 'passed', 'AC-003': 'manual_pending' })
    expect(report.gates.publishable.ok).toBe(true)
  })

  it('wrong: evidence of another baseline or project earns nothing', () => {
    const foreignBaseline = build([greenTests(), scan('passed')].map((item) => ({ ...item, baselineId: OTHER_BASELINE_ID })))
    expect(acStatuses(foreignBaseline)).toEqual({ 'AC-001': 'missing', 'AC-002': 'missing', 'AC-003': 'manual_pending' })
    const foreignProject = build([greenTests(), scan('passed')].map((item) => ({ ...item, projectId: uuid(999) })))
    expect(acStatuses(foreignProject)).toEqual({ 'AC-001': 'missing', 'AC-002': 'missing', 'AC-003': 'manual_pending' })
  })
})

describe('buildDeliveryReport: manual acceptance criteria', () => {
  it('wrong: a manual AC stays manual_pending without a human review, even after an agent approves', () => {
    const report = build([greenTests(), scan('passed'), review('approved', 'agent')])
    expect(acStatuses(report)['AC-003']).toBe('manual_pending')
    expect(report.acceptanceCriteria[2].manualCheck).toEqual({ manualCheckId: MANUAL_CHECK_ID, status: 'missing', evidenceId: null })
    expect(report.gates.publishable.ok).toBe(true)
    expect(blockingIds(report, 'releasable')).toContain('ac:AC-003:manual_pending')
  })

  it('right: a human approval proves the manual AC', () => {
    const humanReview = review('approved')
    const report = build([greenTests(), scan('passed'), humanReview])
    expect(acStatuses(report)['AC-003']).toBe('passed')
    expect(report.acceptanceCriteria[2].manualCheck).toEqual({ manualCheckId: MANUAL_CHECK_ID, status: 'approved', evidenceId: humanReview.id })
    expect(blockingIds(report, 'releasable')).not.toContain('ac:AC-003:manual_pending')
  })

  it('wrong: the newest human verdict wins regardless of the order rows arrive in', () => {
    const approved = review('approved')
    const changesRequested = review('changes_requested')
    for (const order of [[approved, changesRequested], [changesRequested, approved]]) {
      const report = build([greenTests(), scan('passed'), ...order])
      expect(acStatuses(report)['AC-003']).toBe('failed')
      expect(report.acceptanceCriteria[2].manualCheck?.evidenceId).toBe(changesRequested.id)
    }
  })

  it('wrong: a human changes_requested makes the manual AC failed and blocks publish', () => {
    const report = build([greenTests(), scan('passed'), review('changes_requested')])
    expect(acStatuses(report)['AC-003']).toBe('failed')
    expect(blockingIds(report, 'publishable')).toEqual(['ac:AC-003:failed'])
  })
})

describe('buildDeliveryReport: scans', () => {
  it('wrong: a missing required scan blocks publish', () => {
    const report = build([greenTests()])
    expect(report.scans).toEqual([{ checkId: 'dependency-audit', status: 'missing', reportedStatus: null, evidenceId: null, rawReportHash: null }])
    expect(blockingIds(report, 'publishable')).toEqual(['scan:dependency-audit:missing'])
  })

  it('wrong: a not_run scan stays missing but keeps the evidence link', () => {
    const notRun = scan('not_run')
    const report = build([greenTests(), notRun])
    expect(report.scans[0]).toEqual({ checkId: 'dependency-audit', status: 'missing', reportedStatus: 'not_run', evidenceId: notRun.id, rawReportHash: SCAN_HASH })
    expect(report.gates.publishable.ok).toBe(false)
  })

  it('wrong: a failed scan blocks publish even when another run passed on the same revision', () => {
    const failed = scan('failed')
    const report = build([greenTests(), scan('passed'), failed])
    expect(report.scans[0]).toMatchObject({ status: 'failed', reportedStatus: 'failed', evidenceId: failed.id })
    expect(blockingIds(report, 'publishable')).toEqual(['scan:dependency-audit:failed'])
  })

  it('right: a passed scan row is present and publishes', () => {
    const passed = scan('passed')
    const report = build([greenTests(), passed])
    expect(report.scans[0]).toEqual({ checkId: 'dependency-audit', status: 'present', reportedStatus: 'passed', evidenceId: passed.id, rawReportHash: SCAN_HASH })
    expect(report.gates.publishable.ok).toBe(true)
  })

  it('right: a scan check reported inside the result manifest counts as present', () => {
    const manifestRow = row('result_manifest', manifest)
    const report = build([manifestRow])
    expect(report.scans[0]).toMatchObject({ status: 'present', evidenceId: manifestRow.id, rawReportHash: manifest.checks[4].rawReportHash })
  })
})

describe('buildDeliveryReport: deployment and release gate', () => {
  it('wrong: an unverified deployment blocks release but not publish', () => {
    const unverified = deployment(false)
    const report = build([greenTests(), scan('passed'), review('approved'), unverified], { decisions: [deployDecision(REVISION_A)] })
    expect(report.deployment).toMatchObject({ status: 'unverified', verificationStatus: 'unverified', evidenceId: unverified.id, url: 'https://preview.example.test/' })
    expect(report.gates.publishable.ok).toBe(true)
    expect(report.gates.releasable.ok).toBe(false)
    expect(blockingIds(report, 'releasable')).toEqual([`deployment:${unverified.id}:unverified`])
  })

  it('wrong: a deployment on another revision leaves this revision without a deployment', () => {
    const report = build([...proofEvidence(), deployment(true, REVISION_B)], { decisions: [deployDecision(REVISION_A)] })
    expect(report.deployment.status).toBe('missing')
    expect(blockingIds(report, 'releasable')).toContain('deployment:deployment:missing')
  })

  it('wrong: a later verification that observed another build is not verified', () => {
    const wrongBuild = { ...deployment(true), payload: { ...(deployment(true).payload as object), verification: { status: 'verified', checkedAt: '2026-09-19T10:06:00.000Z', method: 'http', observedBuildId: 'build-0' } } }
    const report = build([greenTests(), scan('passed'), review('approved'), wrongBuild], { decisions: [deployDecision(REVISION_A)] })
    expect(report.deployment).toMatchObject({ status: 'unverified', verificationStatus: 'failed' })
    expect(report.gates.releasable.ok).toBe(false)
  })

  it('right: a verified deployment on the revision with an applicable deploy decision is releasable', () => {
    const report = build(releasableEvidence(), { decisions: [deployDecision(REVISION_A)] })
    expect(report.deployment.status).toBe('verified')
    expect(report.gates.publishable).toEqual({ ok: true, blocking: [] })
    expect(report.gates.releasable).toEqual({ ok: true, blocking: [] })
    expect(report.rows.every((item) => item.deploymentEvidenceId === report.deployment.evidenceId)).toBe(true)
  })

  it('right: the newest deployment row wins, so a re-sent verified row replaces the unverified one', () => {
    const report = build([...proofEvidence(), deployment(false), deployment(true)], { decisions: [deployDecision(REVISION_A)] })
    expect(report.deployment.status).toBe('verified')
    expect(report.gates.releasable.ok).toBe(true)
  })
})

describe('buildDeliveryReport: decision applicability', () => {
  it('wrong: an approved deploy decision for revision A does not apply to revision B, and B is not releasable', () => {
    const decision = deployDecision(REVISION_A)
    const report = build(releasableEvidence(REVISION_B), { revision: REVISION_B, decisions: [decision] })
    expect(report.decisions).toEqual([expect.objectContaining({ id: decision.id, kind: 'deploy', verdict: 'approved', appliesToRevision: false })])
    expect(report.gates.publishable.ok).toBe(true)
    expect(blockingIds(report, 'releasable')).toEqual(['deploy_decision:deploy:missing'])
  })

  it('right: the same decision applies to revision A and A is releasable', () => {
    const decision = deployDecision(REVISION_A)
    const report = build(releasableEvidence(), { decisions: [decision] })
    expect(report.decisions[0]).toMatchObject({ id: decision.id, appliesToRevision: true, decidedAt: expect.stringMatching(/^2026-09-19T11:/) })
    expect(report.gates.releasable.ok).toBe(true)
  })

  it('wrong: a deploy decision for another baseline hash does not apply', () => {
    const report = build(releasableEvidence(), { decisions: [deployDecision(REVISION_A, { subjectHash: 'f'.repeat(64) })] })
    expect(report.decisions[0].appliesToRevision).toBe(false)
    expect(report.gates.releasable.ok).toBe(false)
  })

  it('wrong: a later rejected deploy decision voids the earlier approval', () => {
    const approved = deployDecision(REVISION_A)
    const rejected = deployDecision(REVISION_A, { verdict: 'rejected', reason: 'not this one' })
    const report = build(releasableEvidence(), { decisions: [approved, rejected] })
    expect(blockingIds(report, 'releasable')).toEqual([`deploy_decision:${rejected.id}:rejected`])
  })

  it('wrong: a deploy decision with no revision, on a deployment row of another revision, or from another project never applies', () => {
    const evidence = releasableEvidence()
    const noRevision = deployDecision(REVISION_A, { sourceRevision: null })
    const otherDeployment = deployDecision(REVISION_A, { subjectType: 'deployment_evidence', subjectId: uuid(600), subjectHash: 'a'.repeat(64) })
    const foreignProject = deployDecision(REVISION_A, { projectId: uuid(601) })
    const report = build(evidence, { decisions: [noRevision, otherDeployment, foreignProject] })
    expect(report.decisions.map((decision) => [decision.id, decision.appliesToRevision])).toEqual([
      [noRevision.id, false],
      [otherDeployment.id, false],
    ])
    expect(blockingIds(report, 'releasable')).toEqual(['deploy_decision:deploy:missing'])
  })

  it('right: a deploy decision whose subject is the verified deployment row on the revision applies', () => {
    const evidence = releasableEvidence()
    const onDeployment = deployDecision(REVISION_A, { subjectType: 'deployment_evidence', subjectId: evidence[3].id, subjectHash: 'a'.repeat(64) })
    const report = build(evidence, { decisions: [onDeployment] })
    expect(report.decisions[0].appliesToRevision).toBe(true)
    expect(report.gates.releasable.ok).toBe(true)
  })

  it('applies baseline decisions by hash and release decisions by the deployment row on the revision', () => {
    const evidence = releasableEvidence()
    const deploymentRow = evidence[3]
    const requirements: DeliveryReportDecision = { ...deployDecision(REVISION_A), kind: 'requirements', sourceRevision: null }
    const release: DeliveryReportDecision = { ...deployDecision(REVISION_A), kind: 'release', subjectType: 'deployment_evidence', subjectId: deploymentRow.id, subjectHash: 'a'.repeat(64) }
    const staleRelease: DeliveryReportDecision = { ...release, id: uuid(500), subjectId: uuid(501) }
    const report = build(evidence, { decisions: [requirements, release, staleRelease] })
    expect(report.decisions.map((decision) => [decision.kind, decision.appliesToRevision])).toEqual([
      ['requirements', true],
      ['release', true],
      ['release', false],
    ])
  })
})

describe('buildDeliveryReport: default revision, rows, usage and limits', () => {
  it('wrong: without any result the revision is unknown and both gates are blocked by the revision', () => {
    const report = build([greenTests(), scan('passed')], { revision: null })
    expect(report.revision).toBeNull()
    expect(report.revisionSource).toBe('none')
    expect(acStatuses(report)).toEqual({ 'AC-001': 'missing', 'AC-002': 'missing', 'AC-003': 'manual_pending' })
    expect(blockingIds(report, 'publishable')).toEqual(['revision:revision:missing', 'ac:AC-001:missing', 'ac:AC-002:missing', 'scan:dependency-audit:missing'])
  })

  it('right: the default revision is the newest result manifest of the baseline', () => {
    const older = row('result_manifest', { ...manifest, resultRevision: REVISION_B }, { sourceRevision: REVISION_B, createdAt: new Date(Date.UTC(2026, 8, 19, 9, 0, 0)) })
    const newest = row('result_manifest', manifest)
    const foreign = row('result_manifest', manifest, { baselineId: OTHER_BASELINE_ID, sourceRevision: REVISION_B, createdAt: new Date(Date.UTC(2026, 8, 19, 12, 0, 0)) })
    expect(selectDefaultRevision([older, newest, foreign], BASELINE_ID)).toEqual(REVISION_A)
    const report = build([older, newest, foreign, scan('passed')], { revision: null })
    expect(report.revision).toEqual(REVISION_A)
    expect(report.revisionSource).toBe('latest_result')
    expect(acStatuses(report)).toMatchObject({ 'AC-001': 'passed', 'AC-002': 'passed' })
  })

  it('keeps usage per manifest and never turns unknown into a number', () => {
    const manifestRow = row('result_manifest', manifest)
    const measured = row('result_manifest', { ...manifest, usage: { source: 'provider', values: { totalTokens: 1200 } } })
    const report = build([manifestRow, measured])
    expect(report.usage).toEqual([
      { evidenceId: manifestRow.id, source: 'runner', values: 'unknown' },
      { evidenceId: measured.id, source: 'provider', values: { totalTokens: 1200 } },
    ])
  })

  it('links every row to its evidence and raw report hash along requirement → AC → task → test → deployment', () => {
    const evidence = releasableEvidence()
    const report = build(evidence, { decisions: [deployDecision(REVISION_A)] })
    expect(report.rows.map((item) => [item.requirementId, item.acId, item.taskId, item.testId ?? item.manualCheckId, item.evidenceId, item.rawReportHash])).toEqual([
      ['REQ-1', 'AC-001', TASK_ID, TEST_AC_001, evidence[0].id, HASH],
      ['REQ-1', 'AC-003', TASK_ID, MANUAL_CHECK_ID, evidence[2].id, null],
      ['REQ-2', 'AC-002', TASK_ID, TEST_AC_002, evidence[0].id, HASH],
    ])
    expect(report.rows[0]).toMatchObject({ acStatus: 'passed', taskStatus: 'verified', testStatus: 'passed', deploymentEvidenceId: evidence[3].id })
    expect(report).toMatchObject({ totalRows: 3, truncated: false, limit: 100, issues: [] })
  })

  it('reports an unknown AC referenced by a task instead of dropping it', () => {
    const rogueTask = { id: uuid(700), projectId: PROJECT_ID, baselineId: BASELINE_ID, title: 'Rogue', status: 'draft' as const, acIds: ['AC-9'] }
    const report = build([greenTests()], { tasks: [rogueTask] })
    expect(report.issues).toEqual([{ code: 'unknown_ac', taskId: rogueTask.id, acId: 'AC-9' }])
    expect(report.rows.find((item) => item.acId === 'AC-9')).toMatchObject({ requirementId: null, acStatus: null, taskId: rogueTask.id })
  })

  it('wrong: a deployment whose upload failed is unverified even with a verification record', () => {
    const failedUpload = { ...deployment(true), payload: { ...(deployment(true).payload as object), uploadStatus: 'failed' } }
    const report = build([...proofEvidence(), failedUpload], { decisions: [deployDecision(REVISION_A)] })
    expect(report.deployment).toMatchObject({ status: 'unverified', verificationStatus: 'failed' })
  })

  it('keeps failed sticky when a newer manifest on the same revision reports failed for a test an older one passed', () => {
    const older = row('result_manifest', manifest)
    const failedCheck = { ...manifest.checks[0], status: 'failed' as const }
    const newer = row('result_manifest', { ...manifest, checks: [failedCheck, ...manifest.checks.slice(1)] })
    expect(acStatuses(build([older, newer]))['AC-001']).toBe('failed')
    expect(acStatuses(build([newer, older]))['AC-001']).toBe('failed')
  })

  it('truncates rows at the limit while counting every row', () => {
    const report = build(releasableEvidence(), { limit: 2 })
    expect(report.rows).toHaveLength(2)
    expect(report).toMatchObject({ totalRows: 3, truncated: true, limit: 2 })
    expect(build(releasableEvidence(), { limit: 0 }).limit).toBe(1)
  })
})

describe('DeliveryReport v1 contract', () => {
  it('every report built here parses with the published schema', () => {
    const reports = [
      build(releasableEvidence(), { decisions: [deployDecision(REVISION_A)] }),
      build([greenTests(REVISION_B)], { revision: null }),
      build([row('result_manifest', manifest), scan('failed'), deployment(false)]),
    ]
    for (const report of reports) {
      const parsed = deliveryReportV1Schema.safeParse(report)
      expect(parsed.success).toBe(true)
    }
  })

  it('the fixture parses and describes a publishable, not yet releasable revision', () => {
    const fixture = loadDeliveryReportFixture()
    expect(fixture.schemaVersion).toBe(DELIVERY_SCHEMA_VERSIONS.report)
    expect(fixture.gates.publishable.ok).toBe(true)
    expect(fixture.gates.releasable.ok).toBe(false)
    expect(fixture.gates.releasable.blocking.map((blocker) => blocker.kind)).toEqual(['ac', 'deploy_decision', 'deployment'])
    expect(fixture.decisions.map((decision) => [decision.kind, decision.appliesToRevision])).toEqual([
      ['requirements', true],
      ['deploy', false],
    ])
    expect(fixture.usage[0].values).toBe('unknown')
    expect(fixture.progress).toEqual({ proven: 2, total: 3, unit: 'ac', percent: 66 })
  })

  it('wrong: an unknown report schema version is rejected', () => {
    const parsed = parseVersioned(deliveryDocumentSchemas, { ...loadDeliveryReportFixture(), schemaVersion: 'delivery.report/v2' })
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.body.code).toBe('unsupported_schema_version')
  })

  it('right: the fixture dispatches to the report schema through parseVersioned', () => {
    const parsed = parseVersioned(deliveryDocumentSchemas, loadDeliveryReportFixture())
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.schemaVersion).toBe(DELIVERY_SCHEMA_VERSIONS.report)
  })

  it('wrong: an AC status outside the five states is rejected', () => {
    const fixture = loadDeliveryReportFixture()
    const broken = { ...fixture, acceptanceCriteria: [{ ...fixture.acceptanceCriteria[0], status: 'green' }] }
    expect(deliveryReportV1Schema.safeParse(broken).success).toBe(false)
  })
})
