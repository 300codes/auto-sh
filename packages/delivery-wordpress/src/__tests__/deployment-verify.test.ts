import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import test from 'node:test'
import { verifyOwnedDeploymentPackage } from '../deployment-verify.ts'
import { savedDeploymentFixture } from './fixtures/saved-deployment.ts'

test('verifies an actual captured package offline without changing source, package or publication status', async () => {
  const context = await savedDeploymentFixture()
  try {
    const before = await fs.readFile(context.manifestFile)
    const result = await verifyOwnedDeploymentPackage(context.input)
    assert.equal(result.fileCount, 3)
    assert.equal(result.packageHash, context.captured.packageHash)
    assert.equal(result.verification, 'saved_package_bytes_only')
    assert.equal(result.publication, 'not_authorized')
    assert.equal(result.remoteRevision, 'not_verified')
    assert.equal(result.provenance, 'fixture')
    assert.equal(result.checks.databaseSecrets, 'not_evaluated')
    assert.deepEqual(await fs.readFile(context.manifestFile), before)
    await assert.rejects(fs.stat(path.join(context.statePath, 'operation.lock')), { code: 'ENOENT' })
  } finally { await context.dispose() }
})

for (const mode of ['modified', 'missing', 'unknown', 'unknown-root', 'unknown-empty-directory', 'symlink', 'hardlink', 'public-mode'] as const) {
  test(`saved package refuses ${mode} content`, async () => {
    const context = await savedDeploymentFixture()
    try {
      const filename = context.filename('wp-content/uploads/image.png')
      if (mode === 'modified') await fs.writeFile(filename, 'changed bytes')
      if (mode === 'missing') await fs.rm(filename)
      if (mode === 'unknown') await fs.writeFile(context.filename('wp-content/uploads/unknown'), 'extra', { mode: 0o600 })
      if (mode === 'unknown-root') await fs.writeFile(path.join(context.packageDirectory, 'secret'), 'extra', { mode: 0o600 })
      if (mode === 'unknown-empty-directory') await fs.mkdir(context.filename('wp-content/unknown'), { mode: 0o700 })
      if (mode === 'symlink' || mode === 'hardlink') {
        const outside = path.join(context.directory, 'outside')
        await fs.writeFile(outside, 'fixture image', { mode: 0o600 })
        await fs.rm(filename)
        if (mode === 'symlink') await fs.symlink(outside, filename)
        else await fs.link(outside, filename)
      }
      if (mode === 'public-mode') await fs.chmod(filename, 0o644)
      await assert.rejects(verifyOwnedDeploymentPackage(context.input), /deployment_verify_|UNSAFE_PATH/)
    } finally { await context.dispose() }
  })
}

test('rejects foreign scope, different expected hash and a symlinked package root', async () => {
  const context = await savedDeploymentFixture()
  try {
    await assert.rejects(verifyOwnedDeploymentPackage({ ...context.input, scope: { ...context.input.scope, organizationId: randomUUID() } }), /ownership_mismatch/)
    await assert.rejects(verifyOwnedDeploymentPackage({ ...context.input, expectedPackageHash: '0'.repeat(64) }), /hash_mismatch/)
    const original = path.join(context.directory, 'original-package')
    await fs.rename(context.packageDirectory, original)
    await fs.symlink(original, context.packageDirectory)
    await assert.rejects(verifyOwnedDeploymentPackage(context.input), /UNSAFE_PATH/)
  } finally { await context.dispose() }
})

for (const mode of ['traversal', 'duplicate', 'case-collision', 'file-directory-collision', 'source-hash', 'database-hash', 'oversize'] as const) {
  test(`refuses a newly hash-bound but invalid manifest: ${mode}`, async () => {
    const context = await savedDeploymentFixture()
    try {
      const input = await context.editManifest((manifest) => {
        const original = manifest.files.find((file) => file.path.endsWith('image.png'))!
        if (mode === 'traversal') original.path = 'wp-content/../outside'
        if (mode === 'duplicate') manifest.files.push({ ...original })
        if (mode === 'case-collision') manifest.files.push({ ...original, path: 'wp-content/uploads/Image.png' })
        if (mode === 'file-directory-collision') manifest.files.push({ ...original, path: 'wp-content/uploads' })
        if (mode === 'source-hash') manifest.sourceManifestHash = '0'.repeat(64)
        if (mode === 'database-hash') manifest.database.sha256 = '0'.repeat(64)
        if (mode === 'oversize') original.sizeBytes = 65 * 1024 * 1024
        manifest.files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
      })
      await assert.rejects(verifyOwnedDeploymentPackage(input), /invalid_input|deployment_verify_/)
    } finally { await context.dispose() }
  })
}
