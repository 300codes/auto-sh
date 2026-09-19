import type { FlowStageId, StageArtifactV1 } from '../contracts'
import type { StageArtifactRecord, StageDecisionRecord } from '../flowRules'
import {
  checkAcReferences,
  downstreamStagesWithArtifacts,
  hashStageArtifactContent,
  nextStageArtifactVersion,
  planStageArtifact,
} from '../stageArtifacts'
import { loadFlowTemplateFixture, loadNegativeFlowFixtures, loadStageArtifactFixture } from '../fixtures/flow/index'

const project = { projectId: '11111111-1111-4111-8111-111111111111', targetProfileId: 'wordpress-theme', targetProfileVersion: 1 }
const template = loadFlowTemplateFixture()
const SCOPE_ID = 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const hash = (char: string) => char.repeat(64)

const record = (id: string, stageId: FlowStageId, version: number, contentHash: string, dependsOn: StageArtifactRecord['dependsOn'] = []): StageArtifactRecord => ({
  id,
  stageId,
  version,
  contentHash,
  dependsOn,
})
const bind = (target: StageArtifactRecord) => ({ stageId: target.stageId, artifactId: target.id, version: target.version, contentHash: target.contentHash })
const approve = (target: StageArtifactRecord, decidedAt = '2026-09-19T10:00:00.000Z'): StageDecisionRecord => ({
  id: `d-${target.id}-${decidedAt}`,
  stageId: target.stageId,
  artifactId: target.id,
  subjectHash: target.contentHash,
  verdict: 'approved',
  decidedAt,
  clientApproved: true,
})

