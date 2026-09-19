import type { ResultCheck } from '../contracts'
import {
  checkScanEvidence,
  checkTestEvidence,
  deriveDeploymentVerificationStatus,
  hashEvidenceIdentity,
  type TestEvidenceInput,
} from '../evidenceRules'
import { loadBaselineContentFixture, loadResultManifestFixture } from '../fixtures'
import { getTargetProfile, type TargetProfile } from '../targetProfiles'

const BASELINE_ID = '5a5a5a5a-5555-4555-8555-555555555555'
const TASK_ID = '7c7c7c7c-7777-4777-8777-777777777777'
const ATTACHMENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const ATTACHMENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'

function profile(id: string): TargetProfile {
  const found = getTargetProfile(id, 1)
  if (!found) throw new Error('[internal] profile fixture missing')
  return found
}

function testInput(change: (checks: ResultCheck[]) => void = () => undefined, overrides: Partial<TestEvidenceInput> = {}): TestEvidenceInput {
  const manifest = loadResultManifestFixture()
  change(manifest.checks)
  return {
    checks: manifest.checks,
    sourceRevision: manifest.resultRevision,
    content: loadBaselineContentFixture(),
    profile: profile('react-vite'),
    ...overrides,
  }
}

function failure(result: ReturnType<typeof checkTestEvidence>): { status: number; code: string; details: Array<{ path?: string; code: string }> } {
  if (result.ok) throw new Error('[internal] expected a failure')
  return {
    status: result.status,
    code: result.body.code,
    details: result.body.details.map((detail) => ({ path: detail.path, code: detail.code })),
  }
}

describe('hashEvidenceIdentity', () => {
  const identity = { kind: 'scan', baselineId: BASELINE_ID, payload: { checkId: 'dependency-audit', status: 'passed' } }

  it('ignores key order, attachment order and repeated attachment ids', () => {
    const first = hashEvidenceIdentity({ ...identity, attachmentIds: [ATTACHMENT_A, ATTACHMENT_B] })
    const second = hashEvidenceIdentity({
      attachmentIds: [ATTACHMENT_B, ATTACHMENT_A, ATTACHMENT_B],
      payload: { status: 'passed', checkId: 'dependency-audit' },
      baselineId: BASELINE_ID,
      kind: 'scan',
      taskId: undefined,
    })
    expect(first).toMatch(/^[a-f0-9]{64}$/)
    expect(second).toBe(first)
  })

  it('ignores the letter case of ids', () => {
    const lower = hashEvidenceIdentity({ ...identity, taskId: TASK_ID, attachmentIds: [ATTACHMENT_A] })
    const upper = hashEvidenceIdentity({ ...identity, baselineId: BASELINE_ID.toUpperCase(), taskId: TASK_ID.toUpperCase(), attachmentIds: [ATTACHMENT_A.toUpperCase()] })
    expect(upper).toBe(lower)
  })

  it('changes with the kind, baseline, task, attempt, revision, payload and attachments', () => {
    const base = hashEvidenceIdentity(identity)
    const variants = [
      { ...identity, kind: 'reference_material' },
      { ...identity, baselineId: TASK_ID },
      { ...identity, taskId: TASK_ID },
      { ...identity, taskId: TASK_ID, attemptId: BASELINE_ID },
      { ...identity, sourceRevision: { kind: 'git' as const, commitSha: 'a'.repeat(40) } },
      { ...identity, payload: { ...identity.payload, status: 'failed' } },
      { ...identity, attachmentIds: [ATTACHMENT_A] },
    ]
    const hashes = variants.map((variant) => hashEvidenceIdentity(variant))
    expect(new Set([base, ...hashes]).size).toBe(variants.length + 1)
  })

  it('answers null for a payload that is not canonical JSON', () => {
    expect(hashEvidenceIdentity({ ...identity, payload: { value: Number.NaN } })).toBeNull()
  })
})

