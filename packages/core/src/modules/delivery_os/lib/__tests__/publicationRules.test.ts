import { deploymentEvidencePayloadSchema, recordEvidenceSchema } from '../../data/validators'
import type { PublicationResultV1, SourceRevision } from '../contracts'
import { isVerifiedDeploymentPayload } from '../deliveryReport'
import { deriveDeploymentVerificationStatus } from '../evidenceRules'
import { loadPublicationResultFixture } from '../fixtures/flow/index'
import { hashCanonical } from '../hash'
import {
  buildDeploymentEvidencePayload,
  checkPublicationDeployConsent,
  checkVerificationEvidenceKind,
  hashPublicationPayload,
  publicationBuildId,
  VERIFICATION_EVIDENCE_KINDS,
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

describe('checkVerificationEvidenceKind', () => {
  const passedCheck = { checkId: 'unit-tests', testId: 'T-001', status: 'passed' }

  function evidenceFailure(result: ReturnType<typeof checkVerificationEvidenceKind>) {
    if (result.ok) throw new Error('[internal] expected a failed check')
    return { status: result.status, code: result.body.code, details: result.body.details }
  }

  it.each([
    ['test', { checks: [passedCheck, passedCheck] }],
    ['screenshot', {}],
    ['screenshot', null],
    ['scan', { status: 'passed' }],
    ['review', { verdict: 'approved' }],
  ])('accepts a passing %s evidence', (kind, payload) => {
    expect(checkVerificationEvidenceKind({ kind, payload })).toEqual({ ok: true })
  })

  it('names exactly the four check kinds as allowed', () => {
    expect([...VERIFICATION_EVIDENCE_KINDS]).toEqual(['test', 'screenshot', 'scan', 'review'])
  })

  it.each(['deployment', 'reference_material', 'result_manifest', 'something_else'])(
    'refuses kind %s with 422 unsupported_evidence_kind on verification.evidenceId',
    (kind) => {
      const refusal = evidenceFailure(checkVerificationEvidenceKind({ kind, payload: { status: 'passed', verdict: 'approved' } }))
      expect(refusal).toMatchObject({ status: 422, code: 'unsupported_evidence_kind' })
      expect(refusal.details).toHaveLength(1)
      expect(refusal.details[0]).toMatchObject({ path: 'verification.evidenceId', code: 'verification_evidence_kind' })
      expect(refusal.details[0].message).toContain(kind)
      expect(refusal.details[0].message).toContain('test, screenshot, scan, review')
    },
  )

  it.each([
    ['a failed scan', 'scan', { status: 'failed' }],
    ['a scan without a status', 'scan', {}],
    ['a scan with an unreadable payload', 'scan', null],
    ['a review requesting changes', 'review', { verdict: 'changes_requested' }],
    ['a review without a verdict', 'review', []],
    ['a test with one failed check', 'test', { checks: [passedCheck, { ...passedCheck, status: 'failed' }] }],
    ['a test with an unreadable check', 'test', { checks: [passedCheck, 'passed'] }],
    ['a test without checks', 'test', { checks: [] }],
    ['a test with an unreadable payload', 'test', 'passed'],
  ])('refuses %s with detail verification_evidence_not_passed', (_label, kind, payload) => {
    const refusal = evidenceFailure(checkVerificationEvidenceKind({ kind, payload }))
    expect(refusal).toMatchObject({ status: 422, code: 'unsupported_evidence_kind' })
    expect(refusal.details).toEqual([
      { path: 'verification.evidenceId', code: 'verification_evidence_not_passed', message: expect.any(String) },
    ])
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

  it('hashes uppercase identifiers like their lowercase form', () => {
    const publication = loadPublicationResultFixture()
    const snapshotRef = publication.snapshotRef
    if (snapshotRef === null) throw new Error('[internal] the fixture must carry a snapshotRef')
    const releaseDecisionId = '77777777-7777-4777-8777-77777777777a'
    const lower: PublicationResultV1 = { ...publication, releaseDecisionId }
    const upper: PublicationResultV1 = {
      ...publication,
      projectId: publication.projectId.toUpperCase(),
      baselineId: publication.baselineId.toUpperCase(),
      deployDecisionId: publication.deployDecisionId.toUpperCase(),
      releaseDecisionId: releaseDecisionId.toUpperCase(),
      publishedBy: publication.publishedBy?.toUpperCase() ?? null,
      snapshotRef: { ...snapshotRef, attachmentId: snapshotRef.attachmentId.toUpperCase() },
      verification: { ...publication.verification, evidenceId: publication.verification.evidenceId?.toUpperCase() ?? null },
    }
    expect(upper.deployDecisionId).not.toBe(lower.deployDecisionId)
    expect(hashPublicationPayload(upper)).toBe(hashPublicationPayload(lower))
  })

  it.each([
    ['without milliseconds', '2026-09-19T12:00:00Z', '2026-09-19T12:01:00Z'],
    ['with a zero offset', '2026-09-19T12:00:00.000+00:00', '2026-09-19T12:01:00.000+00:00'],
    ['with another offset', '2026-09-19T14:00:00+02:00', '2026-09-19T14:01:00+02:00'],
  ])('hashes the same instant written %s like the canonical form', (_label, publishedAt, checkedAt) => {
    const publication = loadPublicationResultFixture()
    const variant = { ...publication, publishedAt, verification: { ...publication.verification, checkedAt } }
    expect(hashPublicationPayload(variant)).toBe(hashPublicationPayload(publication))
  })

  it('still tells two different instants apart and keeps unverified nulls', () => {
    const publication = loadPublicationResultFixture()
    expect(hashPublicationPayload({ ...publication, publishedAt: '2026-09-19T12:00:00.001Z' })).not.toBe(hashPublicationPayload(publication))
    expect(hashPublicationPayload(unverified(publication))).toBe(hashCanonical(unverified(publication)))
  })
})