const scopeV1 = record(SCOPE_ID, 'scope', 1, hash('2'))
const scopeV2 = record('aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'scope', 2, hash('5'))
const uxOnV1 = record('bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'ux', 1, hash('6'), [bind(scopeV1)])

function plan(artifact: StageArtifactV1, existing: StageArtifactRecord[], decisions: StageDecisionRecord[], extra: Partial<Parameters<typeof planStageArtifact>[0]> = {}) {
  return planStageArtifact({ artifact, project, template, existing, decisions, ...extra })
}

function expectFailure(result: ReturnType<typeof planStageArtifact>, code: string, status: number): string[] {
  expect(result.ok).toBe(false)
  if (result.ok) return []
  expect(result.body.code).toBe(code)
  expect(result.status).toBe(status)
  return result.body.details.map((detail) => detail.code)
}

describe('stage artifact content hash and version', () => {
  it('is deterministic, ignores provenance and changes with content or upstream binding', () => {
    const ux = loadStageArtifactFixture('ux')
    if (ux.stageId !== 'ux') throw new Error('fixture is not a ux artifact')
    const base = hashStageArtifactContent(ux)
    expect(hashStageArtifactContent(JSON.parse(JSON.stringify(ux)))).toBe(base)
    expect(hashStageArtifactContent({ ...ux, source: 'manual', producedBy: { tool: 'x', sessionRef: null } })).toBe(base)
    expect(hashStageArtifactContent({ ...ux, content: { ...ux.content, summary: 'changed' } })).not.toBe(base)
    expect(hashStageArtifactContent({ ...ux, dependsOn: [bind(scopeV2)] })).not.toBe(base)
  })

  it('numbers versions per stage', () => {
    expect(nextStageArtifactVersion([], 'scope')).toBe(1)
    expect(nextStageArtifactVersion([scopeV1, scopeV2, uxOnV1], 'scope')).toBe(3)
    expect(nextStageArtifactVersion([scopeV1, scopeV2, uxOnV1], 'ux')).toBe(2)
  })
})

describe('planStageArtifact — happy path', () => {
  it('creates the first Scope version without upstream', () => {
    const result = plan(loadStageArtifactFixture('scope'), [], [])
    expect(result).toEqual({ ok: true, duplicate: false, version: 1, contentHash: hashStageArtifactContent(loadStageArtifactFixture('scope')), downstreamNowStale: [] })
  })

  it('creates UX bound to the approved, current Scope', () => {
    const result = plan(loadStageArtifactFixture('ux'), [scopeV1], [approve(scopeV1)])
    expect(result.ok).toBe(true)
    if (result.ok && !result.duplicate) expect(result.version).toBe(1)
  })

  it('a new Scope version lists every downstream stage that already has an artifact as now stale', () => {
    const kv = record('ccccccc1-cccc-4ccc-8ccc-ccccccccccc1', 'key_visual', 1, hash('7'), [bind(uxOnV1)])
    const fixture = loadStageArtifactFixture('scope')
    if (fixture.stageId !== 'scope') throw new Error('fixture is not a scope artifact')
    const scope = { ...fixture, content: { ...fixture.content, summary: 'v2' } }
    const result = plan(scope, [scopeV1, uxOnV1, kv], [approve(scopeV1), approve(uxOnV1)])
    expect(result.ok).toBe(true)
    if (result.ok && !result.duplicate) {
      expect(result.version).toBe(2)
      expect(result.downstreamNowStale).toEqual(['ux', 'key_visual'])
    }
    expect(downstreamStagesWithArtifacts(template, [scopeV1], 'scope')).toEqual([])
  })

  it('follows the pinned template graph, not the fixed order, when listing stale downstream stages', () => {
    const branched = { ...template, stages: template.stages.map((stage) => (stage.stageId === 'key_visual' ? { ...stage, dependsOn: ['scope'] } : stage)) }
    const kv = record('ccccccc1-cccc-4ccc-8ccc-ccccccccccc1', 'key_visual', 1, hash('7'), [bind(scopeV1)])
    const ux = { ...loadStageArtifactFixture('ux'), attachments: [] }
    const result = planStageArtifact({ artifact: ux, project, template: branched, existing: [scopeV1, uxOnV1, kv], decisions: [approve(scopeV1)] })
    expect(result.ok).toBe(true)
    if (result.ok && !result.duplicate) expect(result.downstreamNowStale).toEqual([])
    expect(downstreamStagesWithArtifacts(branched, [scopeV1, uxOnV1, kv], 'scope')).toEqual(['ux', 'key_visual'])
  })
})

describe('planStageArtifact — duplicates', () => {
  it('identical content returns the existing row before any other check, flagged current or not', () => {
    const scope = loadStageArtifactFixture('scope')
    const existing = record('aaaaaaa9-aaaa-4aaa-8aaa-aaaaaaaaaaa9', 'scope', 1, hashStageArtifactContent(scope))
    const current = plan(scope, [existing], [])
    expect(current).toEqual({ ok: true, duplicate: true, existing: { artifactId: existing.id, version: 1, contentHash: existing.contentHash }, isCurrent: true, downstreamNowStale: [] })
    const later = record('aaaaaaa8-aaaa-4aaa-8aaa-aaaaaaaaaaa8', 'scope', 2, hash('8'))
    const older = plan({ ...scope, source: 'agent' }, [existing, later], [])
    expect(older.ok && older.duplicate && older.isCurrent).toBe(false)
    expect(older.ok && older.duplicate).toBe(true)
  })

  it('the same content on another stage is not a duplicate', () => {
    const ux = loadStageArtifactFixture('ux')
    const onOtherStage = record('ddddddd1-dddd-4ddd-8ddd-ddddddddddd1', 'key_visual', 1, hashStageArtifactContent(ux))
    const result = plan(ux, [scopeV1, onOtherStage], [approve(scopeV1)])
    expect(result.ok && !result.duplicate).toBe(true)
  })
})

describe('planStageArtifact — refusals', () => {
  it('foreign_reference: artifact of another project', () => {
    const artifact = { ...loadStageArtifactFixture('scope'), projectId: '22222222-2222-4222-8222-222222222222' }
    expect(expectFailure(plan(artifact, [], []), 'foreign_reference', 422)).toEqual(['foreign_project'])
  })

  it('foreign_reference: bound artifact unknown, of another stage, or with a forged version/hash', () => {
    const ux = loadStageArtifactFixture('ux')
    expect(expectFailure(plan(ux, [], []), 'foreign_reference', 422)).toEqual(['foreign_artifact'])
    const wrongStage = record(SCOPE_ID, 'ux', 1, hash('2'))
    expect(expectFailure(plan(ux, [wrongStage], []), 'foreign_reference', 422)).toEqual(['foreign_artifact'])
    const otherHash = record(SCOPE_ID, 'scope', 1, hash('3'))
    expect(expectFailure(plan(ux, [otherHash], [approve(otherHash)]), 'foreign_reference', 422)).toEqual(['dependency_mismatch'])
  })

  it('foreign_dependency: a dependency that is not strictly upstream (negative fixture and Scope binding anything)', () => {
    const fixture = loadNegativeFlowFixtures().find((candidate) => candidate.name === 'stage-artifact.dependency-not-upstream')!
    const artifact = fixture.document as StageArtifactV1
    expect(expectFailure(plan(artifact, [], []), fixture.expected.code, fixture.expected.status)).toEqual(['foreign_dependency'])
    const scope = { ...loadStageArtifactFixture('scope'), dependsOn: [bind(scopeV1)] } as StageArtifactV1
    expect(expectFailure(plan(scope, [scopeV1], []), 'foreign_dependency', 422)).toEqual(['foreign_dependency'])
  })

  it('duplicate_stable_id: the same upstream bound twice (negative fixture)', () => {
    const fixture = loadNegativeFlowFixtures().find((candidate) => candidate.name === 'stage-artifact.duplicate-dependency')!
    expect(expectFailure(plan(fixture.document as StageArtifactV1, [scopeV1], [approve(scopeV1)]), fixture.expected.code, fixture.expected.status)).toEqual(['duplicate_stable_id'])
  })

  it('stage_not_approved: upstream missing a decision or rejected', () => {
    const ux = loadStageArtifactFixture('ux')
    expect(expectFailure(plan(ux, [scopeV1], []), 'stage_not_approved', 422)).toEqual(['stage_not_approved'])
    const rejected: StageDecisionRecord = { ...approve(scopeV1), verdict: 'rejected' }
    expect(expectFailure(plan(ux, [scopeV1], [rejected]), 'stage_not_approved', 422)).toEqual(['stage_not_approved'])
  })

  it('stage_not_approved: an unapproved newer upstream version blocks, even when binding the old approved one', () => {
    const ux = loadStageArtifactFixture('ux')
    expect(expectFailure(plan(ux, [scopeV1, scopeV2], [approve(scopeV1)]), 'stage_not_approved', 422)).toEqual(['stage_not_approved'])
  })

  it('stage_dependency_stale: upstream approved but itself bound to a superseded version', () => {
    const kv: StageArtifactV1 = { ...loadStageArtifactFixture('ux'), stageId: 'key_visual', dependsOn: [bind(uxOnV1)] } as StageArtifactV1
    const decisions = [approve(scopeV1), approve(uxOnV1), approve(scopeV2, '2026-09-19T11:00:00.000Z')]
    expect(expectFailure(plan(kv, [scopeV1, scopeV2, uxOnV1], decisions), 'stage_dependency_stale', 422)).toEqual(['stage_dependency_stale'])
  })

  it('mixed upstream failures report every stage and answer stage_not_approved as the top code', () => {
    const kv = record('ccccccc1-cccc-4ccc-8ccc-ccccccccccc1', 'key_visual', 1, hash('7'), [bind(uxOnV1)])
    const dsui = { ...loadStageArtifactFixture('ux'), stageId: 'design_system_ui', dependsOn: [bind(uxOnV1), bind(kv)] } as StageArtifactV1
    const decisions = [approve(scopeV1), approve(uxOnV1), approve(scopeV2, '2026-09-19T11:00:00.000Z')]
    const result = plan(dsui, [scopeV1, scopeV2, uxOnV1, kv], decisions)
    expect(expectFailure(result, 'stage_not_approved', 422)).toEqual(['stage_dependency_stale', 'stage_not_approved'])
  })

  it('stage_artifact_stale (409): binding an approved upstream that is no longer current, or not binding it at all', () => {
    const ux = loadStageArtifactFixture('ux')
    const decisions = [approve(scopeV1), approve(scopeV2, '2026-09-19T11:00:00.000Z')]
    expect(expectFailure(plan(ux, [scopeV1, scopeV2], decisions), 'stage_artifact_stale', 409)).toEqual(['stage_artifact_stale'])
    expect(expectFailure(plan({ ...ux, dependsOn: [] }, [scopeV1], [approve(scopeV1)]), 'stage_artifact_stale', 409)).toEqual(['dependency_missing'])
    const rebound = plan({ ...ux, dependsOn: [bind(scopeV2)] }, [scopeV1, scopeV2], decisions)
    expect(rebound.ok).toBe(true)
  })

  it('target_profile_frozen: Scope names another platform than the project profile', () => {
    const scope = loadStageArtifactFixture('scope')
    if (scope.stageId !== 'scope') throw new Error('fixture is not a scope artifact')
    const other = { ...scope, content: { ...scope.content, platform: { ...scope.content.platform, profileId: 'react-vite' } } }
    const result = plan(other, [], [])
    expectFailure(result, 'target_profile_frozen', 422)
    if (!result.ok) expect(result.body.details[0].path).toBe('content.platform')
  })

  it('unknown_ac: references resolve against the Scope content or the caller-resolved scope', () => {
    const scope = loadStageArtifactFixture('scope')
    expect(plan(scope, [], [], { acReferences: [{ path: 'x', acId: 'AC-001' }] }).ok).toBe(true)
    expect(expectFailure(plan(scope, [], [], { acReferences: [{ path: 'x', acId: 'AC-999' }] }), 'unknown_ac', 422)).toEqual(['unknown_ac'])
    const ux = loadStageArtifactFixture('ux')
    const refs = [{ path: 'content.screens.0', acId: 'AC-002' }]
    expect(plan(ux, [scopeV1], [approve(scopeV1)], { acReferences: refs, resolvedScopeAcIds: new Set(['AC-001', 'AC-002']) }).ok).toBe(true)
    expect(expectFailure(plan(ux, [scopeV1], [approve(scopeV1)], { acReferences: refs }), 'unknown_ac', 422)).toEqual(['unknown_ac'])
    expect(checkAcReferences(new Set(['AC-001']), []).ok).toBe(true)
  })
})
