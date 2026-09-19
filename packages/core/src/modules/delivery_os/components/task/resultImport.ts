import type { z } from 'zod'
import {
  resultManifestV1Schema,
  type CheckStatus,
  type DeliveryUsage,
  type ResultManifestV1,
} from '@open-mercato/core/modules/delivery_os/lib/contracts'

export type ResultIssue = { path: string; code: string; message: string }

/**
 * A manifest is pasted, so the first thing that can fail is the text, not the
 * contract. `not_json` and `not_object` stay apart from a schema failure
 * because they send the operator to a different mistake: a truncated paste
 * rather than a wrong field.
 */
export type ResultParseFailure =
  | { ok: false; reason: 'empty' }
  | { ok: false; reason: 'too_large'; length: number; limit: number }
  | { ok: false; reason: 'not_json' }
  | { ok: false; reason: 'not_object' }
  | { ok: false; reason: 'schema'; issues: ResultIssue[] }

export type ResultParseResult = { ok: true; manifest: ResultManifestV1 } | ResultParseFailure

/** `manifestBodySchema` in `data/validators.ts` refuses anything longer. */
export const MAX_RESULT_MANIFEST_CHARS = 2_000_000

function formatIssuePath(path: readonly PropertyKey[]): string {
  return path.map((segment) => String(segment)).join('.')
}

/**
 * `addDeliveryIssue` files every domain refusal as a zod `custom` issue and
 * carries the real code in `params.deliveryCode`. Reporting `custom` would give
 * `path_not_allowed`, `unknown_test_id` and `baseline_mismatch` the same word —
 * the very codes the server itself names in `details[]`.
 */
function readDeliveryCode(issue: z.core.$ZodIssue): string {
  if (issue.code !== 'custom') return issue.code
  const candidate = issue.params?.deliveryCode
  return typeof candidate === 'string' ? candidate : issue.code
}

function collectIssues(error: z.ZodError): ResultIssue[] {
  return error.issues.map((issue) => ({
    path: formatIssuePath(issue.path),
    code: readDeliveryCode(issue),
    message: issue.message,
  }))
}

/**
 * Double validation, not a replacement: the server stays the authority. Parsing
 * here only catches the agent's typo while the paste is still on screen.
 */
export function parseResultManifest(raw: string): ResultParseResult {
  const text = raw.trim()
  if (text.length === 0) return { ok: false, reason: 'empty' }
  if (text.length > MAX_RESULT_MANIFEST_CHARS) {
    return { ok: false, reason: 'too_large', length: text.length, limit: MAX_RESULT_MANIFEST_CHARS }
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'not_json' }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ok: false, reason: 'not_object' }
  const parsed = resultManifestV1Schema.safeParse(value)
  if (!parsed.success) return { ok: false, reason: 'schema', issues: collectIssues(parsed.error) }
  return { ok: true, manifest: parsed.data }
}

export type ResultCheckCounts = Record<CheckStatus, number>

export type ResultManifestSummary = {
  taskId: string
  attemptId: string
  baselineId: string
  baselineHash: string
  externalRunId: string
  checks: ResultCheckCounts
  checkCount: number
  changedPathCount: number
  findingCount: number
  artifactCount: number
  artifactBytes: number
  usage: DeliveryUsage
}

/**
 * The three check states are counted separately on purpose: `not_run` is a
 * check that produced no evidence, and adding it to the passing side would turn
 * a gap into a proof.
 */
export function countChecksByStatus(manifest: { checks: ReadonlyArray<{ status: CheckStatus }> }): ResultCheckCounts {
  return manifest.checks.reduce<ResultCheckCounts>(
    (counts, check) => ({ ...counts, [check.status]: counts[check.status] + 1 }),
    { passed: 0, failed: 0, not_run: 0 },
  )
}

export function summarizeResultManifest(manifest: ResultManifestV1): ResultManifestSummary {
  return {
    taskId: manifest.taskId,
    attemptId: manifest.attemptId,
    baselineId: manifest.baselineId,
    baselineHash: manifest.baselineHash,
    externalRunId: manifest.externalRunId,
    checks: countChecksByStatus(manifest),
    checkCount: manifest.checks.length,
    changedPathCount: manifest.changedPaths.length,
    findingCount: manifest.findings.length,
    artifactCount: manifest.artifacts.length,
    artifactBytes: manifest.artifacts.reduce((sum, artifact) => sum + (artifact.sizeBytes ?? 0), 0),
    usage: manifest.usage,
  }
}

/**
 * The manifest names the task and the attempt it was produced for. Sending it
 * elsewhere is refused by the server as `correlation_mismatch`; catching it
 * here names the mismatch while the paste is still in front of the operator.
 */
export function manifestTargetsAttempt(
  manifest: ResultManifestV1,
  target: { taskId: string; attemptId: string },
): boolean {
  return manifest.taskId === target.taskId && manifest.attemptId === target.attemptId
}

/** `'unknown'` is a declaration that the run did not measure usage, not a zero. */
export function usageIsUnknown(usage: DeliveryUsage): boolean {
  return usage.values === 'unknown'
}
