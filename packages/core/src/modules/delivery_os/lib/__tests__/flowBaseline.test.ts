import { loadStageArtifactFixture } from '../fixtures/flow'
import { materializeFlowDraft, flowRefsHash } from '../flowBaseline'
import { hashCanonical } from '../hash'

describe('flow draft materialization', () => {
  it('deterministically maps every scope criterion to an explicit manual check without inventing test files or approvals', () => {
    const scope = loadStageArtifactFixture('scope')
    const design = loadStageArtifactFixture('ux')
    if (scope.stageId !== 'scope' || design.stageId === 'scope') throw new Error('[internal] fixture mismatch')
    const draft = materializeFlowDraft(scope.content, design.content)
    const reordered = materializeFlowDraft({ ...scope.content, requirements: [...scope.content.requirements].reverse(), acceptanceCriteria: [...scope.content.acceptanceCriteria].reverse() }, design.content)
    expect(hashCanonical(reordered)).toBe(hashCanonical(draft))
    expect(Object.keys(draft.manualChecks).sort()).toEqual(scope.content.acceptanceCriteria.map((criterion) => criterion.id).sort())
    expect(draft.declaredTests).toEqual([])
    expect(draft).not.toHaveProperty('decisions')
    expect(draft.screens).toEqual(design.content.screens)
  })

  it('includes artifact identity and version in binding identity even when content hashes match', () => {
    const ref = { stageId: 'scope' as const, artifactId: '11111111-1111-4111-8111-111111111111', version: 1, contentHash: 'a'.repeat(64) }
    expect(flowRefsHash([ref])).not.toBe(flowRefsHash([{ ...ref, version: 2 }]))
    expect(flowRefsHash([ref])).not.toBe(flowRefsHash([{ ...ref, artifactId: '22222222-2222-4222-8222-222222222222' }]))
  })
})
