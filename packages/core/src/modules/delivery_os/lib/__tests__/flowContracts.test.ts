import {
  DELIVERY_CONTRACT_VERSION,
  DELIVERY_FLOW_CONTRACT_VERSION,
  DELIVERY_FLOW_SCHEMA_VERSIONS,
  DELIVERY_SCHEMA_VERSIONS,
  FLOW_APPROVAL_STAGE_ORDER,
  deliveryDocumentSchemas,
  deliveryErrorBodySchema,
  deliveryErrorCodes,
  deliveryFlowDocumentSchemas,
  deliveryFlowErrorCodes,
  deliveryFlowErrorFromZod,
  intakeUpdateRequestSchema,
  deliveryReportFlowSectionSchema,
  deliveryReportV1Schema,
  flowTemplateV1Schema,
  stageArtifactV1Schema,
} from '../contracts'
import { DEFAULT_FLOW_TEMPLATE, getBuiltInFlowTemplate } from '../flowTemplates'
import {
  checkFlowGate,
  checkPlatformChoiceFrozen,
  computeStageCurrency,
  flowGateBlockers,
  hashFlowTemplate,
  type StageArtifactRecord,
  type StageDecisionRecord,
} from '../flowRules'
import { loadDeliveryReportFixture } from '../fixtures'
import { loadIntakeFixture, loadStageArtifactFixture } from '../fixtures/flow'

const hash = (char: string) => char.repeat(64)
const artifact = (id: string, stageId: StageArtifactRecord['stageId'], version: number, contentHash: string, dependsOn: StageArtifactRecord['dependsOn'] = []): StageArtifactRecord => ({
  id,
  stageId,
  version,
  contentHash,
  dependsOn,
})
const approve = (id: string, target: StageArtifactRecord, decidedAt = '2026-09-19T10:00:00.000Z', clientApproved = true): StageDecisionRecord => ({
  id,
  stageId: target.stageId,
  artifactId: target.id,
  subjectHash: target.contentHash,
  verdict: 'approved',
  decidedAt,
  clientApproved,
})

describe('v1 boundary', () => {
  it('keeps the frozen v1 constants and maps untouched', () => {
    expect(DELIVERY_CONTRACT_VERSION).toBe(1)
    expect(Object.keys(DELIVERY_SCHEMA_VERSIONS).sort()).toEqual(
      ['baselineContent', 'designManifest', 'executionWidgetContext', 'planProposal', 'report', 'requirementsProposal', 'resultManifest', 'taskPackage'].sort(),
    )
    expect(Object.keys(deliveryDocumentSchemas)).toHaveLength(7)
    expect(Object.keys(deliveryErrorCodes)).toHaveLength(54)
  })

  it('flow codes and schema versions are disjoint from v1', () => {
    for (const code of Object.keys(deliveryFlowErrorCodes)) expect(code in deliveryErrorCodes).toBe(false)
    for (const version of Object.keys(deliveryFlowDocumentSchemas)) expect(version in deliveryDocumentSchemas).toBe(false)
    for (const version of Object.values(DELIVERY_FLOW_SCHEMA_VERSIONS)) expect(version.endsWith('/v1')).toBe(true)
    expect(DELIVERY_FLOW_CONTRACT_VERSION).toBe(1)
  })

  it('the v1 report still parses once the optional flow section is added', () => {
    const extended = deliveryReportV1Schema.extend({ flow: deliveryReportFlowSectionSchema.optional() })
    const report = loadDeliveryReportFixture()
    expect(extended.safeParse(report).success).toBe(true)
    expect(
      extended.safeParse({
        ...report,
        flow: { template: null, stages: [], gate: { ok: true, blocking: [] } },
      }).success,
    ).toBe(true)
  })
})

