import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  DELIVERY_SCHEMA_VERSIONS,
  buildDeliveryError,
  buildPackageUrl,
  deliveryDocumentSchemas,
  deliveryErrorCodes,
  deliveryErrorFromZod,
  parseVersioned,
  reserveAttemptRequestSchema,
  reserveAttemptResponseSchema,
  resultManifestV1Schema,
  type DeliveryCheckResult,
  type PlanProposalV1,
  type ResultManifestV1,
  type SourceRevision,
} from '../contracts'
import { hashCanonical } from '../hash'
import { checkAcyclic } from '../dag'
import { checkResultCorrelation } from '../resultAcceptance'
import { assertRevisionKind, checkAllowedPathsForProfile, getTargetProfile, type TargetProfile } from '../targetProfiles'
import {
  buildExecutionWidgetContextFixture,
  buildResultManifest,
  loadBaselineContentFixture,
  loadErrorBodyFixture,
  loadNegativeDeliveryFixtures,
  loadPlanProposalFixture,
  loadReserveResponseFixture,
  loadResultManifestFixture,
  loadTaskPackageFixture,
  positiveDeliveryFixtures,
  type NegativeDeliveryFixture,
} from '../fixtures'

const fixturesDir = join(__dirname, '..', 'fixtures')
const taskPackages = {
  'task-package': loadTaskPackageFixture('git'),
  'task-package.snapshot': loadTaskPackageFixture('snapshot'),
}

function requireProfile(id: string, version: number): TargetProfile {
  const profile = getTargetProfile(id, version)
  if (!profile) throw new Error(`[internal] unknown profile ${id}@${version}`)
  return profile
}

function toCheckResult(parsed: { success: true } | { success: false; error: Parameters<typeof deliveryErrorFromZod>[0] }): DeliveryCheckResult {
  return parsed.success ? { ok: true } : { ok: false, ...deliveryErrorFromZod(parsed.error) }
}

function runSchemaStage(fixture: NegativeDeliveryFixture): { result: DeliveryCheckResult; data: unknown } {
  if (fixture.documentType === 'reserve-request') {
    const parsed = reserveAttemptRequestSchema.safeParse(fixture.document)
    return { result: toCheckResult(parsed), data: parsed.data }
  }
  if (fixture.documentType === 'reserve-pair') {
    const pair = fixture.document as { first: unknown; second: unknown }
    const first = reserveAttemptRequestSchema.safeParse(pair.first)
    const second = reserveAttemptRequestSchema.safeParse(pair.second)
    const failed = [first, second].find((parsed) => !parsed.success)
    return { result: failed ? toCheckResult(failed) : { ok: true }, data: fixture.document }
  }
  const parsed = parseVersioned(deliveryDocumentSchemas, fixture.document)
  if (!parsed.ok) return { result: parsed, data: undefined }
  return { result: { ok: true }, data: parsed.data }
}

function runProfileStage(profile: TargetProfile, document: unknown, schemaVersion: string): DeliveryCheckResult {
  if (schemaVersion === DELIVERY_SCHEMA_VERSIONS.resultManifest) {
    const manifest = document as ResultManifestV1
    const baseCheck = assertRevisionKind(profile, manifest.baseRevision)
    return baseCheck.ok ? assertRevisionKind(profile, manifest.resultRevision) : baseCheck
  }
  if (schemaVersion === DELIVERY_SCHEMA_VERSIONS.planProposal) {
    const proposal = document as PlanProposalV1
    return checkAllowedPathsForProfile(profile, proposal.tasks.flatMap((task) => task.allowedPaths))
  }
  throw new Error(`[internal] no profile stage for ${schemaVersion}`)
}

function runDagStage(proposal: PlanProposalV1): DeliveryCheckResult {
  return checkAcyclic(proposal.tasks.map((task) => ({ key: task.proposalTaskKey, dependsOn: task.dependsOn })))
}

