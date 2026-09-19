import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import { resultCheckSchema, resultManifestV1Schema, sourceRevisionSchema } from '../contracts'
import { assertRevisionKind, checkAllowedPathsForProfile, getTargetProfile } from '../targetProfiles'

import { reserveAttempt } from '../attempts'
import { proveAcceptanceCriteria } from '../acProof'
import { checkResultCorrelation, evaluateResultAcceptance } from '../resultAcceptance'
import { mapRunnerStatus } from '../resultChecks'
import { type ResultManifestV1 } from '../contracts'
import { assessFixturePreview, digestBytes, loadMappingFixture, mapWordpressFixture, readMappingArtifact, snapshotContentHash, type MappingFixture } from './wordpressMappingFixture'

const evidenceDirectory = resolve(__dirname, '../../../../../../../hackathon/delivery-demo/adapters/wordpress')

function loadEvidence(relativePath: string): unknown {
  return JSON.parse(readFileSync(resolve(evidenceDirectory, relativePath), 'utf8'))
}

const liveReportSchema = z.object({
  provenance: z.literal('live'),
  attemptId: z.uuid(),
  siteId: z.string(),
  snapshot: z.object({
    siteId: z.string(),
    creationAttemptId: z.uuid(),
    sourceRevision: sourceRevisionSchema,
    themeFiles: z.record(z.string(), z.string()),
  }),
  checks: z.array(z.unknown()).min(1),
})

describe('WordPress Studio evidence at the delivery domain boundary', () => {
  it('accepts the recorded snapshot revision and theme paths for the WordPress target', () => {
    const report = liveReportSchema.parse(loadEvidence('evidence/local-studio.live.json'))
    const profile = getTargetProfile('wordpress-theme', 1)
    if (!profile) throw new Error('[internal] Missing WordPress target profile')

    expect(report.snapshot.siteId).toBe(report.siteId)
    expect(report.snapshot.creationAttemptId).toBe(report.attemptId)
    expect(report.snapshot.sourceRevision).toMatchObject({
      kind: 'snapshot',
      externalWorkspaceId: report.siteId,
    })
    expect(assertRevisionKind(profile, report.snapshot.sourceRevision)).toEqual({ ok: true })
    expect(checkAllowedPathsForProfile(profile, Object.keys(report.snapshot.themeFiles))).toEqual({ ok: true })
  })

  it.each(['evidence/local-studio.live.json', 'fixtures/tool-evidence.fixture.json'])(
    'rejects the standalone report %s as a domain result manifest',
    (relativePath) => {
      const report = loadEvidence(relativePath)
      expect(resultManifestV1Schema.safeParse(report).success).toBe(false)
    },
  )

  it('does not accept successful local tool checks as acceptance-criterion evidence', () => {
    const report = liveReportSchema.parse(loadEvidence('evidence/local-studio.live.json'))

    for (const check of report.checks) {
      expect(resultCheckSchema.safeParse(check).success).toBe(false)
    }
  })
})


function acceptMapping(fixture: MappingFixture, manifest: unknown) {
  const taskPackage = fixture.taskPackage
  const reservation = reserveAttempt([], {
    idempotencyKey: taskPackage.idempotencyKey, payload: { mode: 'manual_handoff', baseRevision: taskPackage.baseRevision },
    mode: 'manual_handoff', baselineId: taskPackage.baselineId, baselineHash: taskPackage.baselineHash,
    baseRevision: taskPackage.baseRevision, now: '2026-09-19T10:00:00.000Z', newAttemptId: taskPackage.attemptId,
  })
  if (!reservation.ok) throw new Error('[internal] fixture_reservation_failed')
  return evaluateResultAcceptance({ manifestRaw: manifest, task: { id: taskPackage.taskId, allowedPaths: taskPackage.allowedPaths }, attempt: reservation.attempt, taskPackage: { ok: true, taskPackage, declaredTestIds: Object.values(taskPackage.validationProfile.requiredTests).flat() }, existingResult: null })
}
function mappingProof(fixture: MappingFixture, manifest: ResultManifestV1) {
  return proveAcceptanceCriteria({ acIds: ['AC-101'], acTestMap: fixture.taskPackage.validationProfile.requiredTests,
    manualChecks: {}, baselineId: fixture.taskPackage.baselineId, revision: manifest.resultRevision,
    evidence: [{ id: 'fixture-evidence', kind: 'result_manifest', baselineId: manifest.baselineId, sourceRevision: manifest.resultRevision, payload: manifest }],
  })[0]
}

