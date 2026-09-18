import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { createSiteRequestSchema, parseInput, siteResultSchema, toolError } from './contracts.ts'
import type { CreateSiteRequest, Scope } from './contracts.ts'
import { assertContainedPath, assertRegularFile, assertSafeDirectory, ensurePrivateRoot } from './paths.ts'

export const recordSchema = z.object({
  schemaVersion: z.literal(1),
  request: createSiteRequestSchema,
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(['creating', 'ready']),
  result: siteResultSchema.optional(),
}).strict()

export type SiteRecord = z.infer<typeof recordSchema>

export function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function siteIdFor(scope: Scope): string {
  return hashValue(JSON.stringify([scope.tenantId, scope.organizationId, scope.projectId]))
}

export function requestHashFor(request: CreateSiteRequest): string {
  return hashValue(JSON.stringify([
    'create', request.scope.tenantId, request.scope.organizationId, request.scope.projectId,
    request.attemptId, request.idempotencyKey, request.name, request.themeSlug,
  ]))
}

export async function readRecord(directory: string): Promise<SiteRecord> {
  const filename = path.join(directory, 'record.json')
  await assertRegularFile(filename)
  const info = await fs.stat(filename)
  if (info.size > 64 * 1024) throw toolError('invalid_ownership_record')
  try {
    return parseInput(recordSchema, JSON.parse(await fs.readFile(filename, 'utf8')))
  } catch {
    throw toolError('invalid_ownership_record')
  }
}

export async function writeRecord(directory: string, record: SiteRecord): Promise<void> {
  await assertSafeDirectory(directory)
  const temporary = path.join(directory, `record-${randomUUID()}.tmp`)
  const destination = path.join(directory, 'record.json')
  await assertContainedPath(directory, destination)
  await fs.writeFile(temporary, JSON.stringify(parseInput(recordSchema, record), null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  await fs.rename(temporary, destination)
}

export async function withSiteLock<Value>(directory: string, work: () => Promise<Value>): Promise<Value> {
  await assertSafeDirectory(directory)
  const lock = path.join(directory, 'operation.lock')
  try {
    await fs.mkdir(lock, { mode: 0o700 })
  } catch {
    throw toolError('site_busy_or_reconciliation_required')
  }
  const result = await work()
  await fs.rmdir(lock)
  return result
}

export async function initializeRoots(sitesRoot: string, stateRoot: string) {
  if (!path.isAbsolute(sitesRoot) || !path.isAbsolute(stateRoot)) throw toolError('absolute_roots_required')
  const sites = path.resolve(sitesRoot)
  const state = path.resolve(stateRoot)
  for (const [parent, child] of [[sites, state], [state, sites]]) {
    const relative = path.relative(parent, child)
    if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
      throw toolError('overlapping_roots')
    }
  }
  return { sitesRoot: await ensurePrivateRoot(sites), stateRoot: await ensurePrivateRoot(state) }
}
