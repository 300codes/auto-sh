import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import test from 'node:test'
import { prepareOwnedPreviewStaging } from '../preview-staging.ts'
import { savedDeploymentFixture } from './fixtures/saved-deployment.ts'

const stageFor = (context: Awaited<ReturnType<typeof savedDeploymentFixture>>) => path.join(context.statePath, 'preview-staging', context.input.packageId)

test('copies frozen bytes privately, binds parent hash, and revalidates an idempotent replay without Studio', async () => {
  const context = await savedDeploymentFixture()
  try {
    const first = await prepareOwnedPreviewStaging(context.input)
    const directory = stageFor(context)
    const recordBefore = await fs.readFile(path.join(directory, 'stage.json'))
    assert.equal(first.packageHash, context.captured.packageHash)
    assert.equal(first.provenance, 'fixture')
    assert.equal(first.publication, 'not_authorized')
    assert.equal(first.remoteRevision, 'not_verified')
    assert.equal(first.frozenPackageUpload, 'requires_host_integration')
    assert.equal(first.registeredSiteBinding, 'not_established')
    assert.equal(first.upload, 'not_run')
    assert.equal(first.checks.databaseSecrets, 'not_evaluated')
    assert.equal(first.fileCount, 3)
    for (const file of context.captured.manifest.files) {
      const staged = path.join(directory, 'site', file.path)
      assert.deepEqual(await fs.readFile(staged), await fs.readFile(context.filename(file.path)))
      const stat = await fs.lstat(staged)
      assert.equal(stat.mode & 0o077, 0)
      assert.equal(stat.nlink, 1)
      assert.notEqual(stat.ino, (await fs.lstat(context.filename(file.path))).ino)
    }
    assert.deepEqual(await prepareOwnedPreviewStaging(context.input), first)
    assert.deepEqual(await fs.readFile(path.join(directory, 'stage.json')), recordBefore)
    await assert.rejects(fs.stat(path.join(context.statePath, 'operation.lock')), { code: 'ENOENT' })
    assert.equal(JSON.stringify(first).includes(context.directory), false)
  } finally { await context.dispose() }
})

for (const mode of ['modified', 'missing', 'extra-file', 'extra-directory', 'symlink', 'hardlink', 'public-file', 'public-directory', 'record-tamper', 'root-symlink'] as const) {
  test(`replay refuses ${mode} staging without repairing it`, async () => {
    const context = await savedDeploymentFixture()
    try {
      await prepareOwnedPreviewStaging(context.input)
      const root = stageFor(context)
      const filename = path.join(root, 'site/wp-content/uploads/image.png')
      if (mode === 'modified') await fs.writeFile(filename, 'changed')
      if (mode === 'missing') await fs.rm(filename)
      if (mode === 'extra-file') await fs.writeFile(path.join(root, 'extra'), 'unapproved', { mode: 0o600 })
      if (mode === 'extra-directory') await fs.mkdir(path.join(root, 'site/wp-content/extra'), { mode: 0o700 })
      if (mode === 'symlink' || mode === 'hardlink') {
        await fs.rm(filename)
        if (mode === 'symlink') await fs.symlink(context.filename('wp-content/uploads/image.png'), filename)
        else {
          const outside = path.join(context.directory, 'hardlink-target')
          await fs.writeFile(outside, await fs.readFile(context.filename('wp-content/uploads/image.png')), { mode: 0o600 })
          await fs.link(outside, filename)
        }
      }
      if (mode === 'public-file') await fs.chmod(filename, 0o644)
      if (mode === 'public-directory') await fs.chmod(path.dirname(filename), 0o755)
      if (mode === 'record-tamper') {
        const descriptor = path.join(root, 'stage.json')
        const record = JSON.parse(await fs.readFile(descriptor, 'utf8'))
        record.parentPackageHash = '0'.repeat(64)
        await fs.writeFile(descriptor, JSON.stringify(record))
      }
      if (mode === 'root-symlink') {
        const moved = path.join(context.directory, 'moved-stage')
        await fs.rename(root, moved)
        await fs.symlink(moved, root)
      }
      await assert.rejects(prepareOwnedPreviewStaging(context.input), /preview_staging_|deployment_verify_|UNSAFE_PATH/)
    } finally { await context.dispose() }
  })
}

test('refuses foreign scope, wrong approved hash and changed frozen source before staging', async () => {
  const context = await savedDeploymentFixture()
  try {
    await assert.rejects(prepareOwnedPreviewStaging({ ...context.input, scope: { ...context.input.scope, tenantId: randomUUID() } }), /ownership_mismatch/)
    await assert.rejects(prepareOwnedPreviewStaging({ ...context.input, expectedPackageHash: '0'.repeat(64) }), /hash_mismatch/)
    await fs.writeFile(context.filename('wp-content/uploads/image.png'), 'changed source')
    await assert.rejects(prepareOwnedPreviewStaging(context.input), /deployment_verify_/)
    await assert.rejects(fs.stat(stageFor(context)), { code: 'ENOENT' })
  } finally { await context.dispose() }
})

test('rejects a copy-time source mutation and retains an explicit reconciliation lock', async (testContext) => {
  const context = await savedDeploymentFixture()
  const originalOpen = fs.open.bind(fs)
  let changed = false
  try {
    testContext.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
      if (!changed && String(args[0]).includes('/preview-staging/.pending-') && String(args[0]).endsWith('/image.png')) {
        changed = true
        await fs.writeFile(context.filename('wp-content/uploads/image.png'), 'copy-time mutation')
      }
      return originalOpen(...args)
    })
    await assert.rejects(prepareOwnedPreviewStaging(context.input), /preview_staging_changed/)
    assert.equal(changed, true)
    await assert.rejects(fs.stat(stageFor(context)), { code: 'ENOENT' })
    assert.equal((await fs.stat(path.join(context.statePath, 'operation.lock'))).isDirectory(), true)
    await assert.rejects(prepareOwnedPreviewStaging(context.input), /deployment_verify_|site_busy_or_reconciliation_required/)
  } finally { testContext.mock.restoreAll(); await context.dispose() }
})

test('stages the frozen package even when the mutable registered site has changed', async () => {
  const context = await savedDeploymentFixture()
  try {
    const relative = 'wp-content/uploads/image.png'
    const frozen = await fs.readFile(context.filename(relative))
    await fs.writeFile(path.join(context.sitePath, relative), 'later local edit, not approved')
    await prepareOwnedPreviewStaging(context.input)
    assert.deepEqual(await fs.readFile(path.join(stageFor(context), 'site', relative)), frozen)
  } finally { await context.dispose() }
})

test('revalidates the parent after copying and refuses a changed source before stage publication', async (testContext) => {
  const context = await savedDeploymentFixture()
  const originalOpen = fs.open.bind(fs)
  let changed = false
  try {
    testContext.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
      if (!changed && String(args[0]).includes('/preview-staging/.pending-') && String(args[0]).endsWith('/stage.json') && args[1] === 'wx') {
        changed = true
        await fs.writeFile(context.filename('wp-content/uploads/image.png'), 'mutation after copied bytes')
      }
      return originalOpen(...args)
    })
    await assert.rejects(prepareOwnedPreviewStaging(context.input), /deployment_verify_bytes_mismatch/)
    assert.equal(changed, true)
    await assert.rejects(fs.stat(stageFor(context)), { code: 'ENOENT' })
    assert.equal((await fs.stat(path.join(context.statePath, 'operation.lock'))).isDirectory(), true)
  } finally { testContext.mock.restoreAll(); await context.dispose() }
})
