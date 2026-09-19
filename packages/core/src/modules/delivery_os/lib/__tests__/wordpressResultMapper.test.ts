import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mapWordpressResult, wordpressSnapshotContentHash, type WordpressResultMappingInput } from '../wordpressResultMapper'
import { reserveAttempt } from '../attempts'
import { evaluateResultAcceptance } from '../resultAcceptance'
import { loadMappingFixture, readMappingArtifact, snapshotContentHash } from './wordpressMappingFixture'

const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const otherId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

function mappingInput(): WordpressResultMappingInput {
  const fixture = loadMappingFixture()
  const siteId = 'a'.repeat(64)
  const taskPackage = fixture.taskPackage
  const snapshot = (kind: 'base' | 'result') => {
    const source = fixture[kind]
    return {
      scope: fixture.trustedScope,
      snapshot: {
        schemaVersion: 1 as const, provenance: 'live' as const, siteId,
        creationAttemptId: id, toolExecutionId: kind === 'base' ? id : otherId,
        capturedAt: '2026-09-19T10:00:00.000Z',
        sourceRevision: { kind: 'snapshot' as const, externalWorkspaceId: siteId, contentHash: snapshotContentHash(source) },
        themeFiles: source.themeFiles, databaseHash: source.databaseHash,
      },
      database: { path: `${kind}/database.sqlite`, bytes: readMappingArtifact(source.artifacts.database) },
      theme: Object.fromEntries(Object.entries(source.artifacts.theme).map(([path, reference]) => [path, { path: `${kind}/theme/${path}`, bytes: readMappingArtifact(reference) }])),
    }
  }
  const base = snapshot('base')
  const result = snapshot('result')
  taskPackage.baseRevision = base.snapshot.sourceRevision
  const execution = {
    projectId: taskPackage.projectId, taskId: taskPackage.taskId, attemptId: taskPackage.attemptId,
    baselineId: taskPackage.baselineId, baselineHash: taskPackage.baselineHash,
    targetProfileId: taskPackage.targetProfileId, targetProfileVersion: taskPackage.targetProfileVersion,
    packageSchemaVersion: taskPackage.schemaVersion, externalRunId: 'test-run-actual-byte-mapping',
  }
  return {
    taskPackage, trusted: { scope: fixture.trustedScope, siteId, creationAttemptId: id, execution: { ...execution }, baseToolExecutionId: id, resultToolExecutionId: otherId },
    base, result, execution,
    checks: fixture.bundle.checks.map((check) => ({
      check: { ...check, sourceRevision: result.snapshot.sourceRevision },
      definition: { path: fixture.bundle.artifacts[check.checkId].definition, bytes: readMappingArtifact(fixture.bundle.artifacts[check.checkId].definition) },
      report: { path: fixture.bundle.artifacts[check.checkId].report, bytes: readMappingArtifact(fixture.bundle.artifacts[check.checkId].report) },
    })), usage: { source: 'runner', values: 'unknown' },
  }
}

