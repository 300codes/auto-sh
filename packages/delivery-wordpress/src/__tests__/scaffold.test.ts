import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { scaffoldTheme } from '../scaffold.ts'

test('scaffold creates an independent block theme and refuses overwrite', async () => {
  const site = await mkdtemp(join(tmpdir(), 'wp-scaffold-'))
  try {
    await mkdir(join(site, 'wp-content', 'themes'), { recursive: true })
    const result = await scaffoldTheme(site, 'open-mercato', 'Open Mercato')
    assert.ok(result.files.includes('templates/front-page.html'))
    assert.ok(result.files.includes('inc/setup.php'))
    assert.match(await readFile(join(result.themePath, 'style.css'), 'utf8'), /^\/\*\nTheme Name: Open Mercato/)
    assert.equal((await readFile(join(result.themePath, 'style.css'), 'utf8')).trim().endsWith('*/'), true)
    assert.match(await readFile(join(result.themePath, 'inc/setup.php'), 'utf8'), /load_theme_textdomain/)
    await writeFile(join(result.themePath, 'custom.txt'), 'preserve')
    await assert.rejects(scaffoldTheme(site, 'open-mercato', 'Changed'), /\[internal\]/)
    assert.equal(await readFile(join(result.themePath, 'custom.txt'), 'utf8'), 'preserve')
    await assert.rejects(scaffoldTheme(site, '../escape', 'Title'), /\[internal\]/)
    await assert.rejects(scaffoldTheme(site, 'safe', 'Title */ malicious'), /\[internal\]/)
  } finally {
    await rm(site, { recursive: true, force: true })
  }
})

test('scaffold rejects a symlinked parent directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wp-scaffold-'))
  try {
    await mkdir(join(root, 'site'))
    await mkdir(join(root, 'outside', 'themes'), { recursive: true })
    await symlink(join(root, 'outside'), join(root, 'site', 'wp-content'))
    await assert.rejects(scaffoldTheme(join(root, 'site'), 'safe', 'Title'), /\[internal\]/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