describe('default flow template', () => {
  it('is valid, has every approval stage in order and hashes deterministically', () => {
    expect(flowTemplateV1Schema.safeParse(DEFAULT_FLOW_TEMPLATE).success).toBe(true)
    const approvalKinds = DEFAULT_FLOW_TEMPLATE.stages.map((stage) => stage.kind).filter((kind) => (FLOW_APPROVAL_STAGE_ORDER as readonly string[]).includes(kind))
    expect(approvalKinds).toEqual([...FLOW_APPROVAL_STAGE_ORDER])
    expect(hashFlowTemplate(DEFAULT_FLOW_TEMPLATE)).toBe(hashFlowTemplate(JSON.parse(JSON.stringify(DEFAULT_FLOW_TEMPLATE))))
    expect(hashFlowTemplate({ ...DEFAULT_FLOW_TEMPLATE, title: 'renamed' })).not.toBe(hashFlowTemplate(DEFAULT_FLOW_TEMPLATE))
    expect(getBuiltInFlowTemplate('delivery-default', 1)).toBe(DEFAULT_FLOW_TEMPLATE)
    expect(getBuiltInFlowTemplate('delivery-default', 2)).toBeUndefined()
  })

  it('a config-only change (approval policy or client approval flag) changes the hash', () => {
    const stages = DEFAULT_FLOW_TEMPLATE.stages.map((stage) => (stage.kind === 'ux' ? { ...stage, requiresClientApproval: true } : stage))
    expect(hashFlowTemplate({ ...DEFAULT_FLOW_TEMPLATE, stages })).not.toBe(hashFlowTemplate(DEFAULT_FLOW_TEMPLATE))
  })

  it('refuses a template missing an approval stage, a duplicated approval kind, or a renamed approval stage id', () => {
    const stages = DEFAULT_FLOW_TEMPLATE.stages.filter((stage) => stage.kind !== 'key_visual').map((stage) => ({ ...stage, dependsOn: stage.dependsOn.filter((id) => id !== 'key_visual') }))
    expect(flowTemplateV1Schema.safeParse({ ...DEFAULT_FLOW_TEMPLATE, stages }).success).toBe(false)
    const twiceUx = [...DEFAULT_FLOW_TEMPLATE.stages, { ...DEFAULT_FLOW_TEMPLATE.stages[1], stageId: 'ux-2' }]
    expect(flowTemplateV1Schema.safeParse({ ...DEFAULT_FLOW_TEMPLATE, stages: twiceUx }).success).toBe(false)
    const renamed = DEFAULT_FLOW_TEMPLATE.stages.map((stage) => (stage.kind === 'ux' ? { ...stage, stageId: 'ux-figma' } : stage.kind === 'key_visual' ? { ...stage, dependsOn: ['ux-figma'] } : stage))
    expect(flowTemplateV1Schema.safeParse({ ...DEFAULT_FLOW_TEMPLATE, stages: renamed }).success).toBe(false)
  })

  it('refuses an approval stage that depends on a downstream approval stage even without a cycle', () => {
    const stages = DEFAULT_FLOW_TEMPLATE.stages.map((stage) => (stage.kind === 'scope' ? { ...stage, dependsOn: ['ux'] } : stage.kind === 'ux' ? { ...stage, dependsOn: [] } : stage))
    const parsed = flowTemplateV1Schema.safeParse({ ...DEFAULT_FLOW_TEMPLATE, stages })
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(deliveryFlowErrorFromZod(parsed.error).body.code).toBe('foreign_dependency')
  })
})

describe('intake update request', () => {
  it('drops the server-owned proposals from the wizard body', () => {
    const { projectId: _projectId, proposals: _proposals, ...body } = loadIntakeFixture()
    const parsed = intakeUpdateRequestSchema.safeParse({ ...body, proposals: [{ proposalId: 'forged', kind: 'scope', contentHash: hash('f'), proposedAt: '2026-09-19T10:00:00.000Z', status: 'accepted' }] })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect('proposals' in parsed.data).toBe(false)
  })
})

describe('stage artifacts', () => {
  it('a scope artifact never binds an upstream, a ux artifact binds only scope', () => {
    const scope = loadStageArtifactFixture('scope')
    const ux = loadStageArtifactFixture('ux')
    expect(stageArtifactV1Schema.safeParse({ ...scope, dependsOn: ux.dependsOn }).success).toBe(false)
    expect(stageArtifactV1Schema.safeParse(ux).success).toBe(true)
  })
})

