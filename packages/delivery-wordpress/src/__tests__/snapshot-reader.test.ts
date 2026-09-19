import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { captureSiteSnapshot } from '../snapshot.ts'
import { readOwnedSnapshotArtifacts } from '../snapshot-reader.ts'
import { requestHashFor, siteIdFor, writeRecord } from '../ownership.ts'

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wp-snapshot-reader-'))
  const scope = { tenantId: randomUUID(), organizationId: randomUUID(), projectId: randomUUID() }
  const handle = { siteId: siteIdFor(scope) }
  const stateRoot = path.join(directory, 'state')
  const statePath = path.join(stateRoot, handle.siteId)
  const sitePath = path.join(directory, 'site')
  const artifactRoot = path.join(statePath, 'snapshots')
  for (const folder of [stateRoot, statePath, sitePath, artifactRoot]) await fs.mkdir(folder, { mode: 0o700 })
  const request = { scope, attemptId: randomUUID(), idempotencyKey: 'reader', name: 'Reader fixture', themeSlug: 'fixture' }
  await writeRecord(statePath, { schemaVersion: 1, request, requestHash: requestHashFor(request), status: 'ready', result: {
    schemaVersion: 1, provenance: 'fixture', siteId: handle.siteId, scope, attemptId: request.attemptId, toolExecutionId: randomUUID(), studioSiteId: 'reader-fixture', localUrl: 'http://localhost:9999', themeSlug: 'fixture', themeCommit: 'a'.repeat(40), createdAt: new Date().toISOString(), checks: [],
  } })
  const themeRoot = path.join(sitePath, 'wp-content/themes/fixture')
  await fs.mkdir(themeRoot, { recursive: true, mode: 0o700 })
  await fs.writeFile(path.join(themeRoot, 'index.php'), Buffer.from([255, 0, 254]))
  const databaseRoot = path.join(sitePath, 'wp-content/database')
  await fs.mkdir(databaseRoot, { mode: 0o700 })
  const database = new DatabaseSync(path.join(databaseRoot, '.ht.sqlite'))
  database.exec('CREATE TABLE own_content (id INTEGER PRIMARY KEY); INSERT INTO own_content VALUES (1)')
  database.close()
  const captured = await captureSiteSnapshot({ sitePath, themeSlug: 'fixture', artifactRoot })
  const snapshot = {
    schemaVersion: 1 as const, provenance: 'fixture' as const, siteId: handle.siteId,
    creationAttemptId: request.attemptId, toolExecutionId: randomUUID(), capturedAt: new Date().toISOString(),
    sourceRevision: { kind: 'snapshot' as const, contentHash: captured.contentHash, externalWorkspaceId: handle.siteId },
    themeFiles: captured.themeFiles, databaseHash: captured.databaseHash,
  }
  return { directory, statePath, captured, input: { scope, handle, snapshot, snapshotId: path.basename(captured.artifactDirectory), config: { stateRoot } },
    dispose: () => fs.rm(directory, { recursive: true, force: true }) }
}

test('reads exact frozen provider bytes without starting Studio or mutating state', async () => {
  const own = await fixture()
  try {
    const before = await fs.readFile(path.join(own.statePath, 'record.json'))
    const result = await readOwnedSnapshotArtifacts(own.input)
    assert.deepEqual(result.scope, own.input.scope)
    assert.deepEqual(result.snapshot, own.input.snapshot)
    assert.deepEqual(result.theme['index.php'].bytes, Buffer.from([255, 0, 254]))
    assert.deepEqual(result.database.bytes, await fs.readFile(path.join(own.captured.artifactDirectory, 'database.sqlite')))
    assert.equal(result.database.path, `snapshots/${own.input.snapshotId}/database.sqlite`)
    assert.deepEqual(await fs.readFile(path.join(own.statePath, 'record.json')), before)
    await assert.rejects(fs.lstat(path.join(own.statePath, 'operation.lock')), { code: 'ENOENT' })
  } finally { await own.dispose() }
})

for (const field of ['tenantId', 'organizationId', 'projectId'] as const) test(`rejects foreign ${field}`, async () => {
  const own = await fixture()
  try { await assert.rejects(readOwnedSnapshotArtifacts({ ...own.input, scope: { ...own.input.scope, [field]: randomUUID() } }), { code: 'snapshot_reader_ownership_mismatch' }) } finally { await own.dispose() }
})

for (const field of ['siteId', 'creationAttemptId', 'provenance'] as const) test(`rejects mismatched snapshot ${field}`, async () => {
  const own = await fixture()
  try { await assert.rejects(readOwnedSnapshotArtifacts({ ...own.input, snapshot: { ...own.input.snapshot, [field]: field === 'siteId' ? 'b'.repeat(64) : field === 'provenance' ? 'live' : randomUUID() } }), { code: 'snapshot_reader_binding_mismatch' }) } finally { await own.dispose() }
})

test('rejects foreign workspace and content hash', async () => {
  const own = await fixture()
  try {
    await assert.rejects(readOwnedSnapshotArtifacts({ ...own.input, snapshot: { ...own.input.snapshot, sourceRevision: { ...own.input.snapshot.sourceRevision, externalWorkspaceId: 'b'.repeat(64) } } }), { code: 'snapshot_reader_binding_mismatch' })
    await assert.rejects(readOwnedSnapshotArtifacts({ ...own.input, snapshot: { ...own.input.snapshot, sourceRevision: { ...own.input.snapshot.sourceRevision, contentHash: 'b'.repeat(64) } } }), { code: 'snapshot_reader_manifest_mismatch' })
  } finally { await own.dispose() }
})