function runIdempotencyStage(pair: { idempotencyKey: string; first: unknown; second: unknown }): DeliveryCheckResult {
  const firstHash = hashCanonical(reserveAttemptRequestSchema.parse(pair.first))
  const secondHash = hashCanonical(reserveAttemptRequestSchema.parse(pair.second))
  if (firstHash === secondHash) return { ok: true }
  return { ok: false, ...buildDeliveryError('idempotency_conflict', 'Idempotency key reused with a different payload') }
}

function runLabelledStage(fixture: NegativeDeliveryFixture, data: unknown): DeliveryCheckResult {
  const schemaVersion = (data as { schemaVersion?: string } | undefined)?.schemaVersion ?? ''
  switch (fixture.expected.stage) {
    case 'correlation': {
      if (!fixture.correlatesWith) throw new Error('[internal] correlation fixture without correlatesWith')
      return checkResultCorrelation(taskPackages[fixture.correlatesWith], data as ResultManifestV1)
    }
    case 'profile': {
      if (!fixture.targetProfile) throw new Error('[internal] profile fixture without targetProfile')
      return runProfileStage(requireProfile(fixture.targetProfile.id, fixture.targetProfile.version), data, schemaVersion)
    }
    case 'dag':
      return runDagStage(data as PlanProposalV1)
    case 'idempotency':
      return runIdempotencyStage(data as { idempotencyKey: string; first: unknown; second: unknown })
    default:
      throw new Error(`[internal] unexpected stage ${fixture.expected.stage}`)
  }
}

describe('positive delivery fixtures', () => {
  it.each(positiveDeliveryFixtures.map((fixture) => [fixture.name, fixture] as const))(
    '%s parses with its published schema',
    (_name, fixture) => {
      const document = fixture.name === 'execution-widget-context' ? buildExecutionWidgetContextFixture() : fixture.document
      expect(fixture.schema.safeParse(document).success).toBe(true)
    },
  )

  it('versioned fixtures also pass parseVersioned dispatch', () => {
    for (const fixture of positiveDeliveryFixtures) {
      const schemaVersion = (fixture.document as { schemaVersion?: string }).schemaVersion
      if (!schemaVersion || !(schemaVersion in deliveryDocumentSchemas)) continue
      const parsed = parseVersioned(deliveryDocumentSchemas, fixture.document)
      expect(parsed.ok).toBe(true)
      if (parsed.ok) expect(parsed.schemaVersion).toBe(schemaVersion)
    }
  })

  it('is one coherent scenario: package pins the baseline hash and correlates with its manifest', () => {
    const taskPackage = loadTaskPackageFixture()
    expect(taskPackage.baselineHash).toBe(hashCanonical(loadBaselineContentFixture()))
    expect(checkResultCorrelation(taskPackage, loadResultManifestFixture())).toEqual({ ok: true })
    expect(checkResultCorrelation(loadTaskPackageFixture('snapshot'), loadResultManifestFixture('snapshot'))).toEqual({ ok: true })
    expect(assertRevisionKind(requireProfile('react-vite', 1), loadResultManifestFixture().resultRevision)).toEqual({ ok: true })
    expect(assertRevisionKind(requireProfile('wordpress-theme', 1), loadResultManifestFixture('snapshot').resultRevision)).toEqual({ ok: true })
  })

  it('WordPress manifest carries no invented commit SHA', () => {
    const manifest = loadResultManifestFixture('snapshot')
    expect(manifest.baseRevision.kind).toBe('snapshot')
    expect(manifest.baseCommit).toBeUndefined()
    expect(manifest.resultCommit).toBeUndefined()
  })

  it('reserve response points packageUrl at its own task and attempt', () => {
    const response = loadReserveResponseFixture()
    expect(response.packageUrl).toBe(buildPackageUrl(response.taskId, response.attemptId))
    expect(response.packageUrl).toBe(
      '/api/delivery_os/tasks/22222222-2222-4222-8222-222222222222/package?attemptId=33333333-3333-4333-8333-333333333333',
    )
    const tampered = reserveAttemptResponseSchema.safeParse({
      ...response,
      packageUrl: buildPackageUrl(response.taskId, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
    })
    expect(tampered.success).toBe(false)
    if (!tampered.success) expect(deliveryErrorFromZod(tampered.error).body.code).toBe('correlation_mismatch')
  })

  it('error body fixture is exactly what a foreign-task result produces', () => {
    const foreign = loadNegativeDeliveryFixtures().find((fixture) => fixture.name === 'result-manifest.foreign-task')
    const result = checkResultCorrelation(loadTaskPackageFixture(), foreign?.document as ResultManifestV1)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.body).toEqual(loadErrorBodyFixture())
  })

  it('widget context fixture takes overrides and still needs callbacks', () => {
    const context = buildExecutionWidgetContextFixture({ taskId: null })
    expect(context.taskId).toBeNull()
    expect(typeof context.refresh).toBe('function')
    expect(() => buildExecutionWidgetContextFixture({ refresh: undefined as unknown as () => void })).toThrow()
  })

  it('loaders return fresh copies, so a test cannot corrupt the shared fixture', () => {
    const first = loadTaskPackageFixture()
    first.allowedPaths.push('../escape')
    first.requirements[0].title = 'mutated'
    const second = loadTaskPackageFixture()
    expect(second.allowedPaths).toEqual(['src/**', 'tests/**'])
    expect(second.requirements[0].title).toBe('Service catalogue list')
  })
})

