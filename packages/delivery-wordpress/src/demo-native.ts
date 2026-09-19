import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'
import { parseInput, toolError, type Scope, type SiteHandle } from './contracts.ts'
import { withSiteLock } from './ownership.ts'
import { createCommandRunner, parseStudioJson, type CommandRunner } from './runner.ts'
import { createWordPressStudioTools } from './tools.ts'

const configSchema = z.object({
  sitesRoot: z.string().refine(path.isAbsolute),
  stateRoot: z.string().refine(path.isAbsolute),
  timeoutMs: z.number().int().min(1).max(600_000).optional(),
}).strict()
const postSchema = z.object({
  ID: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  post_name: z.string(), post_title: z.string(), post_status: z.string(),
  post_content: z.string().optional(),
})
type CheckStatus = 'passed' | 'failed' | 'not_run'
export type DemoNativeReport = {
  schemaVersion: 1
  provenance: 'live' | 'fixture'
  siteId: string
  status: 'passed' | 'failed'
  versions: { wordpress?: string; php?: string }
  checks: { noindex: CheckStatus; content: CheckStatus; meta: CheckStatus; pluginReplayPersistence: CheckStatus }
  cleanup: { status: CheckStatus; code?: string }
  redeploy: { status: 'not_run'; code: 'native_probe_not_redeploy' }
  code?: string
}

export async function runDemoNativeProbe(
  scope: Scope,
  handle: SiteHandle,
  configValue: z.infer<typeof configSchema>,
  dependencies: { runner?: CommandRunner; replayPlugins?: () => Promise<void> } = {},
): Promise<DemoNativeReport> {
  const config = parseInput(configSchema, configValue)
  const runner = dependencies.runner ?? createCommandRunner({ timeoutMs: config.timeoutMs })
  const tools = createWordPressStudioTools(config, { runner })
  await tools.status(scope, handle)
  const directory = path.join(config.stateRoot, handle.siteId)
  const sitePath = path.join(config.sitesRoot, handle.siteId)
  const marker = `om-native-probe-${randomUUID()}`
  const content = `Native draft verification ${marker}`
  const report: DemoNativeReport = {
    schemaVersion: 1, provenance: dependencies.runner ? 'fixture' : 'live', siteId: handle.siteId,
    status: 'passed', versions: {},
    checks: { noindex: 'not_run', content: 'not_run', meta: 'not_run', pluginReplayPersistence: 'not_run' },
    cleanup: { status: 'not_run' }, redeploy: { status: 'not_run', code: 'native_probe_not_redeploy' },
  }
  let postId: string | undefined
  let createStarted = false
  let uncertainCreate = false
  const wp = (args: string[]) => runner('studio', ['wp', ...args, '--path', sitePath], { timeoutMs: config.timeoutMs })
  const fail = (code: string) => { report.status = 'failed'; report.code ??= code }
  const listOwned = async () => parseInput(z.array(postSchema), parseStudioJson((await wp([
    'post', 'list', '--post_type=post', '--post_status=draft', `--name=${marker}`,
    '--fields=ID,post_name,post_title,post_status', '--format=json',
  ])).stdout))
  const assertMarker = (post: z.infer<typeof postSchema>) => {
    if (post.post_name !== marker || post.post_title !== marker || post.post_status !== 'draft') throw toolError('native_post_ownership_unconfirmed')
  }
  const readPost = async () => {
    if (!postId) throw toolError('native_post_id_missing')
    const post = parseInput(postSchema, parseStudioJson((await wp([
      'post', 'get', postId, '--fields=ID,post_name,post_title,post_status,post_content', '--format=json',
    ])).stdout))
    assertMarker(post)
    if (String(post.ID) !== postId) throw toolError('native_post_ownership_unconfirmed')
    return post
  }
  const cleanup = async () => {
    if (!createStarted) return
    try {
      if (!postId) {
        const matches = await listOwned()
        if (matches.length !== 1) throw toolError('native_cleanup_unconfirmed')
        assertMarker(matches[0]!)
        postId = String(matches[0]!.ID)
      }
      await readPost()
      await wp(['post', 'delete', postId, '--force'])
      if ((await listOwned()).length !== 0) throw toolError('native_cleanup_unconfirmed')
      report.cleanup = { status: 'passed' }
    } catch {
      report.cleanup = { status: 'failed', code: 'native_cleanup_unconfirmed' }
      fail('native_cleanup_unconfirmed')
    }
  }
  try {
    const prepared = await withSiteLock(directory, async () => {
      try {
        await tools.status(scope, handle)
        for (const [name, args] of [
          ['wordpress', ['core', 'version']], ['php', ['eval', 'echo PHP_VERSION;']],
        ] as const) {
          const version = (await wp([...args])).stdout.trim()
          if (!/^[0-9][A-Za-z0-9._+-]{0,63}$/.test(version)) throw toolError('native_version_unconfirmed')
          report.versions[name] = version
        }
        report.checks.noindex = 'failed'
        report.checks.noindex = (await wp(['option', 'get', 'blog_public'])).stdout.trim() === '0' ? 'passed' : 'failed'
        if (report.checks.noindex !== 'passed') throw toolError('native_noindex_unconfirmed')
        createStarted = true
        uncertainCreate = true
        const id = (await wp(['post', 'create', '--post_type=post', '--post_status=draft', `--post_title=${marker}`, `--post_name=${marker}`, '--porcelain'])).stdout.trim()
        if (!/^[1-9][0-9]{0,14}$/.test(id) || !Number.isSafeInteger(Number(id))) throw toolError('native_post_id_invalid')
        postId = id
        await readPost()
        uncertainCreate = false
        await wp(['post', 'update', postId, `--post_content=${content}`])
        await wp(['post', 'meta', 'update', postId, '_om_native_probe', marker])
        return true
      } catch {
        fail('native_prepare_failed')
        await cleanup()
        if (uncertainCreate || report.cleanup.status === 'failed') throw toolError('native_reconciliation_required')
        return false
      }
    })
    if (!prepared) return report
    if (dependencies.replayPlugins) {
      try { await dependencies.replayPlugins() } catch { fail('native_plugin_replay_failed') }
    }
    await tools.status(scope, handle)
    await withSiteLock(directory, async () => {
      try {
        await tools.status(scope, handle)
        report.checks.noindex = 'not_run'
        report.checks.content = 'failed'
        const post = await readPost()
        report.checks.content = post.post_content === content ? 'passed' : 'failed'
        report.checks.meta = 'failed'
        report.checks.meta = (await wp(['post', 'meta', 'get', postId!, '_om_native_probe'])).stdout.trim() === marker ? 'passed' : 'failed'
        report.checks.noindex = (await wp(['option', 'get', 'blog_public'])).stdout.trim() === '0' ? 'passed' : 'failed'
        if (Object.values(report.checks).includes('failed')) fail('native_readback_failed')
      } catch { fail('native_readback_failed') } finally { await cleanup() }
      if (dependencies.replayPlugins) report.checks.pluginReplayPersistence = report.status === 'passed' ? 'passed' : 'failed'
      if (report.cleanup.status === 'failed') throw toolError('native_reconciliation_required')
    })
  } catch {
    fail('native_reconciliation_required')
    report.code = 'native_reconciliation_required'
    if (createStarted && report.cleanup.status !== 'passed') report.cleanup = { status: 'failed', code: 'native_cleanup_unconfirmed' }
  }
  return report
}
