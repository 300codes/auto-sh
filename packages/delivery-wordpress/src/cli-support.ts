import http from 'node:http'
import { performance } from 'node:perf_hooks'
import { createSiteRequestSchema, parseInput, toolError } from './contracts.ts'
import type { SiteResult, ToolCheck } from './contracts.ts'
import type { createWordPressStudioTools } from './index.ts'
import { siteIdFor } from './ownership.ts'
import { validateLocalUrl } from './tools.ts'

type StudioTools = ReturnType<typeof createWordPressStudioTools>

export function errorCode(error: unknown): string {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string' && /^[A-Za-z0-9_]{1,80}$/.test(error.code)) return error.code
  return 'studio_tool_failed'
}

export async function smokeLocalUrl(value: string, limits: { timeoutMs?: number; maxBytes?: number } = {}): Promise<{ statusCode: number; bytes: number }> {
  const url = validateLocalUrl(value)
  const timeoutMs = limits.timeoutMs ?? 30_000
  const maxBytes = limits.maxBytes ?? 2 * 1024 * 1024
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000 ||
    !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 2 * 1024 * 1024) throw toolError('invalid_http_limits')
  const expiresAt = performance.now() + timeoutMs
  while (true) {
    const remainingMs = Math.floor(expiresAt - performance.now())
    if (remainingMs < 1) throw toolError('http_timeout')
    try {
      return await smokeAttempt(url, remainingMs, maxBytes)
    } catch (error) {
      if (!['http_connection_retryable', 'http_status_retryable'].includes(errorCode(error))) throw error
      const waitMs = Math.min(250, Math.floor(expiresAt - performance.now()))
      if (waitMs < 1) throw toolError('http_timeout')
      await new Promise((resolve) => setTimeout(resolve, waitMs))
    }
  }
}

function isSelfRedirect(status: number | undefined, location: string | undefined, url: URL): boolean {
  if (![301, 302, 303, 307, 308].includes(status ?? 0) || !location) return false
  try { return new URL(location, url).href === url.href } catch { return false }
}

async function smokeAttempt(url: URL, timeoutMs: number, maxBytes: number): Promise<{ statusCode: number; bytes: number }> {
  return new Promise((resolve, reject) => {
    let finished = false
    const finish = (error?: Error, result?: { statusCode: number; bytes: number }) => {
      if (finished) return
      finished = true
      clearTimeout(deadline)
      if (error) reject(error)
      else if (result) resolve(result)
    }
    const request = http.get(url, (response) => {
      let bytes = 0
      if (response.statusCode !== 200) {
        finish(toolError(([408, 425, 429, 500, 502, 503, 504].includes(response.statusCode ?? 0) ||
          isSelfRedirect(response.statusCode, response.headers.location, url)) ? 'http_status_retryable' : `http_smoke_failed_${response.statusCode ?? 'unknown'}`))
        response.destroy()
        request.destroy()
        return
      }
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length
        if (bytes > maxBytes) {
          finish(toolError('http_body_limit'))
          response.destroy()
          request.destroy()
        }
      })
      response.on('error', () => finish(toolError('http_response_failed')))
      response.on('end', () => bytes === 0 ? finish(toolError('http_smoke_failed')) : finish(undefined, { statusCode: 200, bytes }))
    })
    const deadline = setTimeout(() => {
      finish(toolError('http_timeout'))
      request.destroy()
    }, timeoutMs)
    request.on('error', (error: NodeJS.ErrnoException) => finish(toolError(
      ['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'EHOSTUNREACH', 'ETIMEDOUT'].includes(error.code ?? '')
        ? 'http_connection_retryable' : 'http_smoke_failed')))
  })
}

export async function runCreateScenario(value: unknown, tools: StudioTools,
  options: { provenance: 'live' | 'fixture'; smoke?: typeof smokeLocalUrl }) {
  const request = parseInput(createSiteRequestSchema, value)
  const remainingCheckIds = ['snapshot.capture', 'http.local']
  let site: SiteResult | undefined
  let snapshot: Awaited<ReturnType<StudioTools['captureSnapshot']>> | undefined
  let stage: 'site.create' | 'snapshot.capture' | 'http.local' = 'site.create'
  let checks: ToolCheck[] = []
  const provenance = () => options.provenance === 'fixture' || site?.provenance === 'fixture' || snapshot?.provenance === 'fixture' || options.smoke ? 'fixture' as const : 'live' as const
  const base = () => ({ schemaVersion: 1, provenance: provenance(), executionMode: 'standalone_tools',
    omIntegration: 'not_connected', baselineId: null, acceptanceCriteria: 'not_evaluated',
    scope: request.scope, attemptId: request.attemptId, siteId: siteIdFor(request.scope),
    ...(site ? { toolExecutionId: site.toolExecutionId, site } : {}), ...(snapshot ? { snapshot } : {}),
    preview: { status: 'not_published', verified: false } })
  try {
    site = await tools.createSite(request)
    checks = [...site.checks]
    stage = 'snapshot.capture'
    snapshot = await tools.captureSnapshot(request.scope, { siteId: site.siteId })
    checks.push({ checkId: stage, status: 'passed', checkedAt: snapshot.capturedAt })
    stage = 'http.local'
    const httpCheck = await (options.smoke ?? smokeLocalUrl)(site.localUrl)
    checks.push({ checkId: stage, status: 'passed', checkedAt: new Date().toISOString() })
    return { ...base(), status: 'created' as const, checks, httpCheck }
  } catch (error) {
    const code = errorCode(error)
    const checkedAt = new Date().toISOString()
    checks.push({ checkId: stage, status: 'failed', checkedAt, code })
    for (const checkId of remainingCheckIds) {
      if (!checks.some((check) => check.checkId === checkId)) checks.push({ checkId, status: 'not_run', checkedAt })
    }
    return { ...base(), status: 'blocked' as const, code, checks }
  }
}
