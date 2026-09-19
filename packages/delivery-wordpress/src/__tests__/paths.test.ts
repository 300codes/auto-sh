import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, symlink, stat, rm, chmod } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ensurePrivateRoot, assertSafeDirectory, assertContainedPath, assertRegularFile } from '../paths.ts'

test('private roots and containment reject traversal, symlinks and nonregular paths', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'studio-paths-'))
  try {
    const root = path.join(directory, 'owned', 'sites')
    assert.equal(await ensurePrivateRoot(root), root)
    assert.equal((await stat(root)).mode & 0o777, 0o700)
    assert.equal(await assertSafeDirectory(root), root)
    await assertContainedPath(root, path.join(root, 'missing', 'leaf'))
    await assert.rejects(assertContainedPath(root, path.join(root, '..', 'outside')), /UNSAFE_PATH/)
    await assert.rejects(assertContainedPath(root, `${root}-sibling`), /UNSAFE_PATH/)
    await assert.rejects(ensurePrivateRoot('relative'), /UNSAFE_PATH/)
    const file = path.join(root, 'regular')
    await writeFile(file, 'safe')
    await assertRegularFile(file)
    await assertContainedPath(root, file)
    await assert.rejects(assertSafeDirectory(file), /UNSAFE_PATH/)
    await assert.rejects(assertRegularFile(root), /UNSAFE_PATH/)
    const outside = path.join(directory, 'outside')
    await mkdir(outside)
    await chmod(outside, 0o777)
    await assert.rejects(ensurePrivateRoot(outside), /UNSAFE_PATH/)
    assert.equal((await stat(outside)).mode & 0o777, 0o777)
    const link = path.join(root, 'link')
    await symlink(outside, link)
    await assert.rejects(ensurePrivateRoot(path.join(link, 'new')), /UNSAFE_PATH/)
    await assert.rejects(assertSafeDirectory(link), /UNSAFE_PATH/)
    await assert.rejects(assertContainedPath(root, path.join(link, 'missing')), /UNSAFE_PATH/)
    const fileLink = path.join(root, 'file-link')
    await symlink(file, fileLink)
    await assert.rejects(assertContainedPath(root, fileLink), /UNSAFE_PATH/)
    await assert.rejects(assertRegularFile(fileLink), /UNSAFE_PATH/)
    const broken = path.join(root, 'broken')
    await symlink(path.join(directory, 'absent'), broken)
    await assert.rejects(assertContainedPath(root, broken), /UNSAFE_PATH/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
