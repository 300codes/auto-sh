import type { FlowStageId, StageDecisionRequest } from '../contracts'
import type { StageArtifactRecord } from '../flowRules'
import {
  DEFERRED_BY_STAGE_DECISION,
  blockingThreadsFor,
  checkStageApprover,
  hashStageDecisionRequest,
  planStageDecision,
  type CommentThreadRecord,
  type StoredStageDecisionRecord,
} from '../stageDecisions'
import { loadFlowTemplateFixture, loadStageDecisionRequestFixture } from '../fixtures/flow/index'

const template = loadFlowTemplateFixture()
const hash = (char: string) => char.repeat(64)
const NOW = '2026-09-19T11:00:00.000Z'
const APPROVER = ['delivery_os.projects.view', 'delivery_os.stages.approve']

const record = (id: string, stageId: FlowStageId, version: number, contentHash: string, dependsOn: StageArtifactRecord['dependsOn'] = []): StageArtifactRecord => ({
  id,
  stageId,
  version,
  contentHash,
  dependsOn,
})
const bind = (target: StageArtifactRecord) => ({ stageId: target.stageId, artifactId: target.id, version: target.version, contentHash: target.contentHash })

const scopeV1 = record('aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'scope', 1, hash('2'))
const uxV1 = record('aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'ux', 1, hash('3'), [bind(scopeV1)])
const kvV1 = record('aaaaaaa3-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'key_visual', 1, hash('4'), [bind(uxV1)])
const scopeV2 = record('aaaaaaa5-aaaa-4aaa-8aaa-aaaaaaaaaaa5', 'scope', 2, hash('5'))
const uxV2 = record('aaaaaaa6-aaaa-4aaa-8aaa-aaaaaaaaaaa6', 'ux', 2, hash('6'), [bind(scopeV2)])
const fixtureArtifacts = [scopeV1, uxV1, kvV1]

let decisionCounter = 0
function stored(target: StageArtifactRecord, verdict: 'approved' | 'rejected', key: string, requestHash: string, decidedAt = '2026-09-19T10:00:00.000Z', clientApproved = false): StoredStageDecisionRecord {
  decisionCounter += 1
  return { id: `ddddddd${decisionCounter}-dddd-4ddd-8ddd-ddddddddddd${decisionCounter}`, stageId: target.stageId, artifactId: target.id, subjectHash: target.contentHash, verdict, decidedAt, clientApproved, idempotencyKey: key, requestHash }
}
const approvedScope = stored(scopeV1, 'approved', 'k-scope', hash('a'))
const approvedUx = stored(uxV1, 'approved', 'k-ux', hash('b'))
const fixtureDecisions = [approvedScope, approvedUx]

function requestFor(target: StageArtifactRecord, overrides: Partial<StageDecisionRequest> = {}): StageDecisionRequest {
  const base = loadStageDecisionRequestFixture()
  return { ...base, artifactId: target.id, subjectHash: target.contentHash, subjectVersion: target.version, ...overrides }
}

function plan(request: StageDecisionRequest, overrides: Partial<Parameters<typeof planStageDecision>[0]> = {}) {
  return planStageDecision({
    request,
    idempotencyKey: 'key-1',
    stageId: 'key_visual',
    template,
    grantedFeatures: APPROVER,
    artifacts: fixtureArtifacts,
    projectDecisions: fixtureDecisions,
    threads: [],
    now: NOW,
    ...overrides,
  })
}

function expectFailure(result: ReturnType<typeof planStageDecision>, code: string, status: number): string[] {
  expect(result.ok).toBe(false)
  if (result.ok) return []
  expect(result.body.code).toBe(code)
  expect(result.status).toBe(status)
  return result.body.details.map((detail) => detail.code)
}

function expectNewRow(result: ReturnType<typeof planStageDecision>) {
  expect(result.ok).toBe(true)
  if (!result.ok || result.duplicate) throw new Error('expected a new decision row')
  return result
}

describe('request hash and approver evaluation', () => {
  it('normalises optional fields and ignores the idempotency key', () => {
    const fixture = loadStageDecisionRequestFixture()
    const base = hashStageDecisionRequest(fixture)
    expect(hashStageDecisionRequest(JSON.parse(JSON.stringify(fixture)))).toBe(base)
    const { reason: _reason, deferredThreadKeys: _deferred, ...withoutOptional } = fixture
    expect(hashStageDecisionRequest(withoutOptional)).toBe(base)
    expect(hashStageDecisionRequest({ ...fixture, verdict: 'rejected', reason: 'no' })).not.toBe(base)
  })

  it('honours wildcard grants and refuses manage-only callers', () => {
    const stage = template.stages.find((candidate) => candidate.kind === 'key_visual')
    if (!stage) throw new Error('fixture template has no key_visual stage')
    expect(checkStageApprover(['*'], stage).ok).toBe(true)
    expect(checkStageApprover(['delivery_os.*'], stage).ok).toBe(true)
    expect(checkStageApprover(['delivery_os.stages.approve'], stage).ok).toBe(true)
    const refused = checkStageApprover(['delivery_os.projects.manage', 'delivery_os.projects.view'], stage)
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.status).toBe(403)
    expect(checkStageApprover([], { stageId: 'implementation', approverFeatures: [] }).ok).toBe(true)
  })
})

describe('planStageDecision — happy path (fixture: client approval of Key Visual)', () => {
  it('records the fixture approval with client consent and returns approved currency without approver PII', () => {
    const result = expectNewRow(plan(requestFor(kvV1)))
    expect(result.record).toEqual({
      stageId: 'key_visual',
      artifactId: kvV1.id,
      subjectHash: kvV1.contentHash,
      subjectVersion: 1,
      verdict: 'approved',
      reason: null,
      clientApproved: true,
      deferredThreadKeys: [],
    })
    expect(result.currency).toBe('approved')
    expect(result.deferrals).toEqual([])
    expect(JSON.stringify(result)).not.toContain('Anna Kowalska')
    expect(JSON.stringify(result)).not.toContain('Psi Fryzjer')
  })

  it('records a rejection with a reason and returns rejected currency', () => {
    const result = expectNewRow(plan(requestFor(kvV1, { verdict: 'rejected', reason: 'Logo too small', clientApproval: null })))
    expect(result.record.verdict).toBe('rejected')
    expect(result.record.clientApproved).toBe(false)
    expect(result.currency).toBe('rejected')
  })

  it('approve → reject → approve with three keys are three distinct rows and the latest wins', () => {
    const first = expectNewRow(plan(requestFor(kvV1), { idempotencyKey: 'k1' }))
    const firstRow = { ...stored(kvV1, 'approved', 'k1', first.requestHash, '2026-09-19T11:00:00.000Z', true) }
    const second = expectNewRow(plan(requestFor(kvV1, { verdict: 'rejected', reason: 'Colours off', clientApproval: null }), { idempotencyKey: 'k2', projectDecisions: [...fixtureDecisions, firstRow], now: '2026-09-19T11:05:00.000Z' }))
    expect(second.currency).toBe('rejected')
    const secondRow = stored(kvV1, 'rejected', 'k2', second.requestHash, '2026-09-19T11:05:00.000Z')
    const third = expectNewRow(plan(requestFor(kvV1), { idempotencyKey: 'k3', projectDecisions: [...fixtureDecisions, firstRow, secondRow], now: '2026-09-19T11:10:00.000Z' }))
    expect(third.currency).toBe('approved')
    expect(new Set([first.requestHash, second.requestHash, third.requestHash]).size).toBe(2)
  })
})

describe('planStageDecision — replay', () => {
  const request = requestFor(kvV1)
  const existing = stored(kvV1, 'approved', 'key-1', hashStageDecisionRequest(request), '2026-09-19T10:30:00.000Z', true)

  it('same key and same body is a duplicate returning the existing row', () => {
    const result = plan(request, { projectDecisions: [...fixtureDecisions, existing] })
    expect(result.ok).toBe(true)
    if (result.ok && result.duplicate) {
      expect(result.existing.id).toBe(existing.id)
      expect(result.currency).toBe('approved')
    } else {
      throw new Error('expected duplicate')
    }
  })

  it('same key with another body is an idempotency conflict', () => {
    expectFailure(plan(requestFor(kvV1, { verdict: 'rejected', reason: 'changed my mind' }), { projectDecisions: [...fixtureDecisions, existing] }), 'idempotency_conflict', 409)
  })

  it('same key reused on another stage is a conflict even with an identical body', () => {
    const otherStageRow = { ...existing, stageId: 'ux' as const, artifactId: uxV1.id, subjectHash: uxV1.contentHash }
    expectFailure(plan(request, { projectDecisions: [...fixtureDecisions, otherStageRow] }), 'idempotency_conflict', 409)
  })

  it('replay is refused for a caller who lost the approver features', () => {
    expectFailure(plan(request, { projectDecisions: [...fixtureDecisions, existing], grantedFeatures: ['delivery_os.projects.manage'] }), 'forbidden', 403)
  })

  it('replay wins over a stale artifact', () => {
    const staleArtifacts = [...fixtureArtifacts, record('aaaaaaa7-aaaa-4aaa-8aaa-aaaaaaaaaaa7', 'key_visual', 2, hash('7'), [bind(uxV1)])]
    const result = plan(request, { projectDecisions: [...fixtureDecisions, existing], artifacts: staleArtifacts })
    expect(result.ok && result.duplicate).toBe(true)
  })
})

describe('planStageDecision — subject binding', () => {
  it('refuses an artifact of another stage or project', () => {
    expect(expectFailure(plan(requestFor(uxV1)), 'foreign_reference', 422)).toEqual(['foreign_artifact'])
    expect(expectFailure(plan(requestFor(record('99999999-9999-4999-8999-999999999999', 'key_visual', 1, hash('9')))), 'foreign_reference', 422)).toEqual(['foreign_artifact'])
  })

  it('refuses a decision on a superseded version (409 stage_artifact_stale)', () => {
    const kvV2 = record('aaaaaaa7-aaaa-4aaa-8aaa-aaaaaaaaaaa7', 'key_visual', 2, hash('7'), [bind(uxV1)])
    expectFailure(plan(requestFor(kvV1), { artifacts: [...fixtureArtifacts, kvV2] }), 'stage_artifact_stale', 409)
  })

  it('refuses a wrong hash or version (409 subject_hash_mismatch)', () => {
    expect(expectFailure(plan(requestFor(kvV1, { subjectHash: hash('f') })), 'subject_hash_mismatch', 409)).toEqual(['subject_hash_mismatch'])
    expect(expectFailure(plan(requestFor(kvV1, { subjectVersion: 2 })), 'subject_hash_mismatch', 409)).toEqual(['subject_hash_mismatch'])
  })

  it('refuses a caller without the stage approver features before anything else', () => {
    expectFailure(plan(requestFor(kvV1), { grantedFeatures: ['delivery_os.projects.manage'] }), 'forbidden', 403)
  })

  it('reports the stage as unknown when the snapshot lacks it', () => {
    const withoutKv = { ...template, stages: template.stages.filter((stage) => stage.kind !== 'key_visual') }
    expectFailure(plan(requestFor(kvV1), { template: withoutKv }), 'stage_unknown', 422)
  })
})

describe('planStageDecision — verdict checks', () => {
  it('a rejection needs a reason', () => {
    expectFailure(plan(requestFor(kvV1, { verdict: 'rejected', reason: null })), 'reason_required', 422)
  })

  it('a rejection ignores upstream currency and open threads', () => {
    const threads: CommentThreadRecord[] = [{ threadKey: 't-1', stageId: 'key_visual', artifactId: kvV1.id, sourceStatus: 'open', triageStatus: 'new', deferral: null }]
    const result = plan(requestFor(kvV1, { verdict: 'rejected', reason: 'Not yet', clientApproval: null }), { projectDecisions: [approvedScope], threads })
    expect(result.ok).toBe(true)
  })

  it('approving with an unapproved upstream fails stage_not_approved', () => {
    expect(expectFailure(plan(requestFor(kvV1), { projectDecisions: [approvedScope] }), 'stage_not_approved', 422)).toEqual(['stage_not_approved'])
  })

  it('approving UX after a new Scope version fails stage_dependency_stale (stale downstream)', () => {
    const artifacts = [scopeV1, scopeV2, uxV1]
    const decisions = [approvedScope, stored(scopeV2, 'approved', 'k-scope-2', hash('c'))]
    const codes = expectFailure(plan(requestFor(uxV1), { stageId: 'ux', artifacts, projectDecisions: decisions }), 'stage_dependency_stale', 422)
    expect(codes).toEqual(['stage_dependency_stale'])
  })

  it('approving Key Visual whose UX is stale after a Scope change fails stage_dependency_stale', () => {
    const artifacts = [scopeV1, scopeV2, uxV1, kvV1]
    const decisions = [approvedScope, approvedUx, stored(scopeV2, 'approved', 'k-scope-2', hash('c'))]
    expectFailure(plan(requestFor(kvV1), { artifacts, projectDecisions: decisions }), 'stage_dependency_stale', 422)
  })

  it('approving a UX bound to the new Scope succeeds', () => {
    const artifacts = [scopeV1, scopeV2, uxV1, uxV2]
    const decisions = [approvedScope, stored(scopeV2, 'approved', 'k-scope-2', hash('c'))]
    const result = expectNewRow(plan(requestFor(uxV2, { clientApproval: null }), { stageId: 'ux', artifacts, projectDecisions: decisions }))
    expect(result.currency).toBe('approved')
    expect(result.record.clientApproved).toBe(false)
  })

  it('a client-required stage refuses an approval without client approval', () => {
    expectFailure(plan(requestFor(kvV1, { clientApproval: null })), 'client_approval_required', 422)
    const { clientApproval: _omitted, ...withoutClient } = requestFor(kvV1)
    expectFailure(plan(withoutClient), 'client_approval_required', 422)
  })

  it('a stage without client approval treats a supplied clientApproval as informational', () => {
    const result = expectNewRow(plan(requestFor(uxV1), { stageId: 'ux', projectDecisions: [approvedScope] }))
    expect(result.record.clientApproved).toBe(true)
    expect(result.currency).toBe('approved')
  })
})

describe('planStageDecision — blocking threads and deferrals', () => {
  const openBound: CommentThreadRecord = { threadKey: 'fig:thread-1', stageId: 'key_visual', artifactId: kvV1.id, sourceStatus: 'open', triageStatus: 'new', deferral: null }
  const openUnbound: CommentThreadRecord = { threadKey: 'fig:thread-2', stageId: 'key_visual', artifactId: null, sourceStatus: 'open', triageStatus: 'triaged', deferral: null }
  const resolved: CommentThreadRecord = { threadKey: 'fig:thread-3', stageId: 'key_visual', artifactId: kvV1.id, sourceStatus: 'resolved', triageStatus: 'new', deferral: null }
  const deferred: CommentThreadRecord = { threadKey: 'fig:thread-4', stageId: 'key_visual', artifactId: kvV1.id, sourceStatus: 'open', triageStatus: 'deferred', deferral: { artifactId: kvV1.id, contentHash: kvV1.contentHash } }
  const otherStage: CommentThreadRecord = { threadKey: 'fig:thread-5', stageId: 'ux', artifactId: uxV1.id, sourceStatus: 'open', triageStatus: 'new', deferral: null }
  const otherArtifact: CommentThreadRecord = { threadKey: 'fig:thread-6', stageId: 'key_visual', artifactId: 'aaaaaaa7-aaaa-4aaa-8aaa-aaaaaaaaaaa7', sourceStatus: 'open', triageStatus: 'new', deferral: null }
  const threads = [openBound, openUnbound, resolved, deferred, otherStage, otherArtifact]

  it('lists open un-triaged threads bound to the artifact or unbound on the stage', () => {
    expect(blockingThreadsFor(threads, 'key_visual', { artifactId: kvV1.id, contentHash: kvV1.contentHash }).map((thread) => thread.threadKey)).toEqual(['fig:thread-1', 'fig:thread-2'])
  })

  it('a deferral is hash-bound: it lifts the block only for the artifact version it was recorded on', () => {
    const kvV2 = record('aaaaaaa7-aaaa-4aaa-8aaa-aaaaaaaaaaa7', 'key_visual', 2, hash('7'), [bind(uxV1)])
    const deferredOnV1: CommentThreadRecord = { threadKey: 'fig:thread-7', stageId: 'key_visual', artifactId: kvV2.id, sourceStatus: 'open', triageStatus: 'deferred', deferral: { artifactId: kvV1.id, contentHash: kvV1.contentHash } }
    const deferredOnV2: CommentThreadRecord = { threadKey: 'fig:thread-8', stageId: 'key_visual', artifactId: kvV2.id, sourceStatus: 'open', triageStatus: 'deferred', deferral: { artifactId: kvV2.id, contentHash: kvV2.contentHash } }
    const deferredWithoutRecord: CommentThreadRecord = { threadKey: 'fig:thread-9', stageId: 'key_visual', artifactId: null, sourceStatus: 'open', triageStatus: 'deferred', deferral: null }
    const v2Threads = [deferredOnV1, deferredOnV2, deferredWithoutRecord]
    expect(blockingThreadsFor(v2Threads, 'key_visual', { artifactId: kvV2.id, contentHash: kvV2.contentHash }).map((thread) => thread.threadKey)).toEqual(['fig:thread-7', 'fig:thread-9'])
    const blocked = plan(requestFor(kvV2), { artifacts: [...fixtureArtifacts, kvV2], threads: v2Threads })
    if (!blocked.ok) expect(blocked.body.details.map((detail) => detail.path)).toEqual(['threads.fig:thread-7', 'threads.fig:thread-9'])
    expectFailure(blocked, 'blocking_comments_open', 422)
    const redeferred = expectNewRow(plan(requestFor(kvV2, { deferredThreadKeys: ['fig:thread-7', 'fig:thread-9'] }), { artifacts: [...fixtureArtifacts, kvV2], threads: v2Threads }))
    expect(redeferred.deferrals.map((deferral) => [deferral.threadKey, deferral.contentHash])).toEqual([['fig:thread-7', kvV2.contentHash], ['fig:thread-9', kvV2.contentHash]])
    expect(redeferred.record.deferredThreadKeys).toEqual(['fig:thread-7', 'fig:thread-9'])
    expect(redeferred.currency).toBe('approved')
  })

  it('open threads block the approval with one detail per thread', () => {
    const result = plan(requestFor(kvV1), { threads })
    expect(expectFailure(result, 'blocking_comments_open', 422)).toEqual(['blocking_comments_open', 'blocking_comments_open'])
    if (!result.ok) expect(result.body.details.map((detail) => detail.path)).toEqual(['threads.fig:thread-1', 'threads.fig:thread-2'])
  })

  it('deferring every open thread records hash-bound deferrals only for the open ones and stores exactly those keys', () => {
    const result = expectNewRow(plan(requestFor(kvV1, { deferredThreadKeys: ['fig:thread-1', 'fig:thread-2', 'fig:thread-4'] }), { threads }))
    expect(result.deferrals).toEqual([
      { threadKey: 'fig:thread-1', artifactId: kvV1.id, contentHash: kvV1.contentHash, reason: DEFERRED_BY_STAGE_DECISION },
      { threadKey: 'fig:thread-2', artifactId: kvV1.id, contentHash: kvV1.contentHash, reason: DEFERRED_BY_STAGE_DECISION },
    ])
    expect(result.record.deferredThreadKeys).toEqual(['fig:thread-1', 'fig:thread-2'])
    expect(result.currency).toBe('approved')
  })

  it('deferrals carry the decision reason when one is given', () => {
    const result = expectNewRow(plan(requestFor(kvV1, { reason: 'Discussed on the call', deferredThreadKeys: ['fig:thread-1', 'fig:thread-2'] }), { threads }))
    expect(result.deferrals.every((deferral) => deferral.reason === 'Discussed on the call')).toBe(true)
  })

  it('a partial deferral still blocks on the remaining thread', () => {
    const result = plan(requestFor(kvV1, { deferredThreadKeys: ['fig:thread-1'] }), { threads })
    if (!result.ok) expect(result.body.details.map((detail) => detail.path)).toEqual(['threads.fig:thread-2'])
    expectFailure(result, 'blocking_comments_open', 422)
  })

  it('deferring a thread of another stage or an unknown key is a foreign reference', () => {
    expect(expectFailure(plan(requestFor(kvV1, { deferredThreadKeys: ['fig:thread-1', 'fig:thread-2', 'fig:thread-5'] }), { threads }), 'foreign_reference', 422)).toEqual(['unknown_thread'])
    expectFailure(plan(requestFor(kvV1, { deferredThreadKeys: ['nope'] }), { threads }), 'foreign_reference', 422)
  })

  it('a rejection never records deferrals even when keys are listed', () => {
    const result = expectNewRow(plan(requestFor(kvV1, { verdict: 'rejected', reason: 'Rework', deferredThreadKeys: ['fig:thread-1'] }), { threads }))
    expect(result.deferrals).toEqual([])
    expect(result.record.deferredThreadKeys).toEqual([])
  })
})
