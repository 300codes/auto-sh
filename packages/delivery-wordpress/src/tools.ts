import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { createSiteRequestSchema, parseInput, scopeSchema, siteHandleSchema, siteResultSchema, toolError } from './contracts.ts'
import type { Scope, SiteHandle, SiteResult } from './contracts.ts'
import { initializeRoots, readRecord, requestHashFor, siteIdFor, withSiteLock, writeRecord } from './ownership.ts'
import { assertContainedPath, assertSafeDirectory, ensurePrivateRoot } from './paths.ts'
import { createCommandRunner, parseStudioJson } from './runner.ts'
import type { CommandRunner } from './runner.ts'
import { scaffoldTheme } from './scaffold.ts'
import { captureSiteSnapshot } from './snapshot.ts'

const studioSitesSchema = z.array(z.object({
  id: z.string().min(1),
  path: z.string(),
  running: z.boolean().optional(),
  isRunning: z.boolean().optional(),
  status: z.string().optional(),
  operation: z.unknown().optional(),
}))

export type StudioToolsConfig = {
  sitesRoot: string
  stateRoot: string
  timeoutMs?: number
}

export function createWordPressStudioTools(config: StudioToolsConfig, dependencies: { runner?: CommandRunner } = {}) {
  const runner = dependencies.runner ?? createCommandRunner({ timeoutMs: config.timeoutMs ?? 180_000 })
  const provenance = dependencies.runner ? 'fixture' as const : 'live' as const
  const roots = () => initializeRoots(config.sitesRoot, config.stateRoot)

  async function inventory(sitePath: string) {
    const response = await runner('studio', ['site', 'list', '--format', 'json'])
    const sites = parseInput(studioSitesSchema, parseStudioJson(response.stdout))
    const matches = sites.filter((site) => path.resolve(site.path) === sitePath)
    if (matches.length !== 1) throw toolError('site_registration_mismatch')
    const site = matches[0]
    const running = site.running ?? site.isRunning ??
      (site.status === 'running' ? true : site.status === 'stopped' ? false : undefined)
    if (running === undefined || site.operation) throw toolError('site_state_unknown')
    return { id: site.id, running }
  }

  async function owned(scopeValue: unknown, handleValue: unknown) {
    const scope = parseInput(scopeSchema, scopeValue)
    const handle = parseInput(siteHandleSchema, handleValue)
    if (siteIdFor(scope) !== handle.siteId) throw toolError('ownership_mismatch')
    const root = await roots()
    const directory = path.join(root.stateRoot, handle.siteId)
    const sitePath = path.join(root.sitesRoot, handle.siteId)
    await assertSafeDirectory(directory)
    await assertSafeDirectory(sitePath)
    const record = await readRecord(directory)
    if (siteIdFor(record.request.scope) !== handle.siteId || record.status !== 'ready' || !record.result) {
      throw toolError('reconciliation_required')
    }
    if (record.result.siteId !== handle.siteId || siteIdFor(record.result.scope) !== handle.siteId) {
      throw toolError('ownership_mismatch')
    }
    return { directory, sitePath, record, result: record.result }
  }

  async function inspectOwned(scope: Scope, handle: SiteHandle) {
    const owner = await owned(scope, handle)
    const state = await inventory(owner.sitePath)
    if (state.id !== owner.result.studioSiteId) throw toolError('site_registration_mismatch')
    return { ...owner, state }
  }

  async function createSite(value: unknown): Promise<SiteResult> {
    const request = parseInput(createSiteRequestSchema, value)
    const root = await roots()
    const siteId = siteIdFor(request.scope)
    const directory = path.join(root.stateRoot, siteId)
    const sitePath = path.join(root.sitesRoot, siteId)
    const requestHash = requestHashFor(request)
    await assertContainedPath(root.stateRoot, directory)
    await assertContainedPath(root.sitesRoot, sitePath)
    try {
      await fs.mkdir(directory, { mode: 0o700 })
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw toolError('reservation_failed')
      const record = await readRecord(directory).catch(() => { throw toolError('reconciliation_required') })
      if (record.requestHash !== requestHash) throw toolError('idempotency_conflict')
      if (record.status !== 'ready' || !record.result) throw toolError('reconciliation_required')
      return withSiteLock(directory, async () => {
        const owner = await inspectOwned(request.scope, { siteId })
        return owner.result
      })
    }
    await writeRecord(directory, { schemaVersion: 1, request, requestHash, status: 'creating' })
    return withSiteLock(directory, async () => {
      await assertContainedPath(root.sitesRoot, sitePath)
      try {
        await fs.lstat(sitePath)
        throw toolError('site_path_exists')
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      }
      await runner('studio', ['site', 'create', '--path', sitePath, '--name', request.name,
        '--runtime', 'sandbox', '--skip-browser', '--skip-log-details'])
      await assertSafeDirectory(sitePath)
      const site = await inventory(sitePath)
      if (!site.running) throw toolError('new_site_not_running')
      const theme = await scaffoldTheme(sitePath, request.themeSlug, request.name)
      await runner('git', ['init'], { cwd: theme.themePath })
      await runner('git', ['add', '--', ...theme.files], { cwd: theme.themePath })
      await runner('git', ['-c', 'user.name=Open Mercato', '-c', 'user.email=studio-demo@localhost',
        'commit', '-m', 'Initial Open Mercato Studio theme'], { cwd: theme.themePath })
      const commit = (await runner('git', ['rev-parse', 'HEAD'], { cwd: theme.themePath })).stdout.trim()
      await runner('studio', ['wp', 'theme', 'activate', request.themeSlug, '--path', sitePath, '--skip-plugins', '--skip-themes'])
      const activeTheme = (await runner('studio', ['wp', 'option', 'get', 'stylesheet', '--path', sitePath,
        '--skip-plugins', '--skip-themes'])).stdout.trim()
      if (activeTheme !== request.themeSlug) throw toolError('theme_activation_failed')
      const localUrl = (await runner('studio', ['wp', 'option', 'get', 'siteurl', '--path', sitePath,
        '--skip-plugins', '--skip-themes'])).stdout.trim()
      validateLocalUrl(localUrl)
      const checkedAt = new Date().toISOString()
      const result = parseInput(siteResultSchema, {
        schemaVersion: 1, provenance, siteId, scope: request.scope, attemptId: request.attemptId,
        toolExecutionId: randomUUID(), studioSiteId: site.id, localUrl, themeSlug: request.themeSlug,
        themeCommit: commit, createdAt: checkedAt,
        checks: ['studio.create', 'theme.scaffold', 'theme.git', 'theme.activate'].map((checkId) => ({ checkId, status: 'passed', checkedAt })),
      })
      await writeRecord(directory, { schemaVersion: 1, request, requestHash, status: 'ready', result })
      return result
    })
  }

  async function status(scope: Scope, handle: SiteHandle) {
    const owner = await inspectOwned(scope, handle)
    return { siteId: owner.result.siteId, studioSiteId: owner.state.id, running: owner.state.running, localUrl: owner.result.localUrl }
  }

  async function setRunning(scope: Scope, handle: SiteHandle, running: boolean) {
    const owner = await owned(scope, handle)
    return withSiteLock(owner.directory, async () => {
      const current = await inspectOwned(scope, handle)
      if (current.state.running !== running) {
        await runner('studio', ['site', running ? 'start' : 'stop', '--path', current.sitePath,
          ...(running ? ['--skip-browser'] : [])])
      }
      const state = await status(scope, handle)
      if (state.running !== running) throw toolError('site_state_unconfirmed')
      return state
    })
  }

  async function captureSnapshot(scope: Scope, handle: SiteHandle) {
    const owner = await owned(scope, handle)
    return withSiteLock(owner.directory, async () => {
      const current = await inspectOwned(scope, handle)
      if (current.state.running) {
        try {
          await runner('studio', ['site', 'stop', '--path', current.sitePath])
        } catch {
          throw toolError('snapshot_stop_unconfirmed')
        }
      }
      try {
        const stopped = await inventory(current.sitePath)
        if (stopped.running || stopped.id !== current.state.id) throw toolError('snapshot_site_not_stopped')
        const artifactRoot = await ensurePrivateRoot(path.join(owner.directory, 'snapshots'))
        const snapshot = await captureSiteSnapshot({ sitePath: current.sitePath, themeSlug: current.result.themeSlug, artifactRoot })
        return {
          schemaVersion: 1 as const,
          provenance,
          siteId: current.result.siteId,
          toolExecutionId: randomUUID(),
          creationAttemptId: current.result.attemptId,
          sourceRevision: { kind: 'snapshot' as const, contentHash: snapshot.contentHash, externalWorkspaceId: current.result.siteId },
          themeFiles: snapshot.themeFiles,
          databaseHash: snapshot.databaseHash,
          capturedAt: new Date().toISOString(),
        }
      } finally {
        if (current.state.running) {
          await runner('studio', ['site', 'start', '--path', current.sitePath, '--skip-browser'])
          const restored = await inventory(current.sitePath)
          if (!restored.running || restored.id !== current.state.id) throw toolError('snapshot_restore_unconfirmed')
        }
      }
    })
  }

  return { createSite, status, start: (scope: Scope, handle: SiteHandle) => setRunning(scope, handle, true),
    stop: (scope: Scope, handle: SiteHandle) => setRunning(scope, handle, false), captureSnapshot }
}

export function validateLocalUrl(value: string): URL {
  let url: URL
  try { url = new URL(value) } catch { throw toolError('invalid_local_url') }
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username || url.password || url.search || url.hash || url.pathname !== '/') throw toolError('invalid_local_url')
  return url
}
