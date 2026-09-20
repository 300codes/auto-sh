import {
  designStageContentSchema,
  scopeContentSchema,
  stageArtifactV1Schema,
  type DesignStageContent,
  type ScopeContent,
  type StageArtifactV1,
} from '../../lib/contracts'

/**
 * Three outcomes, never two. A stage artifact carries either scope content or
 * design content; a payload that satisfies neither is a named failure, not an
 * empty section, because an operator must never approve what could not be read.
 */
export type StageContentView =
  | { kind: 'scope'; scope: ScopeContent }
  | { kind: 'design'; design: DesignStageContent }
  | { kind: 'unreadable' }

export function resolveStageContent(content: unknown): StageContentView {
  const scope = scopeContentSchema.safeParse(content)
  if (scope.success) return { kind: 'scope', scope: scope.data }
  const design = designStageContentSchema.safeParse(content)
  if (design.success) return { kind: 'design', design: design.data }
  return { kind: 'unreadable' }
}

export function shortenHash(hash: string): string {
  return hash.slice(0, 8)
}

const SUBMITTABLE_SOURCES: readonly string[] = ['manual', 'agent', 'figma']

/**
 * The submit-time contract, unchanged from the raw-document path it replaces:
 * the envelope must satisfy the schema, name this project and this stage, and
 * carry a source the artifacts endpoint accepts.
 */
export function resolveSubmittableArtifact(document: unknown, projectId: string, stageId: string): StageArtifactV1 | null {
  const parsed = stageArtifactV1Schema.safeParse(document)
  if (!parsed.success) return null
  if (parsed.data.projectId !== projectId || parsed.data.stageId !== stageId) return null
  if (!SUBMITTABLE_SOURCES.includes(parsed.data.source)) return null
  return parsed.data
}

export type StageArtifactDocumentParse =
  | { ok: true; artifact: StageArtifactV1 }
  | { ok: false; reason: 'json' | 'document' }

export function parseStageArtifactDocument(raw: string, projectId: string, stageId: string): StageArtifactDocumentParse {
  let document: unknown
  try {
    document = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'json' }
  }
  const artifact = resolveSubmittableArtifact(document, projectId, stageId)
  return artifact ? { ok: true, artifact } : { ok: false, reason: 'document' }
}
