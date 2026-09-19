import { flowStatusV1Schema, deliveryReportFlowSectionSchema, type ExecutionAttempt, type FlowStageId } from '../contracts'
import type { StageArtifactRecord, StageDecisionRecord } from '../flowRules'
import { hashFlowTemplate } from '../flowRules'
import { attemptBlockers, buildDeliveryReportFlowSection, buildFlowStatus, countBlockingThreadsByStage, type FlowStatusInput } from '../flowStatus'
import { computeStageCurrency } from '../flowRules'
import { loadFlowStatusFixture, loadFlowTemplateFixture } from '../fixtures/flow/index'

const template = loadFlowTemplateFixture()
const fixture = loadFlowStatusFixture()
const hash = (char: string) => char.repeat(64)
const AT = '2026-09-19T10:00:00.000Z'

const record = (id: string, stageId: FlowStageId, version: number, contentHash: string, dependsOn: StageArtifactRecord['dependsOn'] = []): StageArtifactRecord => ({ id, stageId, version, contentHash, dependsOn })
const bind = (target: StageArtifactRecord) => ({ stageId: target.stageId, artifactId: target.id, version: target.version, contentHash: target.contentHash })
const decide = (id: string, target: StageArtifactRecord, verdict: 'approved' | 'rejected', clientApproved = false, decidedAt = AT): StageDecisionRecord => ({
  id,
  stageId: target.stageId,
  artifactId: target.id,
  subjectHash: target.contentHash,
  verdict,
  decidedAt,
  clientApproved,
})

