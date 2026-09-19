import { publicationResultV1Schema, type SourceRevision } from '../contracts'
import { createFakeDeployAdapter, FAKE_DEPLOY_EPOCH, type FakeDeployInput } from '../fixtures/flow/fakes'

const REVISION: SourceRevision = { kind: 'snapshot', contentHash: '8'.repeat(64), externalWorkspaceId: 'wp-local-1' }
const EVIDENCE_ID = '99999999-9999-4999-8999-999999999999'

function input(overrides: Partial<FakeDeployInput> = {}): FakeDeployInput {
  return {
    projectId: '11111111-1111-4111-8111-111111111111',
    baselineId: '66666666-6666-4666-8666-666666666666',
    sourceRevision: REVISION,
    deployDecisionId: 'ddddddd9-dddd-4ddd-8ddd-ddddddddddd9',
    target: { kind: 'wordpress', environment: 'preview', ref: 'psi-fryzjer-preview' },
    verified: false,
    ...overrides,
  }
}

function issueCodes(value: unknown): string[] {
  const parsed = publicationResultV1Schema.safeParse(value)
  if (parsed.success) return []
  return parsed.error.issues.map((issue) => String((issue as { params?: { deliveryCode?: string } }).params?.deliveryCode ?? issue.code))
}

describe('createFakeDeployAdapter', () => {
  it('publishes an unverified result with null verification fields that parses as PublicationResult v1', () => {
    const result = createFakeDeployAdapter().publish(input())
    expect(publicationResultV1Schema.safeParse(result).success).toBe(true)
    expect(result.verification).toEqual({ status: 'unverified', method: null, checkedAt: null, httpStatus: null, evidenceId: null })
    expect(result.publishedAt).toBe(new Date(FAKE_DEPLOY_EPOCH).toISOString())
    expect(result.url).toBe('https://preview.example.test/psi-fryzjer-preview')
  })

  it('publishes a verified result only when the URL-check evidence is named', () => {
    const adapter = createFakeDeployAdapter()
    const verified = adapter.publish(input({ verified: true, evidenceId: EVIDENCE_ID }))
    expect(publicationResultV1Schema.safeParse(verified).success).toBe(true)
    expect(verified.verification).toMatchObject({ status: 'verified', method: 'http', httpStatus: 200, evidenceId: EVIDENCE_ID })
    expect(Date.parse(verified.verification.checkedAt ?? '')).toBeGreaterThan(Date.parse(verified.publishedAt))

    const withoutEvidence = adapter.publish(input({ verified: true }))
    expect(withoutEvidence.verification.status).toBe('unverified')
    expect(adapter.calls).toHaveLength(2)
  })

  it('is rejected by the schema when a verified result lacks the evidence id', () => {
    const verified = createFakeDeployAdapter().publish(input({ verified: true, evidenceId: EVIDENCE_ID }))
    const forged = { ...verified, verification: { ...verified.verification, evidenceId: null } }
    expect(issueCodes(forged)).toContain('deployment_unverified')
  })

  it('is deterministic: the same call sequence yields identical documents and a one-minute publishedAt sequence', () => {
    const first = createFakeDeployAdapter()
    const second = createFakeDeployAdapter()
    const run = (adapter: ReturnType<typeof createFakeDeployAdapter>) => [
      adapter.publish(input()),
      adapter.publish(input({ verified: true, evidenceId: EVIDENCE_ID })),
    ]
    const results = run(first)
    expect(run(second)).toEqual(results)
    expect(results.map((result) => result.publishedAt)).toEqual([
      new Date(FAKE_DEPLOY_EPOCH).toISOString(),
      new Date(FAKE_DEPLOY_EPOCH + 60_000).toISOString(),
    ])
  })
})
