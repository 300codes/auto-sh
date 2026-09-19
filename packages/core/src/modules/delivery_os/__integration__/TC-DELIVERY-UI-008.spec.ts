import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { evidenceRecordResponseSchema } from '../api/schemas'
import { deliveryReportResponseSchema, releaseCandidateResponseSchema } from '../lib/reportContracts'
import type { SourceRevision } from '../lib/contracts'
import { cleanupReportFixture, importReportResult, reportProjectVersion, setupReportFixture, type ReportFixtureResources } from './helpers/reportReadiness'

for (const profile of ['react-vite', 'wordpress-theme'] as const) {
  test(`${profile}: explicit integration B survives task C and requires separate consent, verification and release`, async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const resources: ReportFixtureResources = { attachmentIds: [] }
    const revision = (letter: string): SourceRevision => profile === 'react-vite'
      ? { kind: 'git', commitSha: letter.repeat(40) }
      : { kind: 'snapshot', contentHash: letter.repeat(64), externalWorkspaceId: 'ui-06:fixture' }
    try {
      const fixture = await setupReportFixture(request, token, resources, profile)
      const root = `/api/delivery_os/projects/${fixture.projectId}`
      const readReport = async () => {
        const response = await apiRequest(request, 'GET', `${root}/report`, { token })
        expect(response.status()).toBe(200)
        return deliveryReportResponseSchema.parse(await readJsonSafe(response))
      }
      const resultA = await importReportResult(request, token, fixture, revision('a'))
      const evidence = await apiRequest(request, 'POST', `${root}/evidence`, { token, data: {
        kind: 'test', baselineId: fixture.baselineId, sourceRevision: revision('b'),
        payload: { rawReportHash: 'b'.repeat(64), checks: resultA.manifest.checks.map((check) => ({ ...check, sourceRevision: revision('b') })) },
      } })
      expect(evidence.status()).toBe(201)
      const integrationEvidence = evidenceRecordResponseSchema.parse(await readJsonSafe(evidence))
      const nominate = async () => apiRequest(request, 'POST', `${root}/release-candidate`, { token,
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: await reportProjectVersion(request, token, fixture.projectId) },
        data: { baselineId: fixture.baselineId, sourceRevision: revision('b'), evidenceIds: [integrationEvidence.evidenceId] },
      })
      const nominated = await nominate()
      expect(nominated.status()).toBe(201)
      const candidate = releaseCandidateResponseSchema.parse(await readJsonSafe(nominated)).currentCandidate!
      await importReportResult(request, token, fixture, revision('c'))
      const report = await readReport()
      expect(report.revision).toEqual(revision('b'))
      expect(report.currentCandidate?.id).toBe(candidate.id)
      expect(report.gates.publishable.ok).toBe(true)
      const input = {
        baselineId: fixture.baselineId, sourceRevision: revision('b'), verdict: 'approved',
        candidateId: candidate.id, candidateVersion: candidate.version, decisionContextHash: report.decisionContextHash,
      }
      const extraEvidence = await apiRequest(request, 'POST', `${root}/evidence`, { token, data: {
        kind: 'reference_material', baselineId: fixture.baselineId, payload: { title: 'New review context' },
      } })
      expect(extraEvidence.status()).toBe(201)
      const stale = await apiRequest(request, 'POST', `${root}/deploy-decisions`, { token,
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: report.projectUpdatedAt }, data: input,
      })
      expect(stale.status()).toBe(409)
      const fresh = await readReport()
      expect(fresh.projectUpdatedAt).toBe(report.projectUpdatedAt)
      expect(fresh.decisionContextHash).not.toBe(report.decisionContextHash)
      const consent = await apiRequest(request, 'POST', `${root}/deploy-decisions`, { token,
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: fresh.projectUpdatedAt }, data: { ...input, decisionContextHash: fresh.decisionContextHash },
      })
      expect(consent.status()).toBe(201)
      const deploy = async (verified: boolean) => {
        const response = await apiRequest(request, 'POST', `${root}/evidence`, { token, data: {
          kind: 'deployment', baselineId: fixture.baselineId, sourceRevision: revision('b'), payload: {
            url: 'https://example.test/ui-06', environment: 'fixture', buildId: 'integration-b',
            deployedAt: new Date().toISOString(), uploadStatus: 'succeeded',
            verification: verified ? { status: 'verified', checkedAt: new Date().toISOString(), method: 'fixture-http', observedBuildId: 'integration-b' } : null,
          },
        } })
        expect(response.status()).toBe(201)
        return evidenceRecordResponseSchema.parse(await readJsonSafe(response)).evidenceId
      }
      const release = async (deploymentEvidenceId: string) => {
        const current = await readReport()
        return apiRequest(request, 'POST', `${root}/release-decisions`, { token,
          headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: current.projectUpdatedAt }, data: {
            deploymentEvidenceId, verdict: 'approved', candidateId: candidate.id, candidateVersion: candidate.version,
            decisionContextHash: current.decisionContextHash,
          },
        })
      }
      const unverifiedId = await deploy(false)
      expect((await release(unverifiedId)).status()).toBe(422)
      const verifiedId = await deploy(true)
      expect((await release(verifiedId)).status()).toBe(201)
      expect((await readReport()).decisions.some((decision) => decision.kind === 'release' && decision.verdict === 'approved')).toBe(true)
      const renominated = await nominate()
      expect(renominated.status()).toBe(201)
      const replacement = releaseCandidateResponseSchema.parse(await readJsonSafe(renominated)).currentCandidate!
      expect(replacement.version).toBe(candidate.version + 1)
      const replacedReport = await readReport()
      const obsoleteConsent = await apiRequest(request, 'POST', `${root}/release-decisions`, { token,
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: replacedReport.projectUpdatedAt }, data: {
          deploymentEvidenceId: verifiedId, verdict: 'approved', candidateId: replacement.id, candidateVersion: replacement.version,
          decisionContextHash: replacedReport.decisionContextHash,
        },
      })
      expect(obsoleteConsent.status()).toBe(422)
    } finally {
      await cleanupReportFixture(request, token, resources)
    }
  })
}
