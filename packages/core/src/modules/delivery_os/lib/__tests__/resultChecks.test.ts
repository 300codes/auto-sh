import type { ResultCheck } from '../contracts'
import { loadResultManifestFixture, loadTaskPackageFixture } from '../fixtures'
import { checkReportedChecks, mapRunnerStatus, type ReportedChecksInput } from '../resultChecks'

function inputWith(change: (checks: ResultCheck[]) => void = () => undefined, overrides: Partial<ReportedChecksInput> = {}): ReportedChecksInput {
  const taskPackage = loadTaskPackageFixture()
  const manifest = loadResultManifestFixture()
  change(manifest.checks)
  return {
    checks: manifest.checks,
    resultRevision: manifest.resultRevision,
    validationProfile: taskPackage.validationProfile,
    acceptanceCriteriaIds: taskPackage.acceptanceCriteria.map((criterion) => criterion.id),
    knownTestIds: Object.values(taskPackage.validationProfile.requiredTests).flat(),
    ...overrides,
  }
}

function failure(input: ReportedChecksInput): { status: number; code: string; details: Array<{ path?: string; code: string }> } {
  const result = checkReportedChecks(input)
  if (result.ok) throw new Error('[internal] expected a failure')
  return {
    status: result.status,
    code: result.body.code,
    details: result.body.details.map((detail) => ({ path: detail.path, code: detail.code })),
  }
}

describe('mapRunnerStatus', () => {
  it.each([
    ['passed', 'passed'],
    ['failed', 'failed'],
    ['skipped', 'not_run'],
    ['todo', 'not_run'],
    ['pending', 'not_run'],
    ['PASSED', 'not_run'],
    ['', 'not_run'],
  ])('maps %s to %s', (runnerStatus, expected) => {
    expect(mapRunnerStatus(runnerStatus)).toBe(expected)
  })
})

describe('checkReportedChecks', () => {
  it('passes the published checks and an empty list', () => {
    expect(checkReportedChecks(inputWith())).toEqual({ ok: true })
    expect(checkReportedChecks(inputWith((checks) => checks.splice(0)))).toEqual({ ok: true })
  })

  it('knows a test id only through the frozen catalogue', () => {
    const rename = (checks: ResultCheck[]) => {
      checks[0].testId = 'new test the agent wrote'
      checks[0].acIds = []
    }
    expect(failure(inputWith(rename))).toEqual({
      status: 422,
      code: 'unknown_test_id',
      details: [{ path: 'checks.0.testId', code: 'unknown_test_id' }],
    })
    const declared = inputWith(rename)
    expect(checkReportedChecks({ ...declared, knownTestIds: [...declared.knownTestIds, 'new test the agent wrote'] })).toEqual({ ok: true })
  })

  it('rejects a known test that claims a criterion it is not mapped to', () => {
    const result = failure(inputWith((checks) => {
      checks[0].acIds = ['AC-001', 'AC-002']
    }))
    expect(result.code).toBe('unknown_test_id')
    expect(result.details).toEqual([{ path: 'checks.0.acIds.1', code: 'test_not_mapped_to_ac' }])
  })

  it('rejects a criterion outside the task and ranks it above the other failures', () => {
    const result = failure(inputWith((checks) => {
      checks[0].acIds = ['AC-999']
      checks[1].testId = 'unknown'
      checks[2].validationProfileVersion = 9
    }))
    expect(result.code).toBe('unknown_ac')
    expect(result.details.map((detail) => detail.code)).toEqual([
      'unknown_ac',
      'unknown_test_id',
      'test_not_mapped_to_ac',
      'validation_profile_version_mismatch',
    ])
  })

  it('binds a non-test check to the profile check of its command profile', () => {
    expect(failure(inputWith((checks) => {
      checks[2].testId = 'lint'
    })).details).toEqual([{ path: 'checks.2.testId', code: 'check_id_mismatch' }])
    expect(failure(inputWith((checks) => {
      checks[2].commandProfileId = 'curl-pipe-sh'
    })).details).toEqual([{ path: 'checks.2.commandProfileId', code: 'unknown_command_profile' }])
  })

  it('answers correlation_mismatch for another profile version or another revision', () => {
    const version = failure(inputWith((checks) => {
      checks[3].validationProfileVersion = 2
    }))
    expect(version).toEqual({
      status: 422,
      code: 'correlation_mismatch',
      details: [{ path: 'checks.3.validationProfileVersion', code: 'validation_profile_version_mismatch' }],
    })
    const revision = failure(inputWith((checks) => {
      checks[4].sourceRevision = { kind: 'git', commitSha: 'f'.repeat(40) }
    }))
    expect(revision.code).toBe('correlation_mismatch')
    expect(revision.details).toEqual([{ path: 'checks.4.sourceRevision', code: 'source_revision_mismatch' }])
  })

  it('answers test_not_mapped_to_ac for a criterion named like an Object.prototype key', () => {
    const base = inputWith((checks) => {
      checks[0].acIds = ['constructor']
    })
    const result = failure({ ...base, acceptanceCriteriaIds: [...base.acceptanceCriteriaIds, 'constructor'] })
    expect(result.details).toEqual([{ path: 'checks.0.acIds.0', code: 'test_not_mapped_to_ac' }])
  })

  it('resolves a profile check by its checkId when a test check shares the command profile', () => {
    const base = inputWith((checks) => {
      checks[3].commandProfileId = 'vitest-report'
    })
    const shared = {
      ...base.validationProfile,
      checks: base.validationProfile.checks.map((definition) =>
        definition.checkId === 'lint' ? { ...definition, commandProfileId: 'vitest-report' } : definition,
      ),
    }
    expect(checkReportedChecks({ ...base, validationProfile: shared })).toEqual({ ok: true })
  })

  it('uses the given path prefix', () => {
    const result = failure(inputWith((checks) => { checks[0].acIds = ['AC-999'] }, { pathPrefix: 'payload.checks.' }))
    expect(result.details[0].path).toBe('payload.checks.0.acIds.0')
  })
})