describe('negative delivery fixtures', () => {
  const negatives = loadNegativeDeliveryFixtures()

  it('catalogue lists every file in fixtures/negative exactly once', () => {
    const files = readdirSync(join(fixturesDir, 'negative')).filter((file) => file.endsWith('.v1.json')).sort()
    expect(negatives.map((fixture) => `${fixture.name}.v1.json`).sort()).toEqual(files)
  })

  it('covers the required failure classes', () => {
    const labels = negatives.map((fixture) => `${fixture.expected.stage}:${fixture.expected.code}`)
    for (const label of [
      'schema:unsupported_schema_version',
      'correlation:correlation_mismatch',
      'profile:revision_kind_mismatch',
      'schema:validation_failed',
      'idempotency:idempotency_conflict',
      'dag:cycle',
      'schema:path_not_allowed',
      'profile:path_not_allowed',
    ]) {
      expect(labels).toContain(label)
    }
  })

  it.each(negatives.map((fixture) => [fixture.name, fixture] as const))('%s fails at its labelled stage with its labelled code', (_name, fixture) => {
    expect(fixture.expected.status).toBe(deliveryErrorCodes[fixture.expected.code])
    const schemaStage = runSchemaStage(fixture)
    if (fixture.expected.stage === 'schema') {
      expect(schemaStage.result.ok).toBe(false)
      if (schemaStage.result.ok) return
      expect(schemaStage.result.body.code).toBe(fixture.expected.code)
      expect(schemaStage.result.status).toBe(fixture.expected.status)
      return
    }
    expect(schemaStage.result).toEqual({ ok: true })
    const result = runLabelledStage(fixture, schemaStage.data)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.body.code).toBe(fixture.expected.code)
    expect(result.status).toBe(fixture.expected.status)
  })

  it('bad manifest fixtures point at the defective check fields', () => {
    const detailPaths = (name: string) => {
      const fixture = negatives.find((entry) => entry.name === name)
      if (!fixture) throw new Error(`[internal] missing ${name}`)
      const result = runSchemaStage(fixture).result
      return result.ok ? [] : result.body.details.map((detail) => detail.path)
    }
    expect(detailPaths('result-manifest.missing-check-fields')).toEqual(
      expect.arrayContaining(['checks.0.testDefinitionHash', 'checks.0.rawReportHash']),
    )
    expect(detailPaths('result-manifest.status-skipped')).toEqual(['checks.0.status'])
  })

  it('positive twins pass the same stages, so the checks are not trivially failing', () => {
    const plan = loadPlanProposalFixture()
    const react = requireProfile('react-vite', 1)
    expect(runDagStage(plan)).toEqual({ ok: true })
    expect(runProfileStage(react, plan, DELIVERY_SCHEMA_VERSIONS.planProposal)).toEqual({ ok: true })
    expect(runProfileStage(react, loadResultManifestFixture(), DELIVERY_SCHEMA_VERSIONS.resultManifest)).toEqual({ ok: true })
    const body = { mode: 'manual_handoff', baseRevision: loadTaskPackageFixture().baseRevision }
    expect(runIdempotencyStage({ idempotencyKey: 'k', first: body, second: { ...body } })).toEqual({ ok: true })
    expect(reserveAttemptRequestSchema.safeParse(body).success).toBe(true)
  })
})