for (const filename of ['database.sqlite', 'theme/index.php'] as const) test(`rejects corrupted ${filename}`, async () => {
  const own = await fixture()
  try {
    await fs.writeFile(path.join(own.captured.artifactDirectory, filename), 'altered')
    await assert.rejects(readOwnedSnapshotArtifacts(own.input), { code: 'snapshot_reader_hash_mismatch' })
  } finally { await own.dispose() }
})

test('rejects missing and extra inventory files', async () => {
  const own = await fixture()
  try {
    const extra = path.join(own.captured.artifactDirectory, 'secret.txt')
    await fs.writeFile(extra, 'not exposed', { mode: 0o600 })
    await assert.rejects(readOwnedSnapshotArtifacts(own.input), { code: 'snapshot_reader_inventory_mismatch' })
    await fs.unlink(extra)
    await fs.unlink(path.join(own.captured.artifactDirectory, 'theme/index.php'))
    await assert.rejects(readOwnedSnapshotArtifacts(own.input), { code: 'snapshot_reader_inventory_mismatch' })
  } finally { await own.dispose() }
})

test('rejects path traversal and symlinked file/parent', async () => {
  const own = await fixture()
  try {
    await assert.rejects(readOwnedSnapshotArtifacts({ ...own.input, snapshotId: '../outside' }), { code: 'snapshot_reader_failed' })
    const filename = path.join(own.captured.artifactDirectory, 'theme/index.php')
    await fs.unlink(filename)
    await fs.symlink(path.join(own.statePath, 'record.json'), filename)
    await assert.rejects(readOwnedSnapshotArtifacts(own.input), { code: 'snapshot_reader_unsafe_file' })
    await fs.unlink(filename)
    const theme = path.dirname(filename)
    await fs.rmdir(theme)
    await fs.symlink(own.statePath, theme)
    await assert.rejects(readOwnedSnapshotArtifacts(own.input), { code: 'snapshot_reader_unsafe_file' })
  } finally { await own.dispose() }
})

test('rejects hardlinked or non-private artifacts', async () => {
  const own = await fixture()
  try {
    const filename = path.join(own.captured.artifactDirectory, 'database.sqlite')
    const linked = path.join(own.directory, 'linked.sqlite')
    await fs.link(filename, linked)
    await assert.rejects(readOwnedSnapshotArtifacts(own.input), { code: 'snapshot_reader_unsafe_file' })
    await fs.unlink(linked)
    await fs.chmod(filename, 0o644)
    await assert.rejects(readOwnedSnapshotArtifacts(own.input), { code: 'snapshot_reader_unsafe_file' })
  } finally { await own.dispose() }
})

test('rejects oversized sparse database before allocation and never logs bytes in errors', async () => {
  const own = await fixture()
  try {
    await fs.truncate(path.join(own.captured.artifactDirectory, 'database.sqlite'), 512 * 1024 * 1024 + 1)
    await assert.rejects(readOwnedSnapshotArtifacts(own.input), { code: 'snapshot_reader_unsafe_file', message: '[internal] snapshot_reader_unsafe_file' })
  } finally { await own.dispose() }
})

test('refuses retained operation lock without removing it', async () => {
  const own = await fixture()
  try {
    await fs.mkdir(path.join(own.statePath, 'operation.lock'), { mode: 0o700 })
    await assert.rejects(readOwnedSnapshotArtifacts(own.input), { code: 'snapshot_reader_site_busy' })
    assert.ok((await fs.stat(path.join(own.statePath, 'operation.lock'))).isDirectory())
  } finally { await own.dispose() }
})

test('rejects altered ownership request hash and non-ready owner', async () => {
  const own = await fixture()
  try {
    const filename = path.join(own.statePath, 'record.json')
    const record = JSON.parse(await fs.readFile(filename, 'utf8'))
    await fs.writeFile(filename, JSON.stringify({ ...record, requestHash: 'b'.repeat(64) }))
    await assert.rejects(readOwnedSnapshotArtifacts(own.input), { code: 'snapshot_reader_ownership_mismatch' })
    await fs.writeFile(filename, JSON.stringify({ ...record, status: 'creating' }))
    await assert.rejects(readOwnedSnapshotArtifacts(own.input), { code: 'snapshot_reader_ownership_mismatch' })
  } finally { await own.dispose() }
})

test('rejects manifest corruption and unsafe theme names before file access', async () => {
  const own = await fixture()
  try {
    const manifest = JSON.parse(await fs.readFile(own.captured.manifestPath, 'utf8'))
    await fs.writeFile(own.captured.manifestPath, JSON.stringify({ ...manifest, databaseHash: 'b'.repeat(64) }))
    await assert.rejects(readOwnedSnapshotArtifacts(own.input), { code: 'snapshot_reader_manifest_mismatch' })
    await assert.rejects(readOwnedSnapshotArtifacts({ ...own.input, snapshot: { ...own.input.snapshot, themeFiles: { '../record.json': 'b'.repeat(64) } } }), { code: 'snapshot_reader_failed' })
  } finally { await own.dispose() }
})