describe('checkTestEvidence', () => {
  it('accepts the published checks against the whole baseline and against the task', () => {
    expect(checkTestEvidence(testInput())).toEqual({ ok: true })
    expect(checkTestEvidence(testInput(undefined, { taskAcIds: ['AC-001', 'AC-002'] }))).toEqual({ ok: true })
  })

  it('refuses an acceptance criterion that is not in the baseline', () => {
    const result = failure(checkTestEvidence(testInput((checks) => checks[0].acIds.push('AC-999'))))
    expect(result).toEqual({ status: 422, code: 'unknown_ac', details: [{ path: 'payload.checks.0.acIds.1', code: 'unknown_ac' }] })
  })

  it('refuses an acceptance criterion of the baseline that the task does not cover', () => {
    const result = failure(checkTestEvidence(testInput(undefined, { taskAcIds: ['AC-001'] })))
    expect(result.code).toBe('unknown_ac')
    expect(result.details).toEqual([{ path: 'payload.checks.1.acIds.0', code: 'unknown_ac' }])
  })

  it('refuses a test the baseline never declared and a mapping the baseline never froze', () => {
    const renamed = failure(checkTestEvidence(testInput((checks) => {
      checks[0].testId = 'a test the agent invented'
      checks[0].acIds = []
    })))
    expect(renamed).toEqual({ status: 422, code: 'unknown_test_id', details: [{ path: 'payload.checks.0.testId', code: 'unknown_test_id' }] })

    const remapped = failure(checkTestEvidence(testInput((checks) => {
      checks[0].acIds = ['AC-002']
    })))
    expect(remapped).toEqual({ status: 422, code: 'unknown_test_id', details: [{ path: 'payload.checks.0.acIds.0', code: 'test_not_mapped_to_ac' }] })
  })

  it('refuses a check that ran on another revision or profile version', () => {
    const result = failure(checkTestEvidence(testInput((checks) => {
      checks[0].sourceRevision = { kind: 'git', commitSha: 'b'.repeat(40) }
      checks[1].validationProfileVersion = 2
    })))
    expect(result.code).toBe('correlation_mismatch')
    expect(result.details.map((detail) => detail.code)).toEqual(['source_revision_mismatch', 'validation_profile_version_mismatch'])
  })
})

describe('checkScanEvidence', () => {
  it('accepts the scan check of the profile and a scan the profile does not list', () => {
    expect(checkScanEvidence(profile('react-vite'), { checkId: 'dependency-audit' })).toEqual({ ok: true })
    expect(checkScanEvidence(profile('wordpress-theme'), { checkId: 'wpscan' })).toEqual({ ok: true })
  })

  it('refuses a scan that names a build, lint or test check', () => {
    const result = checkScanEvidence(profile('react-vite'), { checkId: 'lint' })
    expect(result).toMatchObject({ ok: false, status: 422, body: { code: 'unknown_test_id', details: [{ path: 'payload.checkId', code: 'check_id_mismatch' }] } })
  })
})

describe('deriveDeploymentVerificationStatus', () => {
  const verified = { status: 'verified' as const, observedBuildId: 'build-42' }

  it.each([
    ['no verification', { buildId: 'build-42', uploadStatus: 'succeeded' as const, verification: null }, 'unverified'],
    ['verified same build', { buildId: 'build-42', uploadStatus: 'succeeded' as const, verification: verified }, 'verified'],
    ['verified another build', { buildId: 'build-41', uploadStatus: 'succeeded' as const, verification: verified }, 'failed'],
    ['verified after a failed upload', { buildId: 'build-42', uploadStatus: 'failed' as const, verification: verified }, 'failed'],
    ['verification failed', { buildId: 'build-42', uploadStatus: 'succeeded' as const, verification: { ...verified, status: 'failed' as const } }, 'failed'],
    ['no build id', { uploadStatus: 'succeeded' as const, verification: verified }, 'failed'],
  ])('%s', (_label, facts, expected) => {
    expect(deriveDeploymentVerificationStatus(facts)).toBe(expected)
  })
})
