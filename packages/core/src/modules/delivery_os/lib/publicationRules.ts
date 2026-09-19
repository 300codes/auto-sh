import {
  buildDeliveryError,
  deliveryErrorFromZod,
  isSameRevision,
  publicationResultV1Schema,
  publicationVerificationSchema,
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

const DEPLOY_DECISION_PATH = 'deployDecisionId'

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

export function checkPublicationVerification(verification: unknown): DeliveryCheckResult {
  const parsed = publicationVerificationSchema.safeParse(verification)
  if (parsed.success) return { ok: true }
  return { ok: false, ...deliveryErrorFromZod(parsed.error) }
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

export function hashPublicationPayload(publication: PublicationResultV1): string {
  return hashCanonical(publicationResultV1Schema.parse(publication))
}
