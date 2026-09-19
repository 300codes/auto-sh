import type { ReconciliationResolution, ResultManifestV1 } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { parseResultManifest, type ResultIssue } from './resultImport'

export const RECONCILIATION_RESOLUTIONS: readonly ReconciliationResolution[] = [
  'not_started',
  'stopped',
  'completed',
  'unknown',
]

export type ReconcileDraft = {
  resolution: ReconciliationResolution
  note: string
  /** What the operator typed into a `datetime-local` input, in local time. */
  observedAt: string
  externalRunId: string
  manifestRaw: string
}

export type ReconcileField = 'note' | 'observedAt' | 'externalRunId' | 'manifest'

export type ReconcileRequestBody = {
  resolution: ReconciliationResolution
  externalEvidence: { note: string; observedAt: string; externalRunId?: string }
  manifest?: ResultManifestV1
}

export type ReconcileBuildResult =
  | { ok: true; body: ReconcileRequestBody }
  | { ok: false; field: ReconcileField; reason: 'required' | 'tooLong' | 'invalid' | 'manifestInvalid'; issues?: ResultIssue[] }

const MAX_NOTE_CHARS = 4000
const MAX_EXTERNAL_RUN_ID_CHARS = 200

/** `datetime-local` wants `YYYY-MM-DDTHH:mm` in the viewer's own zone. */
export function nowAsLocalInputValue(now: Date = new Date()): string {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

/** Server codes that carry a distinct cause; anything else is an unnamed failure and says so. */
export const RECONCILE_ERROR_KEYS: Record<string, string> = {
  attempt_not_reconcilable: 'delivery_os.task.reconcile.error.attemptNotReconcilable',
  attempt_not_active: 'delivery_os.task.reconcile.error.attemptNotActive',
  attempt_not_found: 'delivery_os.task.reconcile.error.attemptNotFound',
  manifest_required: 'delivery_os.task.reconcile.error.manifestRequired',
  result_conflict: 'delivery_os.task.reconcile.error.resultConflict',
  path_not_allowed: 'delivery_os.task.reconcile.error.pathNotAllowed',
  unknown_test_id: 'delivery_os.task.reconcile.error.unknownTestId',
  correlation_mismatch: 'delivery_os.task.reconcile.error.correlationMismatch',
  baseline_mismatch: 'delivery_os.task.reconcile.error.baselineMismatch',
  payload_too_large: 'delivery_os.task.reconcile.error.payloadTooLarge',
  not_found: 'delivery_os.task.reconcile.error.notFound',
  forbidden: 'delivery_os.task.reconcile.error.forbidden',
  validation_failed: 'delivery_os.task.reconcile.error.validationFailed',
  optimistic_lock_required: 'delivery_os.task.reconcile.error.lockRequired',
}

/** A local refusal names the FIELD, so the operator knows what to change. */
export const RECONCILE_FIELD_ERROR_KEYS: Record<ReconcileField, Record<string, string>> = {
  note: {
    required: 'delivery_os.task.reconcile.error.noteRequired',
    tooLong: 'delivery_os.task.reconcile.error.noteTooLong',
  },
  observedAt: {
    required: 'delivery_os.task.reconcile.error.observedAtRequired',
    invalid: 'delivery_os.task.reconcile.error.observedAtInvalid',
  },
  externalRunId: { tooLong: 'delivery_os.task.reconcile.error.externalRunIdTooLong' },
  manifest: {
    required: 'delivery_os.task.reconcile.error.manifestRequired',
    manifestInvalid: 'delivery_os.task.reconcile.error.manifestInvalid',
  },
}

export function emptyReconcileDraft(observedAt: string): ReconcileDraft {
  return { resolution: 'unknown', note: '', observedAt, externalRunId: '', manifestRaw: '' }
}

/** A `datetime-local` value carries no zone; the contract wants an absolute instant. */
function toIsoInstant(localValue: string): string | null {
  const trimmed = localValue.trim()
  if (trimmed.length === 0) return null
  const parsed = new Date(trimmed)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

/**
 * Every resolution needs a human statement and the moment it was observed —
 * that is what makes a reconciliation evidence rather than a guess. `completed`
 * additionally needs the manifest, and it is refused HERE so the operator sees
 * which field is missing instead of a `422 manifest_required` from the server.
 */
export function buildReconcileRequest(draft: ReconcileDraft): ReconcileBuildResult {
  const note = draft.note.trim()
  if (note.length === 0) return { ok: false, field: 'note', reason: 'required' }
  if (note.length > MAX_NOTE_CHARS) return { ok: false, field: 'note', reason: 'tooLong' }

  const observedAt = toIsoInstant(draft.observedAt)
  if (observedAt === null) return { ok: false, field: 'observedAt', reason: draft.observedAt.trim().length === 0 ? 'required' : 'invalid' }

  const externalRunId = draft.externalRunId.trim()
  if (externalRunId.length > MAX_EXTERNAL_RUN_ID_CHARS) return { ok: false, field: 'externalRunId', reason: 'tooLong' }

  const externalEvidence = { note, observedAt, ...(externalRunId.length > 0 ? { externalRunId } : {}) }
  if (draft.resolution !== 'completed') return { ok: true, body: { resolution: draft.resolution, externalEvidence } }

  if (draft.manifestRaw.trim().length === 0) return { ok: false, field: 'manifest', reason: 'required' }
  const manifest = parseResultManifest(draft.manifestRaw)
  if (!manifest.ok) {
    return {
      ok: false,
      field: 'manifest',
      reason: 'manifestInvalid',
      issues: manifest.reason === 'schema' ? manifest.issues : undefined,
    }
  }
  return { ok: true, body: { resolution: 'completed', externalEvidence, manifest: manifest.manifest } }
}