describe('computeStageCurrency + checkFlowGate', () => {
  const scope1 = artifact('s1', 'scope', 1, hash('a'))
  const ux1 = artifact('u1', 'ux', 1, hash('b'), [{ stageId: 'scope', artifactId: 's1', version: 1, contentHash: hash('a') }])
  const kv1 = artifact('k1', 'key_visual', 1, hash('c'), [{ stageId: 'ux', artifactId: 'u1', version: 1, contentHash: hash('b') }])
  const ds1 = artifact('d1', 'design_system_ui', 1, hash('d'), [{ stageId: 'key_visual', artifactId: 'k1', version: 1, contentHash: hash('c') }])
  const allApproved = [approve('dec-s', scope1), approve('dec-u', ux1), approve('dec-k', kv1), approve('dec-d', ds1)]

  it('all four approved and bound to current upstream hashes → gate open', () => {
    const states = computeStageCurrency(DEFAULT_FLOW_TEMPLATE, [scope1, ux1, kv1, ds1], allApproved)
    expect(Object.values(states).map((state) => state.currency)).toEqual(['approved', 'approved', 'approved', 'approved'])
    expect(checkFlowGate(states)).toEqual({ ok: true })
    expect(flowGateBlockers(states)).toEqual([])
  })

  it('a new scope version makes scope pending and every dependant stale, without deleting history', () => {
    const scope2 = artifact('s2', 'scope', 2, hash('e'))
    const states = computeStageCurrency(DEFAULT_FLOW_TEMPLATE, [scope1, scope2, ux1, kv1, ds1], allApproved)
    expect(states.scope.currency).toBe('pending')
    expect(states.scope.approvedArtifact?.artifactId).toBe('s1')
    expect(states.ux.currency).toBe('stale')
    expect(states.ux.blockers[0]).toEqual({ kind: 'upstream_not_approved', stageId: 'ux', ref: 'scope' })
    expect(states.key_visual.currency).toBe('stale')
    expect(states.design_system_ui.currency).toBe('stale')
    const gate = checkFlowGate(states)
    expect(gate.ok).toBe(false)
    if (!gate.ok) {
      expect(gate.status).toBe(422)
      expect(gate.body.code).toBe('stage_not_approved')
      expect(gate.body.details.map((detail) => detail.path)).toEqual(['stages.scope', 'stages.ux', 'stages.key_visual', 'stages.design_system_ui'])
      expect(gate.body.details.map((detail) => detail.code)).toEqual(['stage_not_approved', 'stage_dependency_stale', 'stage_dependency_stale', 'stage_dependency_stale'])
    }
    const v1Gate = checkFlowGate(states, FLOW_APPROVAL_STAGE_ORDER, { v1Compatible: true })
    expect(v1Gate.ok).toBe(false)
    if (!v1Gate.ok) {
      expect(v1Gate.body.code).toBe('baseline_not_approved')
      expect(deliveryErrorBodySchema.safeParse(v1Gate.body).success).toBe(true)
    }
  })

  it('re-approving the new scope version leaves dependants stale until they re-bind', () => {
    const scope2 = artifact('s2', 'scope', 2, hash('e'))
    const states = computeStageCurrency(DEFAULT_FLOW_TEMPLATE, [scope1, scope2, ux1, kv1, ds1], [...allApproved, approve('dec-s2', scope2)])
    expect(states.scope.currency).toBe('approved')
    expect(states.ux.currency).toBe('stale')
    expect(states.ux.blockers[0]).toEqual({ kind: 'upstream_stale', stageId: 'ux', ref: 'scope' })
    const ux2 = artifact('u2', 'ux', 2, hash('f'), [{ stageId: 'scope', artifactId: 's2', version: 2, contentHash: hash('e') }])
    const rebound = computeStageCurrency(DEFAULT_FLOW_TEMPLATE, [scope1, scope2, ux1, ux2, kv1, ds1], [...allApproved, approve('dec-s2', scope2), approve('dec-u2', ux2)])
    expect(rebound.ux.currency).toBe('approved')
    expect(rebound.key_visual.currency).toBe('stale')
  })

  it('a rejection, a later reject after approve, and a missing artifact each block', () => {
    const rejected: StageDecisionRecord = { ...approve('dec-k-reject', kv1, '2026-09-19T11:00:00.000Z'), verdict: 'rejected' }
    const states = computeStageCurrency(DEFAULT_FLOW_TEMPLATE, [scope1, ux1, kv1], [...allApproved, rejected])
    expect(states.key_visual.currency).toBe('rejected')
    expect(states.key_visual.latestDecision?.decisionId).toBe('dec-k-reject')
    expect(states.design_system_ui.currency).toBe('missing')
    expect(states.design_system_ui.blockers).toEqual([{ kind: 'artifact_missing', stageId: 'design_system_ui', ref: null }])
  })

  it('a stage that requires client approval stays pending on an approval without client evidence', () => {
    const decisions = [approve('dec-s', scope1), approve('dec-u', ux1), approve('dec-k', kv1, '2026-09-19T10:00:00.000Z', false)]
    const states = computeStageCurrency(DEFAULT_FLOW_TEMPLATE, [scope1, ux1, kv1], decisions)
    expect(states.key_visual.currency).toBe('pending')
    expect(states.key_visual.approvedArtifact).toBeNull()
  })

  it('an approved dependant that never bound its upstream is stale with an upstream_stale blocker', () => {
    const unbound = artifact('u-unbound', 'ux', 1, hash('b'))
    const states = computeStageCurrency(DEFAULT_FLOW_TEMPLATE, [scope1, unbound], [approve('dec-s', scope1), approve('dec-u', unbound)])
    expect(states.ux.currency).toBe('stale')
    expect(states.ux.blockers).toEqual([{ kind: 'upstream_stale', stageId: 'ux', ref: 'scope' }])
  })

  it('open comments surface as a blocker in every decision state', () => {
    const rejectedUx: StageDecisionRecord = { ...approve('dec-u-reject', ux1), verdict: 'rejected' }
    const states = computeStageCurrency(DEFAULT_FLOW_TEMPLATE, [scope1, ux1, kv1], [approve('dec-s', scope1), rejectedUx], { openThreadsByStage: { ux: 2, scope: 1, key_visual: 3 } })
    expect(states.ux.blockers.map((blocker) => blocker.kind)).toEqual(['rejected', 'open_comments'])
    expect(states.scope.blockers.map((blocker) => blocker.kind)).toEqual(['open_comments'])
    expect(states.key_visual.blockers.map((blocker) => blocker.kind)).toEqual(['decision_pending', 'open_comments'])
  })

  it('a decision for an older hash of the same artifact id does not count', () => {
    const wrongHash: StageDecisionRecord = { ...approve('dec-s-old', scope1), subjectHash: hash('9') }
    const states = computeStageCurrency(DEFAULT_FLOW_TEMPLATE, [scope1], [wrongHash])
    expect(states.scope.currency).toBe('pending')
  })

  it('legacy projects without a pinned template are not gated', () => {
    expect(checkFlowGate(null)).toEqual({ ok: true })
    expect(flowGateBlockers(null)).toEqual([{ kind: 'template_not_pinned', stageId: null, ref: null }])
  })
})

describe('checkPlatformChoiceFrozen', () => {
  const project = { targetProfileId: 'wordpress-theme', targetProfileVersion: 1 }

  it('accepts no choice or the same profile', () => {
    expect(checkPlatformChoiceFrozen(project, null)).toEqual({ ok: true })
    expect(checkPlatformChoiceFrozen(project, { profileId: 'wordpress-theme', profileVersion: 1 })).toEqual({ ok: true })
  })

  it('refuses another profile or version with 422 target_profile_frozen', () => {
    const result = checkPlatformChoiceFrozen(project, { profileId: 'react-vite', profileVersion: 1 })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(422)
      expect(result.body.code).toBe('target_profile_frozen')
      expect(result.body.details[0]?.path).toBe('platform.chosen')
    }
    expect(checkPlatformChoiceFrozen(project, { profileId: 'wordpress-theme', profileVersion: 2 }).ok).toBe(false)
  })
})
