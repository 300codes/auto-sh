import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { captureOwnedDeploymentPackage } from '../deployment-manifest.ts'
import { requestHashFor, siteIdFor, writeRecord } from '../ownership.ts'
import type { CommandRunner } from '../runner.ts'

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wp-package-'))
  const config = { sitesRoot: path.join(directory, 'sites'), stateRoot: path.join(directory, 'state') }
  const scope = { tenantId: randomUUID(), organizationId: randomUUID(), projectId: randomUUID() }
  const handle = { siteId: siteIdFor(scope) }
  const sitePath = path.join(config.sitesRoot, handle.siteId)
  const statePath = path.join(config.stateRoot, handle.siteId)
  for (const folder of [config.sitesRoot, config.stateRoot, sitePath, statePath]) await fs.mkdir(folder, { mode: 0o700 })
  const request = { scope, attemptId: randomUUID(), idempotencyKey: 'package', name: 'Fixture', themeSlug: 'fixture' }
  await writeRecord(statePath, { schemaVersion: 1, request, requestHash: requestHashFor(request), status: 'ready', result: {
    schemaVersion: 1, provenance: 'fixture', siteId: handle.siteId, scope, attemptId: request.attemptId, toolExecutionId: randomUUID(), studioSiteId: 'fixture-studio', localUrl: 'http://localhost:9999', themeSlug: 'fixture', themeCommit: 'a'.repeat(40), createdAt: new Date().toISOString(), checks: [],
  } })
  const content = path.join(sitePath, 'wp-content')
  const files: Record<string, string> = {
    'themes/fixture/functions.php': '<?php echo "Fixture";', 'themes/fixture/assets/dist/tailwind.css': '.p-4{padding:1rem}',
    'plugins/fixture/tokens.php': '<?php /* legitimate runtime source */',
    'plugins/fixture/vendor/runtime.php': '<?php /* vendor runtime */',
    'plugins/fixture/node_modules/module/runtime.js': 'export default 1',
    'plugins/fixture/migration.sql': 'SELECT 1;', 'plugins/fixture/bundle.js.gz': 'synthetic compressed runtime',
    'mu-plugins/required.php': '<?php /* required runtime */', 'uploads/photo.png': 'synthetic image',
    'db.php': '<?php /* SQLite runtime drop-in */', 'cache/object.bin': 'private cache', 'backup/old.sql': 'private backup',
    '.env': 'PRIVATE_ENV_SECRET', 'debug.log': 'PRIVATE_LOG', 'plugins/source.zip': 'PRIVATE_ZIP', '.git/config': 'private origin',
  }
  for (const [relative, contentValue] of Object.entries(files)) {
    const filename = path.join(content, relative)
    await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 })
    await fs.writeFile(filename, contentValue)
  }
  await fs.writeFile(path.join(sitePath, 'wp-config.php'), '<?php /* PRIVATE_SALTS_PASSWORD */')
  await fs.mkdir(path.join(content, 'database'), { mode: 0o700 })
  const databasePath = path.join(content, 'database/.ht.sqlite')
  const database = new DatabaseSync(databasePath)
  database.exec('CREATE TABLE fixture (content TEXT); INSERT INTO fixture VALUES (\'native editor content\');')
  database.close()
  let running = false
  let calls = 0
  let changeOnFinalStatus = false
  const runner: CommandRunner = async (executable, args) => {
    assert.equal(executable, 'studio')
    assert.deepEqual(args, ['site', 'list', '--format', 'json'])
    calls += 1
    return { stdout: JSON.stringify([{ id: 'fixture-studio', path: sitePath, running: running || (changeOnFinalStatus && calls >= 3) }]), exitCode: 0 }
  }
  const input = { scope, handle, config, runtimeIdentity: { wordpressVersion: '6.9', phpVersion: '8.3', studioVersion: '1.19.0' } }
  return { directory, content, statePath, sitePath, databasePath, runner, input,
    packages: path.join(statePath, 'deployment-packages'),
    running: () => { running = true }, changeOnFinalStatus: () => { changeOnFinalStatus = true },
    dispose: () => fs.rm(directory, { recursive: true, force: true }),
  }
}

