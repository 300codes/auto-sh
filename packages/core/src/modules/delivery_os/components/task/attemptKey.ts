import type { SourceRevision } from '@open-mercato/core/modules/delivery_os/lib/contracts'

export type AttemptKeyInput = {
  taskId: string
  baseRevision: SourceRevision
  /** The register length BEFORE this reservation — `TaskDto.attemptNumber`. */
  attemptNumber: number
}

const KEY_PREFIX = 'delivery_os.attempt'
/** `idempotencyKeySchema` is `^[\x21-\x7E]{1,200}$` — printable ASCII, no spaces. */
const MAX_KEY_LENGTH = 200
const DIGEST_LENGTH = 16
const NON_PRINTABLE_ASCII = /[^\x21-\x7E]/g

function fnv1a(value: string, seed: number): string {
  let hash = seed >>> 0
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index) & 0xff
    hash = Math.imul(hash, 0x01000193) >>> 0
    hash ^= value.charCodeAt(index) >>> 8
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * An external workspace id is free text, so it can carry anything the key
 * alphabet forbids. The digest of the RAW token is what keeps two revisions
 * apart; the readable part only exists so the key is recognisable in the audit
 * log.
 */
function describeRevision(revision: SourceRevision): string {
  return revision.kind === 'git'
    ? `git.${revision.commitSha}`
    : `snapshot.${revision.contentHash}.${revision.externalWorkspaceId}`
}

/**
 * The key is a pure function of (task, revision, attempt number), so clicking
 * "reserve" twice lands on the SAME attempt — the server answers 200 with the
 * existing reservation instead of opening a second one or refusing with a
 * conflict the operator cannot act on. A different revision is a different
 * attempt, which is why the revision is part of the key.
 */
export function buildAttemptIdempotencyKey({ taskId, baseRevision, attemptNumber }: AttemptKeyInput): string {
  const raw = `${KEY_PREFIX}:${taskId}:${attemptNumber}:${describeRevision(baseRevision)}`
  const digest = `${fnv1a(raw, 0x811c9dc5)}${fnv1a(raw, 0x2fdbc5a3)}`
  const readable = raw.replace(NON_PRINTABLE_ASCII, '_').slice(0, MAX_KEY_LENGTH - DIGEST_LENGTH - 1)
  return `${readable}-${digest}`
}
