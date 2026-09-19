import {
  buildDeliveryError,
  type BaselineContentV1,
  type DeliveryCheckResult,
  type ResultCheck,
  type SourceRevision,
} from './contracts'
import { compareCodeUnits, hashCanonical } from './hash'
import { checkReportedChecks } from './resultChecks'
import type { TargetProfile } from './targetProfiles'

export type EvidenceIdentity = {
  kind: string
  baselineId: string
  taskId?: string | null
  attemptId?: string | null
  sourceRevision?: SourceRevision | null
  payload: unknown
  attachmentIds?: readonly string[]
}

export type TestEvidenceInput = {
  checks: readonly ResultCheck[]
  sourceRevision: SourceRevision
  content: BaselineContentV1
  profile: TargetProfile
  taskAcIds?: readonly string[]
}

export type DeploymentVerificationStatus = 'unverified' | 'verified' | 'failed'

export type DeploymentVerificationFacts = {
  buildId?: string
  uploadStatus: 'succeeded' | 'failed'
  verification: { status: 'verified' | 'failed'; observedBuildId: string } | null
}

const TEST_EVIDENCE_CHECKS_PATH_PREFIX = 'payload.checks.'

export function normalizeAttachmentIds(attachmentIds: readonly string[]): string[] {
  return [...new Set(attachmentIds.map((attachmentId) => attachmentId.toLowerCase()))].sort(compareCodeUnits)
}

export function hashEvidenceIdentity(identity: EvidenceIdentity): string | null {
  try {
    return hashCanonical({
      kind: identity.kind,
      baselineId: identity.baselineId.toLowerCase(),
      taskId: identity.taskId?.toLowerCase() ?? null,
      attemptId: identity.attemptId?.toLowerCase() ?? null,
      sourceRevision: identity.sourceRevision ?? null,
      payload: identity.payload,
      attachmentIds: normalizeAttachmentIds(identity.attachmentIds ?? []),
    })
  } catch {
    return null
  }
}

export function checkTestEvidence(input: TestEvidenceInput): DeliveryCheckResult {
  const { content, profile } = input
  const taskAcIds = input.taskAcIds ? new Set(input.taskAcIds) : null
  const acceptanceCriteriaIds = content.acceptanceCriteria
    .map((criterion) => criterion.id)
    .filter((acId) => taskAcIds === null || taskAcIds.has(acId))
  const coveredAcIds = new Set(acceptanceCriteriaIds)
  const requiredTests = Object.fromEntries(Object.entries(content.acTestMap).filter(([acId]) => coveredAcIds.has(acId)))
  return checkReportedChecks({
    checks: input.checks,
    resultRevision: input.sourceRevision,
    validationProfile: { version: profile.version, requiredTests, checks: profile.checks.map((check) => ({ ...check })) },
    acceptanceCriteriaIds,
    knownTestIds: [
      ...Object.values(requiredTests).flat(),
      ...content.declaredTests.map((test) => test.testId),
      ...profile.testCatalogue.map((test) => test.testId),
    ],
    pathPrefix: TEST_EVIDENCE_CHECKS_PATH_PREFIX,
  })
}

export function checkScanEvidence(profile: TargetProfile, payload: { checkId: string }): DeliveryCheckResult {
  const definition = profile.checks.find((check) => check.checkId === payload.checkId)
  if (!definition || definition.kind === 'scan') return { ok: true }
  return {
    ok: false,
    ...buildDeliveryError('unknown_test_id', 'The scan names a profile check that is not a scan', [
      {
        path: 'payload.checkId',
        code: 'check_id_mismatch',
        message: `${payload.checkId} is a ${definition.kind} check of ${profile.id}@${profile.version}`,
      },
    ]),
  }
}

export function deriveDeploymentVerificationStatus(facts: DeploymentVerificationFacts): DeploymentVerificationStatus {
  if (!facts.verification) return 'unverified'
  const sameBuild = typeof facts.buildId === 'string' && facts.verification.observedBuildId === facts.buildId
  if (facts.verification.status === 'verified' && sameBuild && facts.uploadStatus === 'succeeded') return 'verified'
  return 'failed'
}