const scopeV1 = record('aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'scope', 1, hash('2'))
const uxV1 = record('aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'ux', 1, hash('3'), [bind(scopeV1)])
const kvV1 = record('aaaaaaa3-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'key_visual', 1, hash('4'), [bind(uxV1)])
const dsV1 = record('aaaaaaa4-aaaa-4aaa-8aaa-aaaaaaaaaaa4', 'design_system_ui', 1, hash('8'), [bind(kvV1)])
const scopeV2 = record('aaaaaaa5-aaaa-4aaa-8aaa-aaaaaaaaaaa5', 'scope', 2, hash('5'))

const scopeApproved = decide('ddddddd1-dddd-4ddd-8ddd-ddddddddddd1', scopeV1, 'approved')
const uxApproved = decide('ddddddd2-dddd-4ddd-8ddd-ddddddddddd2', uxV1, 'approved')
const kvApproved = decide('ddddddd3-dddd-4ddd-8ddd-ddddddddddd3', kvV1, 'approved', true, '2026-09-19T10:05:00.000Z')
const dsApproved = decide('ddddddd4-dddd-4ddd-8ddd-ddddddddddd4', dsV1, 'approved', true, '2026-09-19T10:10:00.000Z')

const attempt = (attemptId: string, state: ExecutionAttempt['state']): ExecutionAttempt => ({
  attemptId,
  idempotencyKey: `key-${attemptId}`,
  payloadHash: hash('e'),
  mode: 'manual_handoff',
  state,
  baselineId: 'bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
  baselineHash: hash('1'),
  baseRevision: { kind: 'snapshot', contentHash: hash('9'), externalWorkspaceId: 'ws-demo' },
  baseCommit: null,
  reservedAt: AT,
  claimedAt: null,
  workerRef: null,
  externalRunId: null,
  workflowRef: null,
  workflowStepId: null,
  dispatchedAt: null,
  cancellationRequestedAt: null,
  stopConfirmation: null,
  reconciliation: null,
  resultEvidenceId: null,
  completionDelivery: null,
  lastDeliveryError: null,
  closedAt: null,
  outcome: null,
})

function fixtureInput(overrides: Partial<FlowStatusInput> = {}): FlowStatusInput {
  return {
    project: {
      projectId: fixture.projectId,
      template,
      templateRef: { templateId: 'delivery-default', version: 1, hash: hash('7') },
      workflowInstanceId: fixture.workflowInstanceId,
      updatedAt: '2026-09-19T09:00:00.000Z',
    },
    intakeStep: 'submitted',
    artifacts: [scopeV1, uxV1, kvV1],
    decisions: [scopeApproved, uxApproved],
    openThreadsByStage: {},
    attempts: [],
    ...overrides,
  }
}

describe('buildFlowStatus — fixture project mid-flow', () => {
  const status = buildFlowStatus(fixtureInput())

  it('parses with flowStatusV1Schema and equals flow-status.v1.json', () => {
    expect(flowStatusV1Schema.safeParse(status).success).toBe(true)
    expect(status).toEqual(fixture)
  })

  it('reproduces stage currency, gates, pending approvals and next action', () => {
    expect(status.stages.map((stage) => [stage.stageId, stage.currency])).toEqual(fixture.stages.map((stage) => [stage.stageId, stage.currency]))
    expect(status.gates).toEqual(fixture.gates)
    expect(status.pendingApprovals).toEqual(fixture.pendingApprovals)
    expect(status.nextAction).toEqual({ kind: 'approve_stage', stageId: 'key_visual' })
    expect(status.currentStageId).toBe('key_visual')
    expect(status.updatedAt).toBe(AT)
  })

  it('carries no approver PII', () => {
    const text = JSON.stringify(status)
    expect(text).not.toMatch(/approverName|Kowalska|clientApproval"/)
  })
})

describe('buildFlowStatus — legacy project', () => {
  it('yields template null, open gates and one informational blocker', () => {
    const status = buildFlowStatus(fixtureInput({ project: { ...fixtureInput().project, template: null, templateRef: null, workflowInstanceId: null }, intakeStep: null, artifacts: [], decisions: [] }))
    expect(flowStatusV1Schema.safeParse(status).success).toBe(true)
    expect(status.template).toBeNull()
    expect(status.stages).toEqual([])
    expect(status.pendingApprovals).toEqual([])
    expect(status.blockers).toEqual([{ kind: 'template_not_pinned', stageId: null, ref: null }])
    expect(status.gates).toEqual({ dispatchable: { ok: true, blocking: [] }, publishable: { ok: true, blocking: [] } })
    expect(status.nextAction).toEqual({ kind: 'none', stageId: null })
    expect(status.currentStageId).toBeNull()
  })

  it('suggests pinning when a new project already has an intake', () => {
    const status = buildFlowStatus(fixtureInput({ project: { ...fixtureInput().project, template: null, templateRef: null }, intakeStep: 'brief', artifacts: [], decisions: [] }))
    expect(status.nextAction).toEqual({ kind: 'pin_template', stageId: null })
    expect(status.gates.dispatchable.ok).toBe(true)
  })

  it('still reports an active attempt on a legacy project without closing the gates', () => {
    const status = buildFlowStatus(fixtureInput({ project: { ...fixtureInput().project, template: null, templateRef: null }, intakeStep: null, attempts: [attempt('eeeeeee1-eeee-4eee-8eee-eeeeeeeeeee1', 'claimed')] }))
    expect(status.blockers.map((blocker) => blocker.kind)).toEqual(['template_not_pinned', 'attempt_active'])
    expect(status.gates.dispatchable.ok).toBe(true)
  })
})

describe('buildFlowStatus — progression and blockers', () => {
  it('opens both gates and points at dispatch once all four stages are approved and current', () => {
    const status = buildFlowStatus(fixtureInput({ artifacts: [scopeV1, uxV1, kvV1, dsV1], decisions: [scopeApproved, uxApproved, kvApproved, dsApproved] }))
    expect(status.gates.dispatchable).toEqual({ ok: true, blocking: [] })
    expect(status.gates.publishable).toEqual({ ok: true, blocking: [] })
    expect(status.blockers).toEqual([])
    expect(status.pendingApprovals).toEqual([])
    expect(status.currentStageId).toBe('implementation')
    expect(status.nextAction).toEqual({ kind: 'dispatch', stageId: 'implementation' })
    expect(status.updatedAt).toBe('2026-09-19T10:10:00.000Z')
  })

  it('an active or unknown attempt blocks dispatch but not publication consent', () => {
    const attempts = [attempt('eeeeeee1-eeee-4eee-8eee-eeeeeeeeeee1', 'reserved'), attempt('eeeeeee2-eeee-4eee-8eee-eeeeeeeeeee2', 'reconciliation_required'), attempt('eeeeeee3-eeee-4eee-8eee-eeeeeeeeeee3', 'closed')]
    expect(attemptBlockers(attempts).map((blocker) => blocker.ref)).toEqual(['eeeeeee1-eeee-4eee-8eee-eeeeeeeeeee1', 'eeeeeee2-eeee-4eee-8eee-eeeeeeeeeee2'])
    const status = buildFlowStatus(fixtureInput({ artifacts: [scopeV1, uxV1, kvV1, dsV1], decisions: [scopeApproved, uxApproved, kvApproved, dsApproved], attempts }))
    expect(status.gates.dispatchable.ok).toBe(false)
    expect(status.gates.dispatchable.blocking.map((blocker) => blocker.kind)).toEqual(['attempt_active', 'attempt_active'])
    expect(status.gates.publishable.ok).toBe(true)
    expect(status.nextAction).toEqual({ kind: 'none', stageId: null })
    expect(flowStatusV1Schema.safeParse(status).success).toBe(true)
  })

  it('a new Scope version makes every dependant stale and asks for a new artifact (FLOW-09)', () => {
    const decisions = [scopeApproved, uxApproved, kvApproved, dsApproved, decide('ddddddd5-dddd-4ddd-8ddd-ddddddddddd5', scopeV2, 'approved', false, '2026-09-19T10:20:00.000Z')]
    const status = buildFlowStatus(fixtureInput({ artifacts: [scopeV1, uxV1, kvV1, dsV1, scopeV2], decisions }))
    expect(status.stages.filter((stage) => stage.currency !== null).map((stage) => [stage.stageId, stage.currency])).toEqual([
      ['scope', 'approved'],
      ['ux', 'stale'],
      ['key_visual', 'stale'],
      ['design_system_ui', 'stale'],
    ])
    expect(status.gates.dispatchable.ok).toBe(false)
    expect(status.gates.dispatchable.blocking.map((blocker) => blocker.kind)).toEqual(['upstream_stale', 'upstream_not_approved', 'upstream_not_approved'])
    expect(status.nextAction).toEqual({ kind: 'create_artifact', stageId: 'ux' })
    expect(status.pendingApprovals).toEqual([])
    expect(status.updatedAt).toBe('2026-09-19T10:20:00.000Z')
  })

  it('a rejection asks for a fix, open comments ask for triage', () => {
    const rejected = buildFlowStatus(fixtureInput({ decisions: [scopeApproved, uxApproved, decide('ddddddd6-dddd-4ddd-8ddd-ddddddddddd6', kvV1, 'rejected', false, '2026-09-19T10:30:00.000Z')] }))
    expect(rejected.nextAction).toEqual({ kind: 'fix_rejection', stageId: 'key_visual' })
    expect(rejected.stages.find((stage) => stage.stageId === 'key_visual')?.currency).toBe('rejected')
    expect(rejected.pendingApprovals).toEqual([])

    const commented = buildFlowStatus(fixtureInput({ openThreadsByStage: { key_visual: 2 } }))
    expect(commented.nextAction).toEqual({ kind: 'resolve_comments', stageId: 'key_visual' })
    expect(commented.stages.find((stage) => stage.stageId === 'key_visual')?.openThreads).toBe(2)
    expect(commented.blockers.map((blocker) => blocker.kind)).toEqual(['decision_pending', 'open_comments', 'artifact_missing'])
    expect(flowStatusV1Schema.safeParse(commented).success).toBe(true)
  })

  it('a thread reopened after approval is a top-level blocker but never closes the gates', () => {
    const status = buildFlowStatus(fixtureInput({ artifacts: [scopeV1, uxV1, kvV1, dsV1], decisions: [scopeApproved, uxApproved, kvApproved, dsApproved], openThreadsByStage: { key_visual: 1 } }))
    expect(status.blockers).toEqual([{ kind: 'open_comments', stageId: 'key_visual', ref: '1' }])
    expect(status.gates.dispatchable).toEqual({ ok: true, blocking: [] })
    expect(status.gates.publishable).toEqual({ ok: true, blocking: [] })
    expect(status.nextAction).toEqual({ kind: 'dispatch', stageId: 'implementation' })
  })

  it('counts blocking threads per stage with the F8 predicate, honouring hash-bound deferrals', () => {
    const states = computeStageCurrency(template, [scopeV1, uxV1, kvV1], [scopeApproved, uxApproved])
    const counts = countBlockingThreadsByStage(
      [
        { threadKey: 'a', stageId: 'key_visual', artifactId: kvV1.id, sourceStatus: 'open', triageStatus: 'new', deferral: null },
        { threadKey: 'b', stageId: 'key_visual', artifactId: null, sourceStatus: 'open', triageStatus: 'triaged', deferral: null },
        { threadKey: 'c', stageId: 'key_visual', artifactId: kvV1.id, sourceStatus: 'open', triageStatus: 'deferred', deferral: { artifactId: kvV1.id, contentHash: kvV1.contentHash } },
        { threadKey: 'd', stageId: 'ux', artifactId: 'aaaaaaa9-aaaa-4aaa-8aaa-aaaaaaaaaaa9', sourceStatus: 'open', triageStatus: 'new', deferral: null },
        { threadKey: 'e', stageId: 'design_system_ui', artifactId: null, sourceStatus: 'open', triageStatus: 'new', deferral: null },
        { threadKey: 'f', stageId: 'key_visual', artifactId: kvV1.id, sourceStatus: 'open', triageStatus: 'deferred', deferral: { artifactId: 'aaaaaaa0-aaaa-4aaa-8aaa-aaaaaaaaaaa0', contentHash: hash('0') } },
      ],
      states,
    )
    expect(counts).toEqual({ key_visual: 3 })
  })

  it('an unfinished intake is reported first', () => {
    const status = buildFlowStatus(fixtureInput({ intakeStep: 'platform' }))
    expect(status.blockers[0]).toEqual({ kind: 'intake_incomplete', stageId: null, ref: 'platform' })
    expect(status.nextAction).toEqual({ kind: 'complete_intake', stageId: null })
    expect(status.currentStageId).toBeNull()
    expect(status.gates.dispatchable.ok).toBe(false)
  })

  it('a pending client approval without clientApproved stays pending', () => {
    const status = buildFlowStatus(fixtureInput({ decisions: [scopeApproved, uxApproved, decide('ddddddd7-dddd-4ddd-8ddd-ddddddddddd7', kvV1, 'approved', false)] }))
    expect(status.stages.find((stage) => stage.stageId === 'key_visual')?.currency).toBe('pending')
    expect(status.pendingApprovals.map((approval) => approval.stageId)).toEqual(['key_visual'])
  })

  it('never mutates its input rows', () => {
    const input = fixtureInput()
    const snapshot = JSON.stringify(input)
    buildFlowStatus(input)
    expect(JSON.stringify(input)).toBe(snapshot)
  })

  it('uses the template hash helper consistently with the pin', () => {
    expect(hashFlowTemplate(template)).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe('buildDeliveryReportFlowSection', () => {
  it('is null for legacy projects', () => {
    expect(buildDeliveryReportFlowSection({ project: { ...fixtureInput().project, template: null, templateRef: null }, artifacts: [], decisions: [] })).toBeNull()
  })

  it('lists the four approval stages with their approvals and the publishable gate', () => {
    const section = buildDeliveryReportFlowSection(fixtureInput())
    expect(section).not.toBeNull()
    if (!section) return
    expect(deliveryReportFlowSectionSchema.safeParse(section).success).toBe(true)
    expect(section.template).toEqual({ templateId: 'delivery-default', version: 1, hash: hash('7') })
    expect(section.stages.map((stage) => [stage.stageId, stage.currency, stage.decisionId, stage.clientApproved])).toEqual([
      ['scope', 'approved', scopeApproved.id, false],
      ['ux', 'approved', uxApproved.id, false],
      ['key_visual', 'pending', null, false],
      ['design_system_ui', 'missing', null, false],
    ])
    expect(section.gate).toEqual(fixture.gates.publishable)
    expect(JSON.stringify(section)).not.toMatch(/approverName/)
  })

  it('reports an open gate once every stage is approved', () => {
    const section = buildDeliveryReportFlowSection(fixtureInput({ artifacts: [scopeV1, uxV1, kvV1, dsV1], decisions: [scopeApproved, uxApproved, kvApproved, dsApproved] }))
    expect(section?.gate).toEqual({ ok: true, blocking: [] })
    expect(section?.stages.every((stage) => stage.currency === 'approved')).toBe(true)
    expect(section?.stages.map((stage) => stage.clientApproved)).toEqual([false, false, true, true])
  })
})
