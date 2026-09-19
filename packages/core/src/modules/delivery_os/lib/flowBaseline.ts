import { z } from 'zod'
import { draftSpecV1Schema } from '../data/validators'
import { designStageContentSchema, scopeContentSchema, sha256Schema, stageArtifactDependencySchema, uuidSchema, type StageArtifactDependency } from './contracts'
import { hashCanonical } from './hash'

export const flowBaselineMaterializeSchema = z.object({ projectId: uuidSchema })
export const flowBaselineProvenanceSchema = z.object({
  templateHash: sha256Schema,
  stageRefs: z.array(stageArtifactDependencySchema).length(4),
  draftHash: sha256Schema,
})
export const flowBaselineResponseSchema = z.object({
  projectId: uuidSchema,
  projectUpdatedAt: z.string(),
  templateHash: sha256Schema,
  stageRefs: z.array(stageArtifactDependencySchema).length(4),
  draftHash: sha256Schema,
})

export function materializeFlowDraft(scopeContent: unknown, designContent: unknown) {
  const scope = scopeContentSchema.parse(scopeContent)
  const design = designStageContentSchema.parse(designContent)
  const criteria = [...scope.acceptanceCriteria].sort((left, right) => left.id.localeCompare(right.id))
  return draftSpecV1Schema.parse({
    requirements: [...scope.requirements].sort((left, right) => left.id.localeCompare(right.id)),
    acceptanceCriteria: criteria,
    risks: scope.risks,
    screens: [...design.screens].sort((left, right) => left.fileKey.localeCompare(right.fileKey) || left.nodeId.localeCompare(right.nodeId) || left.viewport.width - right.viewport.width || left.viewport.height - right.viewport.height),
    tokens: design.tokens ?? {},
    architectureSummary: scope.platform.rationale,
    planSummary: scope.summary,
    acTestMap: Object.fromEntries(criteria.map((criterion) => [criterion.id, []])),
    manualChecks: Object.fromEntries(criteria.map((criterion) => [criterion.id, `flow-${hashCanonical(criterion).slice(0, 24)}`])),
  })
}

export function flowRefsHash(stageRefs: readonly StageArtifactDependency[]): string {
  return hashCanonical([...stageRefs].sort((left, right) => left.stageId.localeCompare(right.stageId)))
}