test('captures complete runtime content and consistent private DB; excludes explicit operational secrets', async () => {
  const context = await fixture()
  try {
    const report = await captureOwnedDeploymentPackage(context.input, { runner: context.runner })
    const staged = path.join(context.packages, report.packageId, 'site')
    const names = report.manifest.files.map((file) => file.path)
    for (const expected of ['wp-content/plugins/fixture/tokens.php', 'wp-content/plugins/fixture/vendor/runtime.php', 'wp-content/plugins/fixture/node_modules/module/runtime.js', 'wp-content/plugins/fixture/migration.sql', 'wp-content/plugins/fixture/bundle.js.gz', 'wp-content/mu-plugins/required.php', 'wp-content/uploads/photo.png', 'wp-content/db.php', 'wp-content/themes/fixture/assets/dist/tailwind.css', 'wp-content/database/.ht.sqlite']) assert.ok(names.includes(expected), expected)
    for (const excluded of ['wp-config.php', 'wp-content/.env', 'wp-content/debug.log', 'wp-content/plugins/source.zip', 'wp-content/cache/object.bin', 'wp-content/backup/old.sql', 'wp-content/.git/config']) await assert.rejects(fs.stat(path.join(staged, excluded)), { code: 'ENOENT' })
    assert.equal(report.manifest.configPolicy.wpConfig, 'omitted')
    assert.equal(report.manifest.runtimeIdentity.verification, 'operator_declared')
    assert.equal(report.manifest.checks.databaseSecrets, 'not_evaluated')
    assert.equal(report.publication, 'not_authorized')
    assert.equal(report.upload, 'not_run')
    assert.equal(report.provenance, 'fixture')
    for (const entry of report.manifest.files) {
      const bytes = await fs.readFile(path.join(staged, entry.path))
      assert.equal(entry.sha256, createHash('sha256').update(bytes).digest('hex'))
      assert.equal(entry.sizeBytes, bytes.length)
      assert.equal((await fs.stat(path.join(staged, entry.path))).mode & 0o077, 0)
    }
    const backup = new DatabaseSync(path.join(staged, 'wp-content/database/.ht.sqlite'), { readOnly: true })
    try { assert.equal(backup.prepare('SELECT content FROM fixture').get()?.content, 'native editor content') } finally { backup.close() }
    assert.equal(report.packageHash, createHash('sha256').update(JSON.stringify(report.manifest)).digest('hex'))
    assert.ok(!JSON.stringify(report).includes(context.directory))
    assert.ok(!JSON.stringify(report).includes('PRIVATE_'))
    assert.ok(report.manifest.excluded.some((entry) => entry.reason === 'private_configuration_omitted'))
    await assert.rejects(fs.stat(path.join(context.statePath, 'operation.lock')), { code: 'ENOENT' })
    await fs.writeFile(path.join(context.content, 'uploads/photo.png'), 'later media')
    assert.equal(await fs.readFile(path.join(staged, 'wp-content/uploads/photo.png'), 'utf8'), 'synthetic image')
  } finally { await context.dispose() }
})

test('repeated unchanged source produces stable package/source hashes and runtime identity is bound', async () => {
  const context = await fixture()
  try {
    const first = await captureOwnedDeploymentPackage(context.input, { runner: context.runner })
    const second = await captureOwnedDeploymentPackage(context.input, { runner: context.runner })
    assert.notEqual(first.packageId, second.packageId)
    assert.equal(first.packageHash, second.packageHash)
    assert.equal(first.sourceManifestHash, second.sourceManifestHash)
    const changed = await captureOwnedDeploymentPackage({ ...context.input, runtimeIdentity: { ...context.input.runtimeIdentity, phpVersion: '8.4' } }, { runner: context.runner })
    assert.notEqual(changed.packageHash, first.packageHash)
  } finally { await context.dispose() }
})

test('SQLite backup includes committed WAL without copying WAL/SHM into deployment', async () => {
  const context = await fixture()
  const database = new DatabaseSync(context.databasePath)
  try {
    database.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; INSERT INTO fixture VALUES ('committed WAL');")
    const report = await captureOwnedDeploymentPackage(context.input, { runner: context.runner })
    const target = path.join(context.packages, report.packageId, 'site/wp-content/database/.ht.sqlite')
    const saved = new DatabaseSync(target, { readOnly: true })
    try { assert.equal(saved.prepare('SELECT count(*) AS total FROM fixture').get()?.total, 2) } finally { saved.close() }
    assert.ok(report.manifest.sourceFiles.some((file) => file.path.endsWith('.ht.sqlite-wal')))
    assert.ok(!report.manifest.files.some((file) => /-(wal|shm|journal)$/.test(file.path)))
  } finally { database.close(); await context.dispose() }
})

