import { deploymentEvidencePayloadSchema, recordEvidenceSchema } from '../../data/validators'
import type { PublicationResultV1, SourceRevision } from '../contracts'
import { isVerifiedDeploymentPayload } from '../deliveryReport'
import { deriveDeploymentVerificationStatus } from '../evidenceRules'
import { loadNegativeFlowFixtures, loadPublicationResultFixture } from '../fixtures/flow/index'
import { hashCanonical } from '../hash'
import {
  buildDeploymentEvidencePayload,
  checkPublicationDeployConsent,
  checkPublicationVerification,
  hashPublicationPayload,
  publicationBuildId,
  type PublicationDeployConsentInput,
  type PublicationDeployDecision,
} from '../publicationRules'

const BASELINE_HASH = 'a'.repeat(64)
const OTHER_ID = '99999999-9999-4999-8999-999999999999'
const FIXTURE_CONTENT_HASH = '8'.repeat(64)
const GIT_REVISION: SourceRevision = { kind: 'git', commitSha: 'b'.repeat(40) }

function consentInput(overrides: Partial<PublicationDeployDecision> = {}, decisionOverride?: null): PublicationDeployConsentInput {
  const publication = loadPublicationResultFixture()
  const decision: PublicationDeployDecision = {
    id: publication.deployDecisionId,
    projectId: publication.projectId,
    kind: 'deploy',
    subjectId: publication.baselineId,
    subjectHash: BASELINE_HASH,
    sourceRevision: publication.sourceRevision,
    verdict: 'approved',
    ...overrides,
  }
  return {
    decision: decisionOverride === null ? null : decision,
    projectId: publication.projectId,
    baselineId: publication.baselineId,
    baselineContentHash: BASELINE_HASH,
    sourceRevision: publication.sourceRevision,
  }
}

function failure(result: ReturnType<typeof checkPublicationDeployConsent>) {
  if (result.ok) throw new Error('[internal] expected a failed check')
  return { status: result.status, code: result.body.code, detail: result.body.details[0]?.code }
}

function unverified(publication: PublicationResultV1): PublicationResultV1 {
  return {
    ...publication,
    verification: { status: 'unverified', method: null, checkedAt: null, httpStatus: null, evidenceId: null },
  }
}

function derivedStatus(publication: PublicationResultV1) {
  const payload = deploymentEvidencePayloadSchema.parse(buildDeploymentEvidencePayload(publication))
  return deriveDeploymentVerificationStatus({
    buildId: payload.buildId,
    uploadStatus: payload.uploadStatus,
    verification: payload.verification,
  })
}

describe('checkPublicationDeployConsent', () => {
  it('accepts an approved deploy decision for the same project, baseline and revision', () => {
    expect(checkPublicationDeployConsent(consentInput())).toEqual({ ok: true })
  })

  it.each([
    ['no decision', consentInput({}, null)],
    ['another kind', consentInput({ kind: 'release' })],
    ['another project', consentInput({ projectId: OTHER_ID })],
    ['another baseline id', consentInput({ subjectId: OTHER_ID })],
    ['another baseline hash', consentInput({ subjectHash: 'c'.repeat(64) })],
  ])('refuses %s with 422 deploy_decision_missing', (_label, input) => {
    expect(failure(checkPublicationDeployConsent(input))).toEqual({
      status: 422,
      code: 'deploy_decision_missing',
      detail: 'deploy_decision_missing',
    })
  })

  it.each([
    ['another revision', consentInput({ sourceRevision: GIT_REVISION })],
    ['an unreadable revision', consentInput({ sourceRevision: null })],
    ['a reject bound to another revision', consentInput({ sourceRevision: GIT_REVISION, verdict: 'rejected' })],
  ])('refuses %s with 422 revision_mismatch', (_label, input) => {
    expect(failure(checkPublicationDeployConsent(input))).toEqual({
      status: 422,
      code: 'revision_mismatch',
      detail: 'deploy_revision_mismatch',
    })
  })

  it('refuses a rejected decision on the same revision with detail deploy_decision_rejected', () => {
    expect(failure(checkPublicationDeployConsent(consentInput({ verdict: 'rejected' })))).toEqual({
      status: 422,
      code: 'deploy_decision_missing',
      detail: 'deploy_decision_rejected',
    })
  })
})