describe('buildResultManifest (fake executor)', () => {
  const taskPackage = loadTaskPackageFixture()

  it('reproduces the published git fixture from its package', () => {
    const fixture = loadResultManifestFixture()
    expect(buildResultManifest(taskPackage, { changedPaths: fixture.changedPaths, artifacts: fixture.artifacts })).toEqual(fixture)
  })

  it.each(['git', 'snapshot'] as const)('output for the %s package parses and correlates', (variant) => {
    const source = loadTaskPackageFixture(variant)
    const manifest = buildResultManifest(source)
    expect(resultManifestV1Schema.safeParse(manifest).success).toBe(true)
    expect(checkResultCorrelation(source, manifest)).toEqual({ ok: true })
    const profile = requireProfile(source.targetProfileId, source.targetProfileVersion)
    expect(assertRevisionKind(profile, manifest.resultRevision)).toEqual({ ok: true })
  })

  it('is deterministic', () => {
    expect(buildResultManifest(taskPackage)).toEqual(buildResultManifest(taskPackage))
  })

  it('emits one check per required test with its AC ids plus the non-test profile checks', () => {
    const manifest = buildResultManifest(taskPackage)
    const testChecks = manifest.checks.filter((check) => check.acIds.length > 0)
    expect(testChecks.map((check) => [check.testId, check.acIds])).toEqual([
      ['service catalogue AC-001: service list renders seeded services', ['AC-001']],
      ['service catalogue AC-002: category filter narrows the list', ['AC-002']],
    ])
    expect(manifest.checks.map((check) => check.checkId)).toEqual(
      expect.arrayContaining(['unit-tests-1', 'unit-tests-2', 'build', 'lint', 'dependency-audit']),
    )
    expect(manifest.checks.every((check) => check.status === 'passed' && check.exitCode === 0)).toBe(true)
    expect(manifest.usage).toEqual({ source: 'runner', values: 'unknown' })
  })

  it('checkStatus override marks every check and keeps the manifest valid', () => {
    const failed = buildResultManifest(taskPackage, { checkStatus: 'failed' })
    expect(failed.checks.every((check) => check.status === 'failed' && check.exitCode === 1)).toBe(true)
    const notRun = buildResultManifest(taskPackage, { checkStatus: 'not_run' })
    expect(notRun.checks.every((check) => check.status === 'not_run' && check.exitCode === null)).toBe(true)
    expect(resultManifestV1Schema.safeParse(notRun).success).toBe(true)
  })

  it('resultRevision override flows into checks and resultCommit', () => {
    const resultRevision: SourceRevision = { kind: 'git', commitSha: 'f'.repeat(40) }
    const manifest = buildResultManifest(taskPackage, { resultRevision })
    expect(manifest.resultCommit).toBe('f'.repeat(40))
    expect(manifest.checks.every((check) => check.sourceRevision.kind === 'git' && check.sourceRevision.commitSha === 'f'.repeat(40))).toBe(true)
    expect(resultManifestV1Schema.safeParse(manifest).success).toBe(true)
  })

  it('baseRevision override keeps baseCommit consistent', () => {
    const baseRevision: SourceRevision = { kind: 'git', commitSha: 'a'.repeat(40) }
    const manifest = buildResultManifest(taskPackage, { baseRevision })
    expect(manifest.baseCommit).toBe('a'.repeat(40))
    expect(resultManifestV1Schema.safeParse(manifest).success).toBe(true)
    const result = checkResultCorrelation(taskPackage, manifest)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.body.code).toBe('base_revision_mismatch')
  })

  it('reports a profile test check even when no AC maps to a test', () => {
    const noRequiredTests = { ...taskPackage, validationProfile: { ...taskPackage.validationProfile, requiredTests: {} } }
    const manifest = buildResultManifest(noRequiredTests)
    expect(manifest.checks.map((check) => check.checkId)).toEqual(['unit-tests', 'build', 'lint', 'dependency-audit'])
    expect(resultManifestV1Schema.safeParse(manifest).success).toBe(true)
  })

  it('keeps generated check ids unique and within the id limit', () => {
    const longId = `t${'x'.repeat(63)}`
    const checks = [
      { checkId: longId, commandProfileId: 'vitest-report', kind: 'test' as const, required: true },
      { checkId: `${longId.slice(0, 56)}-1`, commandProfileId: 'vite-build', kind: 'build' as const, required: true },
      { checkId: 'e2e', commandProfileId: 'playwright', kind: 'test' as const, required: true },
    ]
    const manifest = buildResultManifest({ ...taskPackage, validationProfile: { ...taskPackage.validationProfile, checks } })
    const checkIds = manifest.checks.map((check) => check.checkId)
    expect(new Set(checkIds).size).toBe(checkIds.length)
    expect(checkIds).toContain('e2e')
    expect(resultManifestV1Schema.safeParse(manifest).success).toBe(true)
  })

  it('refuses to invent a test command when required tests have no test check', () => {
    const noTestCheck = {
      ...taskPackage,
      validationProfile: { ...taskPackage.validationProfile, checks: taskPackage.validationProfile.checks.filter((check) => check.kind !== 'test') },
    }
    expect(() => buildResultManifest(noTestCheck)).toThrow('[internal]')
  })

  it('produces a correlation failure QA can use for replay-against-foreign-attempt scenarios', () => {
    const manifest = buildResultManifest(taskPackage, { attemptId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' })
    const result = checkResultCorrelation(taskPackage, manifest)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.body.code).toBe('correlation_mismatch')
  })
})

