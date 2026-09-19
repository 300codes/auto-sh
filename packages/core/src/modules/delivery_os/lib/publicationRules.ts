import {
  buildDeliveryError,
  isSameRevision,
  publicationResultV1Schema,
  sourceRevisionSchema,
  type DeliveryCheckResult,
  type PublicationResultV1,
  type SourceRevision,
} from './contracts'
import { hashCanonical } from './hash'

export type PublicationDeployDecision = {
  id: string
  projectId: string
  kind: string
  subjectId: string
  subjectHash: string
  sourceRevision?: unknown
  verdict: string
}

export type PublicationDeployConsentInput = {
  decision: PublicationDeployDecision | null
  projectId: string
  baselineId: string
  baselineContentHash: string
  sourceRevision: SourceRevision
}

export type PublicationDeploymentEvidencePayload = {
  url: string
  environment: string
  buildId: string
  deployedAt: string
  uploadStatus: 'succeeded'
  verification: { status: 'verified'; checkedAt: string; method: string; observedBuildId: string } | null
}

export type PublicationVerificationEvidence = { kind: string; payload: unknown }

export const VERIFICATION_EVIDENCE_KINDS = ['test', 'screenshot', 'scan', 'review'] as const

const DEPLOY_DECISION_PATH = 'deployDecisionId'
const VERIFICATION_EVIDENCE_PATH = 'verification.evidenceId'

function formatRevision(revision: SourceRevision): string {
  return revision.kind === 'git' ? `git:${revision.commitSha}` : `snapshot:${revision.contentHash}:${revision.externalWorkspaceId}`
}

function deployDecisionMissing(message: string): DeliveryCheckResult {
  return {
    ok: false,
    ...buildDeliveryError('deploy_decision_missing', 'No approved publish consent covers this publication', [
      { path: DEPLOY_DECISION_PATH, code: 'deploy_decision_missing', message },
    ]),
  }
}

export function checkPublicationDeployConsent(input: PublicationDeployConsentInput): DeliveryCheckResult {
  const { decision } = input
  if (!decision) return deployDecisionMissing('The named deploy decision does not exist in this scope')
  if (decision.kind !== 'deploy') return deployDecisionMissing(`Decision ${decision.id} is not a deploy decision`)
  if (decision.projectId !== input.projectId) return deployDecisionMissing(`Decision ${decision.id} belongs to another project`)
  if (decision.subjectId !== input.baselineId || decision.subjectHash !== input.baselineContentHash) {
    return deployDecisionMissing(`Decision ${decision.id} was given for another baseline`)
  }
  const decided = sourceRevisionSchema.safeParse(decision.sourceRevision)
  if (!decided.success || !isSameRevision(decided.data, input.sourceRevision)) {
    const named = decided.success ? formatRevision(decided.data) : 'no readable revision'
    return {
      ok: false,
      ...buildDeliveryError('revision_mismatch', 'Publish consent was given for another revision', [
        {
          path: DEPLOY_DECISION_PATH,
          code: 'deploy_revision_mismatch',
          message: `Published ${formatRevision(input.sourceRevision)}, publish consent names ${named}`,
        },
      ]),
    }
  }
  if (decision.verdict !== 'approved') {
    return {
      ok: false,
      ...buildDeliveryError('deploy_decision_missing', 'The named publish consent is a reject', [
        { path: DEPLOY_DECISION_PATH, code: 'deploy_decision_rejected', message: `Deploy decision ${decision.id} rejected this revision` },
      ]),
    }
  }
  return { ok: true }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyPassedChecks(payload: Record<string, unknown>): boolean {
  const { checks } = payload
  if (!Array.isArray(checks) || checks.length === 0) return false
  return checks.every((check) => isPlainRecord(check) && check.status === 'passed')
}

function verificationEvidenceFailure(kind: string, payload: unknown): string | null {
  if (kind === 'screenshot') return null
  const record = isPlainRecord(payload) ? payload : {}
  if (kind === 'scan') return record.status === 'passed' ? null : 'The scan evidence did not pass'
  if (kind === 'review') return record.verdict === 'approved' ? null : 'The review evidence is not an approval'
  return hasOnlyPassedChecks(record) ? null : 'The test evidence holds a check that did not pass'
}

export function checkVerificationEvidenceKind(evidence: PublicationVerificationEvidence): DeliveryCheckResult {
  const allowed: readonly string[] = VERIFICATION_EVIDENCE_KINDS
  if (!allowed.includes(evidence.kind)) {
    return {
      ok: false,
      ...buildDeliveryError('unsupported_evidence_kind', 'This evidence kind cannot verify a publication', [
        {
          path: VERIFICATION_EVIDENCE_PATH,
          code: 'verification_evidence_kind',
          message: `Evidence kind ${evidence.kind} cannot verify a publication; allowed kinds: ${VERIFICATION_EVIDENCE_KINDS.join(', ')}`,
        },
      ]),
    }
  }
  const failure = verificationEvidenceFailure(evidence.kind, evidence.payload)
  if (failure === null) return { ok: true }
  return {
    ok: false,
    ...buildDeliveryError('unsupported_evidence_kind', 'The verification evidence did not pass', [
      { path: VERIFICATION_EVIDENCE_PATH, code: 'verification_evidence_not_passed', message: failure },
    ]),
  }
}

export function publicationBuildId(revision: SourceRevision): string {
  return revision.kind === 'git' ? revision.commitSha : revision.contentHash
}

export function buildDeploymentEvidencePayload(publication: PublicationResultV1): PublicationDeploymentEvidencePayload {
  const buildId = publicationBuildId(publication.sourceRevision)
  const { status, method, checkedAt, evidenceId } = publication.verification
  const verification =
    status === 'verified' && method !== null && checkedAt !== null && evidenceId !== null
      ? { status: 'verified' as const, checkedAt, method, observedBuildId: buildId }
      : null
  return {
    url: publication.url,
    environment: publication.target.environment,
    buildId,
    deployedAt: publication.publishedAt,
    uploadStatus: 'succeeded',
    verification,
  }
}

function canonicalTimestamp(value: string): string {
  return new Date(value).toISOString()
}

/** Identifier case and timestamp spelling never make a replay a second publication; the stored row keeps the sent values. */
function normalizePublicationForHash(publication: PublicationResultV1): PublicationResultV1 {
  const { snapshotRef, verification } = publication
  return {
    ...publication,
    projectId: publication.projectId.toLowerCase(),
    baselineId: publication.baselineId.toLowerCase(),
    deployDecisionId: publication.deployDecisionId.toLowerCase(),
    releaseDecisionId: publication.releaseDecisionId === null ? null : publication.releaseDecisionId.toLowerCase(),
    publishedBy: publication.publishedBy === null ? null : publication.publishedBy.toLowerCase(),
    publishedAt: canonicalTimestamp(publication.publishedAt),
    snapshotRef: snapshotRef === null ? null : { ...snapshotRef, attachmentId: snapshotRef.attachmentId.toLowerCase() },
    verification: {
      ...verification,
      checkedAt: verification.checkedAt === null ? null : canonicalTimestamp(verification.checkedAt),
      evidenceId: verification.evidenceId === null ? null : verification.evidenceId.toLowerCase(),
    },
  }
}

export function hashPublicationPayload(publication: PublicationResultV1): string {
  return hashCanonical(normalizePublicationForHash(publicationResultV1Schema.parse(publication)))
}