describe('checkPublicationVerification', () => {
  it('accepts the verified fixture and an unverified record', () => {
    const publication = loadPublicationResultFixture()
    expect(checkPublicationVerification(publication.verification)).toEqual({ ok: true })
    expect(checkPublicationVerification(unverified(publication).verification)).toEqual({ ok: true })
  })

  it('refuses the negative fixture (verified without evidence) with 422 deployment_unverified', () => {
    const negative = loadNegativeFlowFixtures().find((fixture) => fixture.name === 'publication-result.verified-without-evidence')
    const document = negative?.document as { verification: unknown }
    const result = checkPublicationVerification(document.verification)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(422)
      expect(result.body.code).toBe('deployment_unverified')
    }
  })

  it.each(['method', 'checkedAt', 'evidenceId'])('refuses verified without %s', (field) => {
    const verification = { ...loadPublicationResultFixture().verification, [field]: null }
    const result = checkPublicationVerification(verification)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.body.code).toBe('deployment_unverified')
  })
})

describe('buildDeploymentEvidencePayload', () => {
  it('derives a verified v1 deployment payload from a verified publication', () => {
    const publication = loadPublicationResultFixture()
    const payload = deploymentEvidencePayloadSchema.parse(buildDeploymentEvidencePayload(publication))
    expect(payload).toEqual({
      url: 'https://preview.example.com/psi-fryzjer',
      environment: 'preview',
      buildId: FIXTURE_CONTENT_HASH,
      deployedAt: '2026-09-19T12:00:00.000Z',
      uploadStatus: 'succeeded',
      verification: {
        status: 'verified',
        checkedAt: '2026-09-19T12:01:00.000Z',
        method: 'http',
        observedBuildId: FIXTURE_CONTENT_HASH,
      },
    })
    expect(derivedStatus(publication)).toBe('verified')
    expect(isVerifiedDeploymentPayload(payload)).toBe(true)
  })

  it('passes the v1 deployment evidence command schema for verified and unverified publications', () => {
    for (const publication of [loadPublicationResultFixture(), unverified(loadPublicationResultFixture())]) {
      const parsed = recordEvidenceSchema.safeParse({
        kind: 'deployment',
        baselineId: publication.baselineId,
        sourceRevision: publication.sourceRevision,
        payload: buildDeploymentEvidencePayload(publication),
      })
      expect(parsed.success).toBe(true)
    }
  })

  it('uses the commit sha as build id for a git revision', () => {
    const publication = { ...loadPublicationResultFixture(), sourceRevision: GIT_REVISION }
    expect(publicationBuildId(GIT_REVISION)).toBe('b'.repeat(40))
    expect(buildDeploymentEvidencePayload(publication).buildId).toBe('b'.repeat(40))
    expect(derivedStatus(publication)).toBe('verified')
  })

  it('maps an unverified publication to unverified, never verified', () => {
    const publication = unverified(loadPublicationResultFixture())
    expect(buildDeploymentEvidencePayload(publication).verification).toBeNull()
    expect(derivedStatus(publication)).toBe('unverified')
    expect(isVerifiedDeploymentPayload(buildDeploymentEvidencePayload(publication))).toBe(false)
  })

  it('fails closed for a verified status whose proof fields were bypassed', () => {
    const publication = loadPublicationResultFixture()
    const forged = { ...publication, verification: { ...publication.verification, evidenceId: null } }
    expect(derivedStatus(forged)).toBe('unverified')
  })
})

describe('hashPublicationPayload', () => {
  it('hashes the parsed document canonically and ignores unknown keys', () => {
    const publication = loadPublicationResultFixture()
    const hash = hashPublicationPayload(publication)
    expect(hash).toBe(hashCanonical(publication))
    expect(hashPublicationPayload({ ...publication, forged: true } as PublicationResultV1)).toBe(hash)
  })

  it('changes when the published revision or verification changes', () => {
    const publication = loadPublicationResultFixture()
    const hash = hashPublicationPayload(publication)
    expect(hashPublicationPayload({ ...publication, sourceRevision: GIT_REVISION })).not.toBe(hash)
    expect(hashPublicationPayload(unverified(publication))).not.toBe(hash)
  })
})
