import { lstat, mkdir, realpath } from 'node:fs/promises'
import path from 'node:path'

function failure(): Error & { code: string } {
  return Object.assign(new Error('[internal] UNSAFE_PATH'), { code: 'UNSAFE_PATH' })
}

function absolute(input: string): string {
  if (typeof input !== 'string' || !path.isAbsolute(input) || input.includes('\0')) throw failure()
  return path.resolve(input)
}

async function inspect(input: string, options: { create?: boolean; allowMissing?: boolean; file?: boolean } = {}): Promise<string> {
  const target = absolute(input)
  const segments = target.slice(path.parse(target).root.length).split(path.sep).filter(Boolean)
  let cursor = path.parse(target).root
  for (const [index, segment] of segments.entries()) {
    cursor = path.join(cursor, segment)
    try {
      let metadata
      try {
        metadata = await lstat(cursor)
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
        if (options.create) {
          try { await mkdir(cursor, { mode: 0o700 }) } catch (creationError) {
            if (!(creationError instanceof Error) || !('code' in creationError) || creationError.code !== 'EEXIST') throw creationError
          }
          metadata = await lstat(cursor)
        } else if (options.allowMissing) return target
        else throw error
      }
      const finalFile = options.file && index === segments.length - 1
      if (metadata.isSymbolicLink() || (finalFile ? !metadata.isFile() : !metadata.isDirectory())) throw failure()
    } catch {
      throw failure()
    }
  }
  if (options.file && segments.length === 0) throw failure()
  return target
}

export async function ensurePrivateRoot(root: string): Promise<string> {
  const target = await inspect(root, { create: true })
  const metadata = await lstat(target)
  if ((metadata.mode & 0o077) !== 0) throw failure()
  return target
}

export async function assertSafeDirectory(directory: string): Promise<string> {
  const target = await inspect(directory)
  if (await realpath(target) !== target) throw failure()
  return target
}

export async function assertContainedPath(root: string, target: string): Promise<void> {
  const resolvedRoot = await assertSafeDirectory(root)
  const resolvedTarget = absolute(target)
  const relative = path.relative(resolvedRoot, resolvedTarget)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw failure()
  try {
    const metadata = await lstat(resolvedTarget)
    await inspect(resolvedTarget, { file: metadata.isFile(), allowMissing: true })
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      await inspect(resolvedTarget, { allowMissing: true })
      return
    }
    throw failure()
  }
}

export async function assertRegularFile(filename: string): Promise<void> {
  await inspect(filename, { file: true })
}
