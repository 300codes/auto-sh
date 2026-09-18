import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, lstat, mkdir, mkdtemp, open, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'
import { assertContainedPath, assertRegularFile, assertSafeDirectory, ensurePrivateRoot } from './paths.ts'

const maximumFiles = 2048
const maximumFileBytes = 16 * 1024 * 1024
const maximumThemeBytes = 64 * 1024 * 1024
const maximumDatabaseBytes = 512 * 1024 * 1024
const allowedExtensions = new Set(['.php', '.css', '.json', '.html', '.js', '.mjs', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.txt', '.md', '.po', '.mo', '.pot'])

function digest(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

export async function captureSiteSnapshot(input: { sitePath: string; themeSlug: string; artifactRoot: string }): Promise<{ contentHash: string; themeFiles: Record<string, string>; databaseHash: string; manifestPath: string; artifactDirectory: string }> {
  let artifactDirectory: string | undefined
  try {
    if (!/^[a-z][a-z0-9-]{0,59}$/.test(input.themeSlug)) throw new Error('[internal] Invalid theme slug')
    await assertSafeDirectory(input.sitePath)
    const themePath = join(input.sitePath, 'wp-content', 'themes', input.themeSlug)
    const databasePath = join(input.sitePath, 'wp-content', 'database', '.ht.sqlite')
    await assertSafeDirectory(themePath)
    await assertRegularFile(databasePath)
    const siteRoot = resolve(input.sitePath)
    const artifactsRoot = resolve(input.artifactRoot)
    if (artifactsRoot === siteRoot || artifactsRoot.startsWith(siteRoot + '/') || siteRoot.startsWith(artifactsRoot + '/')) {
      throw new Error('[internal] Snapshot root overlaps site')
    }
    await ensurePrivateRoot(artifactsRoot)
    artifactDirectory = await mkdtemp(join(artifactsRoot, 'snapshot-'))
    await chmod(artifactDirectory, 0o700)
    const frozenThemePath = join(artifactDirectory, 'theme')
    await mkdir(frozenThemePath, { mode: 0o700 })
    const themeFiles: Record<string, string> = {}
    let totalBytes = 0
    let visitedEntries = 0
    async function freezeDirectory(relativeDirectory: string, depth: number): Promise<void> {
      if (depth > 20) throw new Error('[internal] Theme depth limit exceeded')
      const sourceDirectory = join(themePath, relativeDirectory)
      await assertSafeDirectory(sourceDirectory)
      const entries = await readdir(sourceDirectory, { withFileTypes: true })
      entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
      for (const entry of entries) {
        visitedEntries += 1
        if (visitedEntries > maximumFiles) throw new Error('[internal] Theme entry limit exceeded')
        if (entry.isSymbolicLink()) throw new Error('[internal] Theme symlink rejected')
        if (entry.name.startsWith('.') || /(?:^|[-_.])(secret|secrets|credentials?|tokens?|keys?|logs?)(?:[-_.]|$)/i.test(entry.name)) continue
        const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name
        const source = join(themePath, relativePath)
        const target = join(frozenThemePath, relativePath)
        await assertContainedPath(themePath, source)
        if (entry.isDirectory()) {
          if (['node_modules', 'vendor', 'logs'].includes(entry.name)) continue
          await mkdir(target, { mode: 0o700 })
          await freezeDirectory(relativePath, depth + 1)
        } else if (entry.isFile() && allowedExtensions.has(extname(entry.name).toLowerCase())) {
          await assertRegularFile(source)
          const handle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW)
          try {
            const metadata = await handle.stat()
            if (!metadata.isFile() || metadata.size > maximumFileBytes || totalBytes + metadata.size > maximumThemeBytes) throw new Error('[internal] Theme size limit exceeded')
            const content = await handle.readFile()
            totalBytes += content.length
            if (content.length > maximumFileBytes || totalBytes > maximumThemeBytes) throw new Error('[internal] Theme size limit exceeded')
            await writeFile(target, content, { flag: 'wx', mode: 0o600 })
          } finally {
            await handle.close()
          }
          themeFiles[relativePath] = digest(await readFile(target))
        }
      }
    }
    await freezeDirectory('', 0)
    if (Object.keys(themeFiles).length === 0) throw new Error('[internal] Empty theme snapshot')
    const databaseTarget = join(artifactDirectory, 'database.sqlite')
    await assertSafeDirectory(dirname(databasePath))
    await assertRegularFile(databasePath)
    for (const suffix of ['-wal', '-shm', '-journal']) {
      try {
        await lstat(databasePath + suffix)
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue
        throw error
      }
      await assertRegularFile(databasePath + suffix)
    }
    const database = new DatabaseSync(databasePath, { readOnly: true })
    try {
      const pageCount = database.prepare('PRAGMA page_count').get()?.page_count
      const pageSize = database.prepare('PRAGMA page_size').get()?.page_size
      if (typeof pageCount !== 'number' || typeof pageSize !== 'number' || pageCount * pageSize > maximumDatabaseBytes) throw new Error('[internal] Database size limit exceeded')
      await backup(database, databaseTarget)
    } finally {
      database.close()
    }
    await chmod(databaseTarget, 0o600)
    if ((await stat(databaseTarget)).size > maximumDatabaseBytes) throw new Error('[internal] Database size limit exceeded')
    const databaseHash = digest(await readFile(databaseTarget))
    const sortedThemeFiles = Object.fromEntries(Object.entries(themeFiles).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0))
    const canonicalManifest = { schemaVersion: 1, databaseHash, themeFiles: sortedThemeFiles }
    const contentHash = digest(JSON.stringify(canonicalManifest))
    const manifestPath = join(artifactDirectory, 'manifest.json')
    await writeFile(manifestPath, JSON.stringify({ ...canonicalManifest, algorithm: 'sha256', contentHash }, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    return { contentHash, themeFiles: sortedThemeFiles, databaseHash, manifestPath, artifactDirectory }
  } catch {
    if (artifactDirectory) await rm(artifactDirectory, { recursive: true, force: true }).catch(() => undefined)
    throw new Error('[internal] Site snapshot failed')
  }
}