test('final staged-byte verification rejects altered private capture', async () => {
  const context = await fixture()
  try {
    let calls = 0
    const runner: CommandRunner = async (...args) => {
      if (++calls === 3) {
        const [packageId] = await fs.readdir(context.packages)
        await fs.writeFile(path.join(context.packages, packageId!, 'site/wp-content/uploads/photo.png'), 'altered staging')
      }
      return context.runner(...args)
    }
    await assert.rejects(captureOwnedDeploymentPackage(context.input, { runner }), /deployment_staging_changed/)
    assert.deepEqual(await fs.readdir(context.packages), [])
  } finally { await context.dispose() }
})

test('cleanup failure is explicit and retains reconciliation lock', async (testContext) => {
  const context = await fixture()
  try {
    context.changeOnFinalStatus()
    const remove = fs.rm.bind(fs)
    const fault = testContext.mock.method(fs, 'rm', async (...args: Parameters<typeof fs.rm>) => {
      if (String(args[0]).startsWith(context.packages + path.sep)) throw new Error('PRIVATE_CLEANUP_FAILURE')
      return remove(...args)
    })
    await assert.rejects(captureOwnedDeploymentPackage(context.input, { runner: context.runner }), /deployment_cleanup_required/)
    fault.mock.restore()
    assert.equal((await fs.readdir(context.packages)).length, 1)
    assert.ok((await fs.stat(path.join(context.statePath, 'operation.lock'))).isDirectory())
  } finally { testContext.mock.restoreAll(); await context.dispose() }
})

for (const variant of ['foreign-scope', 'running', 'symlink', 'excluded-symlink', 'media-archive', 'runtime-archive', 'private-key', 'oversized', 'missing-database', 'missing-theme', 'source-change', 'started-during-capture'] as const) {
  test(`rejects ${variant} and removes only its incomplete package`, async (testContext) => {
    const context = await fixture()
    try {
      const input = { ...context.input }
      if (variant === 'foreign-scope') input.scope = { ...input.scope, tenantId: randomUUID() }
      if (variant === 'running') context.running()
      if (variant === 'symlink') await fs.symlink(context.databasePath, path.join(context.content, 'uploads/link'))
      if (variant === 'excluded-symlink') { await fs.rm(path.join(context.content, '.env')); await fs.symlink(context.databasePath, path.join(context.content, '.env')) }
      if (variant === 'media-archive') await fs.writeFile(path.join(context.content, 'uploads/client.zip'), 'not silently omitted')
      if (variant === 'runtime-archive') await fs.writeFile(path.join(context.content, 'plugins/fixture/required.zip'), 'not silently omitted')
      if (variant === 'private-key') await fs.writeFile(path.join(context.content, 'plugins/private.key'), 'PRIVATE_KEY')
      if (variant === 'oversized') await fs.truncate(path.join(context.content, 'uploads/photo.png'), 64 * 1024 * 1024 + 1)
      if (variant === 'missing-database') await fs.rm(context.databasePath)
      if (variant === 'missing-theme') await fs.rm(path.join(context.content, 'themes/fixture'), { recursive: true })
      if (variant === 'started-during-capture') context.changeOnFinalStatus()
      if (variant === 'source-change') {
        const readdir = fs.readdir.bind(fs)
        let scans = 0
        testContext.mock.method(fs, 'readdir', async (...args: Parameters<typeof fs.readdir>) => {
          if (args[0] === context.content && ++scans === 2) await fs.writeFile(path.join(context.content, 'uploads/photo.png'), 'concurrent change')
          return readdir(...args)
        })
      }
      await assert.rejects(captureOwnedDeploymentPackage(input, { runner: context.runner }))
      try { assert.deepEqual(await fs.readdir(context.packages), []) } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
      }
      assert.equal(await fs.readFile(path.join(context.sitePath, 'wp-config.php'), 'utf8'), '<?php /* PRIVATE_SALTS_PASSWORD */')
    } finally { testContext.mock.restoreAll(); await context.dispose() }
  })
}
