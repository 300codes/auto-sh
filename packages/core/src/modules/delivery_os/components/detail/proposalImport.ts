import type { z } from 'zod'
import {
  planProposalV1Schema,
  requirementsProposalV1Schema,
  type PlanProposalV1,
  type RequirementsProposalV1,
} from '@open-mercato/core/modules/delivery_os/lib/contracts'

/**
 * Manifests are pasted, so the first thing that can fail is not the schema but
 * the text itself. `not_json` and `not_object` are kept apart from a schema
 * failure because they point the operator at a different mistake: a truncated
 * paste, not a wrong field.
 */
export type ProposalParseFailure =
  | { ok: false; reason: 'empty' }
  | { ok: false; reason: 'too_large'; length: number; limit: number }
  | { ok: false; reason: 'not_json' }
  | { ok: false; reason: 'not_object' }
  | { ok: false; reason: 'schema'; issues: ProposalIssue[] }

export type ProposalIssue = { path: string; code: string; message: string }

export type ProposalParseResult<TManifest> = { ok: true; manifest: TManifest } | ProposalParseFailure

export const MAX_MANIFEST_BODY_CHARS = 2_000_000

/**
 * A zod path is an array of segments; the operator needs the dotted form that
 * matches how the server reports `details[].path`, so both sides of the loop
 * name the same field.
 */
function formatIssuePath(path: readonly PropertyKey[]): string {
  return path.map((segment) => String(segment)).join('.')
}

/**
 * `addDeliveryIssue` files its issues as zod `custom` and carries the real code
 * in `params.deliveryCode`. Reporting `custom` would hand the operator the same
 * word for a foreign dependency, a cycle and a forbidden path — the codes the
 * server itself reports in `details[]`.
 */
function readDeliveryCode(issue: z.core.$ZodIssue): string {
  if (issue.code !== 'custom') return issue.code
  const candidate = issue.params?.deliveryCode
  return typeof candidate === 'string' ? candidate : issue.code
}

function collectIssues(error: z.ZodError): ProposalIssue[] {
  return error.issues.map((issue) => ({
    path: formatIssuePath(issue.path),
    code: readDeliveryCode(issue),
    message: issue.message,
  }))
}

function parseWith<TManifest>(schema: z.ZodType<TManifest>, raw: string): ProposalParseResult<TManifest> {
  const text = raw.trim()
  if (text.length === 0) return { ok: false, reason: 'empty' }
  if (text.length > MAX_MANIFEST_BODY_CHARS) {
    return { ok: false, reason: 'too_large', length: text.length, limit: MAX_MANIFEST_BODY_CHARS }
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'not_json' }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ok: false, reason: 'not_object' }
  const parsed = schema.safeParse(value)
  if (!parsed.success) return { ok: false, reason: 'schema', issues: collectIssues(parsed.error) }
  return { ok: true, manifest: parsed.data }
}

export function parseRequirementsProposal(raw: string): ProposalParseResult<RequirementsProposalV1> {
  return parseWith<RequirementsProposalV1>(requirementsProposalV1Schema, raw)
}

export function parsePlanProposal(raw: string): ProposalParseResult<PlanProposalV1> {
  return parseWith<PlanProposalV1>(planProposalV1Schema, raw)
}

export type RequirementsProposalSummary = {
  manifestId: string
  projectId: string
  requirementCount: number
  acceptanceCriteriaCount: number
  questionCount: number
  riskCount: number
  producedByTool: string
}

export function summarizeRequirementsProposal(manifest: RequirementsProposalV1): RequirementsProposalSummary {
  return {
    manifestId: manifest.manifestId,
    projectId: manifest.projectId,
    requirementCount: manifest.requirements.length,
    acceptanceCriteriaCount: manifest.acceptanceCriteria.length,
    questionCount: manifest.questions.length,
    riskCount: manifest.risks.length,
    producedByTool: manifest.producedBy.tool,
  }
}

export type PlanProposalSummary = {
  manifestId: string
  projectId: string
  baselineId: string
  baselineHash: string
  taskCount: number
  declaredTestCount: number
  architectureSummary: string
  producedByTool: string | null
}

export function summarizePlanProposal(manifest: PlanProposalV1): PlanProposalSummary {
  return {
    manifestId: manifest.manifestId,
    projectId: manifest.projectId,
    baselineId: manifest.baselineId,
    baselineHash: manifest.baselineHash,
    taskCount: manifest.tasks.length,
    declaredTestCount: manifest.declaredTests.length,
    architectureSummary: manifest.architectureSummary,
    producedByTool: manifest.producedBy?.tool ?? null,
  }
}

/**
 * The manifest declares which project it was produced for. Sending it to a
 * different project would be refused by the server with `foreign_reference`;
 * catching it here names the mismatch while the operator still has the paste in
 * front of them.
 */
export function manifestTargetsProject(manifestProjectId: string, projectId: string): boolean {
  return manifestProjectId === projectId
}