describe('checkResultCorrelation', () => {
  const taskPackage = loadTaskPackageFixture()
  const manifest = loadResultManifestFixture()

  it('treats a null and an absent baseCommit as equal for snapshot revisions', () => {
    const snapshotPackage = loadTaskPackageFixture('snapshot')
    const snapshotManifest = loadResultManifestFixture('snapshot')
    expect(checkResultCorrelation({ ...snapshotPackage, baseCommit: null }, snapshotManifest)).toEqual({ ok: true })
  })

  it.each([
    ['projectId', { projectId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }, 'correlation_mismatch'],
    ['targetProfileVersion', { targetProfileVersion: 2 }, 'correlation_mismatch'],
    ['baselineId', { baselineId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }, 'baseline_mismatch'],
    ['baselineHash', { baselineHash: 'b'.repeat(64) }, 'baseline_mismatch'],
    [
      'baseRevision',
      { baseRevision: { kind: 'git' as const, commitSha: 'e'.repeat(40) }, baseCommit: 'e'.repeat(40) },
      'base_revision_mismatch',
    ],
  ])('rejects a different %s', (_field, change, code) => {
    const result = checkResultCorrelation(taskPackage, { ...manifest, ...change })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.body.code).toBe(code)
      expect(result.status).toBe(422)
    }
  })
})