describe('WP-M02 synthetic snapshot to OSS mapping (no live tool or preview execution)', () => {
  it('serializes a correlated snapshot manifest with exact added/modified/deleted paths and byte-backed artifacts', () => {
    const fixture = loadMappingFixture()
    const manifest = mapWordpressFixture(fixture)
    const serialized: unknown = JSON.parse(JSON.stringify(manifest))
    expect(resultManifestV1Schema.parse(serialized)).toEqual(manifest)
    expect(checkResultCorrelation(fixture.taskPackage, manifest)).toEqual({ ok: true })
    expect(acceptMapping(fixture, serialized)).toMatchObject({ ok: true, outcome: 'accept' })
    expect(manifest.changedPaths).toEqual(['parts/old-services.html', 'parts/services.html', 'templates/front-page.html'])
    expect(manifest).not.toHaveProperty('baseCommit')
    expect(manifest).not.toHaveProperty('resultCommit')
    expect(fixture.result.creationAttemptId).not.toBe(manifest.attemptId)
    expect(manifest.externalRunId).toBe(`fixture-run-${manifest.attemptId}`)
    expect(manifest.agentDeclaration?.claimedAcIds).toEqual([])
    expect(mappingProof(fixture, manifest)).toMatchObject({ status: 'passed', proven: true })
    for (const artifact of manifest.artifacts) expect(artifact.sha256).toBe(digestBytes(readMappingArtifact(artifact.path)))
  })

  it.each(['projectId', 'taskId', 'attemptId', 'baselineId', 'baselineHash', 'targetProfileVersion'] as const)('rejects mismatched %s in both the mapper ledger and OSS correlation', (key) => {
    const fixture = loadMappingFixture()
    const manifest = mapWordpressFixture(fixture)
    if (key === 'targetProfileVersion') { manifest[key] = 2; fixture.bundle.execution[key] = 2 }
    else { const value = key === 'baselineHash' ? '0'.repeat(64) : '44444444-4444-4444-8444-444444444444'; manifest[key] = value; fixture.bundle.execution[key] = value }
    expect(checkResultCorrelation(fixture.taskPackage, manifest).ok).toBe(false)
    expect(acceptMapping(fixture, manifest).ok).toBe(false)
    expect(() => mapWordpressFixture(fixture)).toThrow('fixture_execution_mismatch')
  })

  it.each(['tenantId', 'organizationId', 'projectId'] as const)('rejects tool scope outside trusted host %s', (key) => {
    const fixture = loadMappingFixture()
    fixture.result.scope[key] = '44444444-4444-4444-8444-444444444444'
    expect(() => mapWordpressFixture(fixture)).toThrow('fixture_scope_mismatch')
  })

  it('rejects foreign base revisions and revision kind', () => {
    const fixture = loadMappingFixture()
    const manifest = mapWordpressFixture(fixture)
    manifest.baseRevision = { kind: 'snapshot', contentHash: '0'.repeat(64), externalWorkspaceId: 'foreign-site' }
    expect(acceptMapping(fixture, manifest).ok).toBe(false)
    fixture.taskPackage.baseRevision = manifest.baseRevision
    expect(() => mapWordpressFixture(fixture)).toThrow('fixture_base_revision_mismatch')
    fixture.result.sourceRevision = { kind: 'git', commitSha: 'a'.repeat(40) }
    expect(() => mapWordpressFixture(fixture)).toThrow('fixture_revision_kind')
  })

  it('guards the result workspace locally while documenting the current OSS acceptance gap', () => {
    const fixture = loadMappingFixture()
    const manifest = mapWordpressFixture(fixture)
    if (manifest.resultRevision.kind !== 'snapshot') throw new Error('[internal] fixture_snapshot_expected')
    manifest.resultRevision.externalWorkspaceId = 'foreign-site'
    manifest.checks.forEach((check) => { check.sourceRevision = manifest.resultRevision })
    expect(acceptMapping(fixture, manifest)).toMatchObject({ ok: true, outcome: 'accept' })
    fixture.result.siteId = 'foreign-site'
    fixture.result.sourceRevision = manifest.resultRevision
    expect(() => mapWordpressFixture(fixture)).toThrow('fixture_workspace_mismatch')
  })

  it.each(['unknown_ac', 'unknown_test', 'old_validation_profile', 'duplicate_check', 'wrong_check_revision', 'disallowed_path'])('rejects %s at the real OSS acceptance boundary', (variant) => {
    const fixture = loadMappingFixture()
    const manifest = mapWordpressFixture(fixture)
    if (variant === 'unknown_ac') manifest.checks[0].acIds = ['AC-UNKNOWN']
    if (variant === 'unknown_test') manifest.checks[0].testId = 'unregistered-test'
    if (variant === 'old_validation_profile') manifest.checks[0].validationProfileVersion = 2
    if (variant === 'duplicate_check') manifest.checks.push(manifest.checks[0])
    if (variant === 'wrong_check_revision') manifest.checks[0].sourceRevision = manifest.baseRevision
    if (variant === 'disallowed_path') manifest.changedPaths.push('wp-config.php')
    expect(acceptMapping(fixture, manifest).ok).toBe(false)
  })

  it.each(['database', 'theme', 'definition', 'report'] as const)('detects changed %s bytes with stale SHA rather than trusting schema', (variant) => {
    const fixture = loadMappingFixture()
    const target = variant === 'database' ? fixture.result.artifacts.database : variant === 'theme' ? fixture.result.artifacts.theme['templates/front-page.html'] : fixture.bundle.artifacts['smoke-tests-1'][variant]
    expect(() => mapWordpressFixture(fixture, (path) => path === target ? Buffer.from('tampered bytes') : readMappingArtifact(path))).toThrow(/fixture_.*hash_mismatch/)
    expect(resultManifestV1Schema.safeParse(mapWordpressFixture(fixture)).success).toBe(true)
  })

  it('rejects untracked tool executions, stale snapshot hashes and path escapes', () => {
    const fixture = loadMappingFixture()
    fixture.bundle.execution.toolExecutionIds = []
    expect(() => mapWordpressFixture(fixture)).toThrow('fixture_execution_mismatch')
    const stale = loadMappingFixture()
    if (stale.result.sourceRevision.kind === 'snapshot') stale.result.sourceRevision.contentHash = '0'.repeat(64)
    expect(() => mapWordpressFixture(stale)).toThrow('fixture_snapshot_hash_mismatch')
    expect(() => readMappingArtifact('../tool-evidence.fixture.json')).toThrow('fixture_artifact_path_escape')
    const escaped = loadMappingFixture()
    escaped.result.themeFiles['../wp-config.php'] = '0'.repeat(64)
    escaped.result.artifacts.theme['../wp-config.php'] = 'unused'
    expect(() => mapWordpressFixture(escaped)).toThrow('fixture_path_not_allowed')
    const outsideTask = loadMappingFixture()
    outsideTask.taskPackage.allowedPaths = ['patterns/**']
    expect(() => mapWordpressFixture(outsideTask)).toThrow('fixture_path_not_allowed')
  })

  it('gives a database-only change a new revision without inventing a changed theme path', () => {
    const fixture = loadMappingFixture()
    fixture.result.themeFiles = { ...fixture.base.themeFiles }
    fixture.result.artifacts.theme = { ...fixture.base.artifacts.theme }
    if (fixture.result.sourceRevision.kind !== 'snapshot') throw new Error('[internal] fixture_snapshot_expected')
    fixture.result.sourceRevision.contentHash = snapshotContentHash(fixture.result)
    fixture.bundle.checks.forEach((check) => { check.sourceRevision = fixture.result.sourceRevision })
    const manifest = mapWordpressFixture(fixture)
    expect(manifest.changedPaths).toEqual([])
    expect(manifest.resultRevision).not.toEqual(manifest.baseRevision)
    expect(acceptMapping(fixture, manifest)).toMatchObject({ ok: true, outcome: 'accept' })
  })

  it.each(['failed', 'not_run', 'partial', 'missing'])('does not turn %s into acceptance proof', (status) => {
    const fixture = loadMappingFixture()
    const manifest = mapWordpressFixture(fixture)
    if (status === 'missing') manifest.checks = []
    else { manifest.checks[0].status = mapRunnerStatus(status); manifest.checks[0].exitCode = status === 'failed' ? 1 : null }
    expect(acceptMapping(fixture, manifest)).toMatchObject({ ok: true, outcome: 'accept' })
    expect(mappingProof(fixture, manifest)).toMatchObject({ proven: false, status: status === 'partial' ? 'not_run' : status })
  })

  it.each(['http.local', 'studio.create', 'snapshot.capture'])('never upgrades %s ToolCheck into ResultCheck', (id) => {
    const fixture = loadMappingFixture()
    const raw: unknown = { ...fixture.bundle, checks: [{ id, status: 'passed', checkedAt: '2026-09-19T10:00:00.000Z' }] }
    expect(resultCheckSchema.safeParse((raw as { checks: unknown[] }).checks[0]).success).toBe(false)
    expect(() => mapWordpressFixture({ ...fixture, bundle: raw as MappingFixture['bundle'] })).toThrow()
  })

  it('keeps expired, unverified and even current fixture previews out of live acceptance', () => {
    const preview = { expiresAt: '2026-09-20T10:00:00.000Z', observedAt: '2026-09-19T10:00:00.000Z', buildId: 'fixture-build', observedBuildId: 'fixture-build' }
    const now = '2026-09-19T10:05:00.000Z'
    expect(assessFixturePreview({ ...preview, expiresAt: '2026-09-18T10:00:00.000Z' }, now)).toBe('expired')
    expect(assessFixturePreview({ ...preview, observedAt: null }, now)).toBe('unverified')
    expect(assessFixturePreview({ ...preview, observedBuildId: 'historical-build' }, now)).toBe('invalid_observation')
    expect(assessFixturePreview(preview, now)).toBe('fixture_not_live')
  })
})
