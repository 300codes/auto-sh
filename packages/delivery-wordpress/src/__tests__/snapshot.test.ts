import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { scaffoldTheme } from '../scaffold.ts'
import { captureSiteSnapshot } from '../snapshot.ts'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'wp-snapshot-'))
  const sitePath = join(root, 'site')
  await mkdir(join(sitePath, 'wp-content', 'themes'), { recursive: true })
  await mkdir(join(sitePath, 'wp-content', 'database'))
  const { themePath } = await scaffoldTheme(sitePath, 'open-mercato', 'Open Mercato')
  const databasePath = join(sitePath, 'wp-content', 'database', '.ht.sqlite')
  const database = new DatabaseSync(databasePath)
  database.exec('PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0; CREATE TABLE sample (value TEXT); INSERT INTO sample VALUES (\'first\')')
  return { root, themePath, databasePath, database, input: { sitePath, themeSlug: 'open-mercato', artifactRoot: join(root, 'artifacts') } }
}

test('snapshot includes uncheckpointed WAL rows and changes hashes with content', async () => {
  const state = await fixture()
  try {
    assert.ok((await stat(state.databasePath + '-wal')).size > 0)
    const first = await captureSiteSnapshot(state.input)
    const captured = new DatabaseSync(join(first.artifactDirectory, 'database.sqlite'), { readOnly: true })
    try {
      assert.equal(captured.prepare('SELECT value FROM sample').get()?.value, 'first')
    } finally {
      captured.close()
    }
    const repeated = await captureSiteSnapshot(state.input)
    assert.equal(repeated.contentHash, first.contentHash)
    await writeFile(join(state.themePath, 'assets/css/base.css'), 'body { margin: 1rem; }')
    const changedTheme = await captureSiteSnapshot(state.input)
    assert.notEqual(changedTheme.contentHash, first.contentHash)
    assert.equal(changedTheme.databaseHash, first.databaseHash)
    assert.notEqual(changedTheme.themeFiles['assets/css/base.css'], first.themeFiles['assets/css/base.css'])
    state.database.exec("INSERT INTO sample VALUES ('second')")
    const changedDatabase = await captureSiteSnapshot(state.input)
    assert.notEqual(changedDatabase.contentHash, changedTheme.contentHash)
    assert.notEqual(changedDatabase.databaseHash, changedTheme.databaseHash)
    assert.equal((await stat(changedDatabase.artifactDirectory)).mode & 0o777, 0o700)
    assert.equal((await stat(join(changedDatabase.artifactDirectory, 'database.sqlite'))).mode & 0o777, 0o600)
    const manifest = await readFile(first.manifestPath, 'utf8')
    assert.ok(!manifest.includes(state.root))
    assert.equal(JSON.parse(manifest).contentHash, first.contentHash)
  } finally {
    state.database.close()
    await rm(state.root, { recursive: true, force: true })
  }
})

test('snapshot excludes secret files and Git metadata, rejects symlinks and oversized files', async () => {
  const state = await fixture()
  try {
    await writeFile(join(state.themePath, '.env'), 'PRIVATE')
    await writeFile(join(state.themePath, 'private.key'), 'PRIVATE')
    await writeFile(join(state.themePath, 'credentials.json'), 'PRIVATE')
    await writeFile(join(state.themePath, 'debug.log'), 'PRIVATE')
    await mkdir(join(state.themePath, '.git'))
    await writeFile(join(state.themePath, '.git', 'config'), 'PRIVATE')
    const result = await captureSiteSnapshot(state.input)
    for (const excluded of ['.env', 'private.key', 'credentials.json', 'debug.log', '.git/config']) assert.equal(result.themeFiles[excluded], undefined)
    await symlink(join(state.root, 'external'), join(state.themePath, 'escape.css'))
    await assert.rejects(captureSiteSnapshot(state.input), /\[internal\]/)
    await rm(join(state.themePath, 'escape.css'))
    await writeFile(join(state.themePath, 'large.css'), Buffer.alloc(16 * 1024 * 1024 + 1))
    await assert.rejects(captureSiteSnapshot(state.input), /\[internal\]/)
  } finally {
    state.database.close()
    await rm(state.root, { recursive: true, force: true })
  }
})

test('snapshot rejects symlinked site parents and overlapping artifacts', async () => {
  const state = await fixture()
  try {
    await symlink(state.input.sitePath, join(state.root, 'alias'))
    await assert.rejects(captureSiteSnapshot({ ...state.input, sitePath: join(state.root, 'alias') }), /\[internal\]/)
    await assert.rejects(captureSiteSnapshot({ ...state.input, artifactRoot: join(state.themePath, 'snapshots') }), /\[internal\]/)
  } finally {
    state.database.close()
    await rm(state.root, { recursive: true, force: true })
  }
})

test('snapshot rejects a symlinked SQLite sidecar before opening the database', async () => {
  const state = await fixture()
  state.database.close()
  try {
    const outside = join(state.root, 'outside.sqlite-wal')
    await writeFile(outside, 'preserve')
    await symlink(outside, state.databasePath + '-wal')
    await assert.rejects(captureSiteSnapshot(state.input), /\[internal\]/)
    assert.equal(await readFile(outside, 'utf8'), 'preserve')
  } finally {
    await rm(state.root, { recursive: true, force: true })
  }
})

test('the scaffold ships what the delivery checks need to run at all', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wp-scaffold-checks-'))
  try {
    const sitePath = join(directory, 'site')
    await mkdir(join(sitePath, 'wp-content/themes'), { recursive: true, mode: 0o700 })
    const { themePath, files } = await scaffoldTheme(sitePath, 'aster-works', 'Aster Works')

    assert.ok(files.includes('composer.json'), 'composer run lint needs a composer.json')
    assert.ok(files.includes('playwright.config.ts'), 'npx playwright test needs a config')
    assert.ok(files.some((name) => name.startsWith('tests/')), 'the checks need a tests tree to run')
    const composer = JSON.parse(await readFile(join(themePath, 'composer.json'), 'utf8'))
    assert.match(composer.scripts.lint, /php -l/, 'lint must work without installing a vendor tree')
  } finally { await rm(directory, { recursive: true, force: true }) }
})
