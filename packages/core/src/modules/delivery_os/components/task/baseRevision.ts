import { sourceRevisionSchema, type SourceRevision } from '@open-mercato/core/modules/delivery_os/lib/contracts'

export type RevisionKind = SourceRevision['kind']

export type RevisionDraft = {
  commitSha: string
  contentHash: string
  externalWorkspaceId: string
}

export type RevisionField = 'commitSha' | 'contentHash' | 'externalWorkspaceId'

export type RevisionParseResult =
  | { ok: true; revision: SourceRevision }
  | { ok: false; field: RevisionField }

export const emptyRevisionDraft: RevisionDraft = { commitSha: '', contentHash: '', externalWorkspaceId: '' }

/**
 * The target profile decides which revision kind a task accepts, so the form
 * collects exactly the fields of that kind and the contract schema — not a
 * hand-written regex — decides whether they are usable. A refusal names the
 * field, because "invalid revision" would not tell the operator what to fix.
 */
export function parseRevisionDraft(kind: RevisionKind, draft: RevisionDraft): RevisionParseResult {
  const candidate = kind === 'git'
    ? { kind: 'git', commitSha: draft.commitSha.trim() }
    : { kind: 'snapshot', contentHash: draft.contentHash.trim(), externalWorkspaceId: draft.externalWorkspaceId.trim() }
  const parsed = sourceRevisionSchema.safeParse(candidate)
  if (parsed.success) return { ok: true, revision: parsed.data }
  const failedField = parsed.error.issues.map((issue) => issue.path[0]).find((segment) => typeof segment === 'string')
  return { ok: false, field: (failedField as RevisionField | undefined) ?? (kind === 'git' ? 'commitSha' : 'contentHash') }
}

/** Short, stable label of the revision an attempt is being reserved against. */
export function describeRevisionForDisplay(revision: SourceRevision): string {
  return revision.kind === 'git'
    ? revision.commitSha.slice(0, 12)
    : `${revision.externalWorkspaceId} · ${revision.contentHash.slice(0, 12)}`
}