describe('WordPress internal result mapper (synthetic metadata, real frozen fixture bytes; not live acceptance)', () => {
  it('maps the provider snapshot algorithm and retains reported partial statuses without inventing checks', () => {
    const input = mappingInput()
    const manifest = mapWordpressResult(input)
    expect(manifest.baseRevision).toEqual(input.taskPackage.baseRevision)
    expect(manifest.checks).toEqual(input.checks.map(({ check }) => check))
    expect(manifest.changedPaths).toEqual(['parts/old-services.html', 'parts/services.html', 'templates/front-page.html'])
    expect(manifest.artifacts).toContainEqual({ path: 'result/database.sqlite', sha256: input.result.snapshot.databaseHash, sizeBytes: input.result.database.bytes.byteLength })
    expect(manifest).not.toHaveProperty('agentDeclaration')
    input.checks = []
    expect(mapWordpressResult(input).checks).toEqual([])
  })

  it('passes the mapped byte-backed manifest into canonical OSS domain result acceptance', () => {
    const input = mappingInput()
    const { taskPackage } = input
    const reservation = reserveAttempt([], {
      idempotencyKey: taskPackage.idempotencyKey,
      payload: { mode: 'manual_handoff', baseRevision: taskPackage.baseRevision },
      mode: 'manual_handoff', baselineId: taskPackage.baselineId, baselineHash: taskPackage.baselineHash,
      baseRevision: taskPackage.baseRevision, now: '2026-09-19T10:00:00.000Z', newAttemptId: taskPackage.attemptId,
    })
    if (!reservation.ok) throw new Error('[internal] test_reservation_failed')
    const manifest = mapWordpressResult(input)
    const result = evaluateResultAcceptance({
      manifestRaw: JSON.parse(JSON.stringify(manifest)),
      task: { id: taskPackage.taskId, allowedPaths: taskPackage.allowedPaths },
      attempt: reservation.attempt,
      taskPackage: { ok: true, taskPackage, declaredTestIds: Object.values(taskPackage.validationProfile.requiredTests).flat() },
      existingResult: null,
    })
    expect(result).toMatchObject({ ok: true, outcome: 'accept', manifest })
    if (!result.ok || result.outcome !== 'accept') throw new Error('[internal] test_acceptance_failed')
    expect(result.manifestHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it.each(['base', 'result'] as const)('rejects foreign %s workspace even if content hashes match', (kind) => {
    const input = mappingInput()
    input[kind].snapshot.sourceRevision = { kind: 'snapshot', contentHash: input[kind].snapshot.databaseHash, externalWorkspaceId: 'b'.repeat(64) }
    expect(() => mapWordpressResult(input)).toThrow('workspace_mismatch')
  })

  it.each(['tenantId', 'organizationId', 'projectId'] as const)('rejects foreign %s on result scope', (key) => {
    const input = mappingInput()
    input.result.scope = { ...input.result.scope, [key]: otherId }
    expect(() => mapWordpressResult(input)).toThrow('scope_mismatch')
  })

  it.each(['taskId', 'attemptId', 'baselineId', 'baselineHash', 'targetProfileId', 'targetProfileVersion', 'externalRunId'] as const)('rejects foreign execution %s', (key) => {
    const input = mappingInput()
    Object.assign(input.execution, { [key]: key === 'targetProfileVersion' ? 99 : key === 'baselineHash' ? '0'.repeat(64) : otherId })
    expect(() => mapWordpressResult(input)).toThrow('correlation_mismatch')
  })

  it('does not confuse site creation attempt with the reserved task attempt', () => {
    const input = mappingInput()
    expect(input.result.snapshot.creationAttemptId).not.toBe(input.taskPackage.attemptId)
    expect(mapWordpressResult(input).attemptId).toBe(input.taskPackage.attemptId)
    input.result.snapshot.creationAttemptId = input.taskPackage.attemptId
    expect(() => mapWordpressResult(input)).toThrow('snapshot_binding_mismatch')
  })

  it('binds tool execution IDs and rejects fixture provenance', () => {
    const input = mappingInput()
    input.result.snapshot.toolExecutionId = id
    expect(() => mapWordpressResult(input)).toThrow('snapshot_binding_mismatch')
    Object.assign(input.result.snapshot, { toolExecutionId: otherId, provenance: 'fixture' })
    expect(() => mapWordpressResult(input)).toThrow()
  })

  it.each(['database', 'theme', 'definition', 'report'] as const)('hashes exact %s bytes instead of trusting declarations', (kind) => {
    const input = mappingInput()
    if (kind === 'database') input.result.database.bytes = Buffer.from('changed')
    if (kind === 'theme') Object.values(input.result.theme)[0].bytes = Buffer.from('changed')
    if (kind === 'definition') input.checks[0].definition.bytes = Buffer.from('changed')
    if (kind === 'report') input.checks[0].report.bytes = Buffer.from('changed')
    expect(() => mapWordpressResult(input)).toThrow('artifact_hash_mismatch')
  })

  it('checks snapshot aggregate after individual bytes and pins base to package', () => {
    const input = mappingInput()
    input.result.snapshot.sourceRevision = { kind: 'snapshot', externalWorkspaceId: input.trusted.siteId, contentHash: '0'.repeat(64) }
    expect(() => mapWordpressResult(input)).toThrow('snapshot_hash_mismatch')
    const other = mappingInput()
    other.taskPackage.baseRevision = other.result.snapshot.sourceRevision
    expect(() => mapWordpressResult(other)).toThrow('base_revision_mismatch')
  })

  it('rejects missing theme bytes and collisions between artifact paths', () => {
    const input = mappingInput()
    delete input.result.theme[Object.keys(input.result.theme)[0]]
    expect(() => mapWordpressResult(input)).toThrow('theme_artifact_mismatch')
    const other = mappingInput()
    other.checks[0].report.path = other.checks[0].definition.path
    expect(() => mapWordpressResult(other)).toThrow('artifact_path_collision')
  })

  it('rejects changed files outside package scope including deletions', () => {
    const input = mappingInput()
    input.taskPackage.allowedPaths = ['parts/**']
    expect(() => mapWordpressResult(input)).toThrow('path_not_allowed')
    const deleted = mappingInput()
    const removed = 'templates/front-page.html'
    delete deleted.result.snapshot.themeFiles[removed]
    delete deleted.result.theme[removed]
    deleted.result.snapshot.sourceRevision = { kind: 'snapshot', externalWorkspaceId: deleted.trusted.siteId, contentHash: snapshotContentHash(deleted.result.snapshot) }
    deleted.checks = []
    expect(mapWordpressResult(deleted).changedPaths).toContain(removed)
  })

  it.each(['testId', 'acIds', 'commandProfileId', 'validationProfileVersion', 'sourceRevision'] as const)('rejects invalid reported check %s', (key) => {
    const input = mappingInput()
    Object.assign(input.checks[0].check, { [key]: key === 'validationProfileVersion' ? 99 : key === 'acIds' ? ['AC-FOREIGN'] : key === 'sourceRevision' ? input.base.snapshot.sourceRevision : 'foreign' })
    expect(() => mapWordpressResult(input)).toThrow()
  })

  it('preserves failed/not_run and rejects contradictory passed status', () => {
    const input = mappingInput()
    input.checks[0].check.status = 'failed'
    input.checks[0].check.exitCode = 1
    expect(mapWordpressResult(input).checks[0].status).toBe('failed')
    input.checks[0].check.status = 'not_run'
    input.checks[0].check.exitCode = null
    expect(mapWordpressResult(input).checks[0].status).toBe('not_run')
    input.checks[0].check.status = 'passed'
    expect(() => mapWordpressResult(input)).toThrow('check_status_mismatch')
  })

  it('rejects traversal and malformed package instead of reading arbitrary files', () => {
    const input = mappingInput()
    input.result.database.path = '../database.sqlite'
    expect(() => mapWordpressResult(input)).toThrow()
    const other = mappingInput()
    Object.assign(other.taskPackage, { schemaVersion: 'delivery.task-package/v2' })
    expect(() => mapWordpressResult(other)).toThrow()
  })

  it('detects exact binary corruption without UTF-8 normalization', () => {
    const input = mappingInput()
    input.result.database.bytes = Uint8Array.from([255, 0, 254])
    input.result.snapshot.databaseHash = digest(input.result.database.bytes)
    input.result.snapshot.sourceRevision = { kind: 'snapshot', externalWorkspaceId: input.trusted.siteId, contentHash: snapshotContentHash(input.result.snapshot) }
    input.checks = []
    expect(mapWordpressResult(input).artifacts.find((artifact) => artifact.path === 'result/database.sqlite')?.sizeBytes).toBe(3)
    input.result.database.bytes = Uint8Array.from([254, 0, 255])
    expect(() => mapWordpressResult(input)).toThrow('artifact_hash_mismatch')
  })
  it('matches the independently recorded real provider snapshot hash', () => {
    const recorded = JSON.parse(readFileSync(resolve(__dirname, '../../../../../../../context/changes/wordpress-local-theme-build/evidence/built-site-snapshot.json'), 'utf8'))
    expect(wordpressSnapshotContentHash(recorded.snapshot)).toBe(recorded.snapshot.sourceRevision.contentHash)
  })

  it('permits unchanged provider inventory outside modification roots, but rejects changes there', () => {
    const input = mappingInput()
    for (const kind of ['base', 'result'] as const) {
      const bytes = Buffer.from('unchanged root index')
      input[kind].snapshot.themeFiles['index.php'] = digest(bytes)
      input[kind].theme['index.php'] = { path: `${kind}/index.php`, bytes }
      input[kind].snapshot.sourceRevision = { kind: 'snapshot', externalWorkspaceId: input.trusted.siteId, contentHash: wordpressSnapshotContentHash(input[kind].snapshot) }
    }
    input.taskPackage.baseRevision = input.base.snapshot.sourceRevision
    input.checks = []
    expect(mapWordpressResult(input).changedPaths).not.toContain('index.php')
    input.result.theme['index.php'].bytes = Buffer.from('changed')
    input.result.snapshot.themeFiles['index.php'] = digest(input.result.theme['index.php'].bytes)
    input.result.snapshot.sourceRevision = { kind: 'snapshot', externalWorkspaceId: input.trusted.siteId, contentHash: wordpressSnapshotContentHash(input.result.snapshot) }
    expect(() => mapWordpressResult(input)).toThrow('path_not_allowed')
  })

  it('rejects too many distinct output artifacts before attempting byte hashes', () => {
    const input = mappingInput()
    for (let index = 0; index < 201; index += 1) input.result.theme[`assets/item-${index}.css`] = { path: `result/item-${index}.css`, bytes: Buffer.from('mismatch') }
    expect(() => mapWordpressResult(input)).toThrow('artifact_count_limit')
  })

  it('bounds individual and aggregate check bytes before hashing', () => {
    const input = mappingInput()
    input.checks[0].report.bytes = new Uint8Array(8 * 1024 * 1024 + 1)
    expect(() => mapWordpressResult(input)).toThrow('check_size_limit')
    const other = mappingInput()
    const bytes = new Uint8Array(8 * 1024 * 1024)
    other.checks = Array.from({ length: 5 }, () => ({ ...other.checks[0], definition: { path: 'same/definition', bytes }, report: { path: 'same/report', bytes } }))
    expect(() => mapWordpressResult(other)).toThrow('check_size_limit')
  })

})
