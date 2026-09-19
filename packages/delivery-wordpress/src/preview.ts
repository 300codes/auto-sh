import path from 'node:path'
import { z } from 'zod'
import { parseInput, scopeSchema, siteHandleSchema, toolError } from './contracts.ts'
import { createCommandRunner, parseStudioJson } from './runner.ts'
import type { CommandRunner } from './runner.ts'
import { readRecord } from './ownership.ts'
import { createWordPressStudioTools } from './tools.ts'

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const hostSchema = z.string().max(72).regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.wp\.build$/).refine((value) => !/[\s\u0000-\u001f\u007f]/.test(value))
const inputSchema = z.object({
  scope: scopeSchema, handle: siteHandleSchema,
  config: z.object({ sitesRoot: z.string().refine(path.isAbsolute), stateRoot: z.string().refine(path.isAbsolute) }).strict(),
  savedHost: hostSchema.optional(),
}).strict()
const listingSchema = z.array(z.object({ localSiteId: z.string().min(1), url: z.string().min(1), date: z.union([z.number(), z.string()]) })).max(100)
const journalSchema = z.object({
  schemaVersion: z.literal(1), siteId: siteHandleSchema.shape.siteId, packageHash: hashSchema,
  state: z.enum(['prepared', 'uploading', 'uncertain', 'uploaded_unverified', 'verified']),
  host: hostSchema.nullable(),
}).strict()
export type PreviewPublication = z.infer<typeof journalSchema>

function hostFromUrl(value: string) {
  try {
    if (/[\s\u0000-\u001f\u007f]/.test(value)) throw toolError('preview_host_invalid')
    const url = new URL(value.includes('://') ? value : `https://${value}`)
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw toolError('preview_host_invalid')
    return parseInput(hostSchema, url.hostname)
  } catch { throw toolError('preview_host_invalid') }
}

export async function inspectOwnedPreview(value: unknown, dependencies: { runner?: CommandRunner; now?: () => number } = {}) {
  try {
    const input = parseInput(inputSchema, value)
    const runner = dependencies.runner ?? createCommandRunner({ timeoutMs: 30_000 })
    const tools = createWordPressStudioTools(input.config, { runner })
    const status = await tools.status(input.scope, input.handle)
    const owner = await readRecord(path.join(input.config.stateRoot, input.handle.siteId))
    const sitePath = path.join(input.config.sitesRoot, input.handle.siteId)
    const version = await runner('studio', ['--version'])
    if (version.stdout.trim().split('\n').at(-1)?.trim() !== '1.19.0') throw toolError('preview_cli_version_unverified')
    await runner('studio', ['auth', 'status'])
    const listed = await runner('studio', ['preview', 'list', '--path', sitePath, '--format', 'json'])
    if (!listed.stdout.trim()) throw toolError('preview_listing_invalid')
    const entries = /^No preview sites found\.?$/.test(listed.stdout.trim().split('\n').at(-1)?.trim() ?? '') ? [] : parseInput(listingSchema, parseStudioJson(listed.stdout))
    const matches = entries.filter((entry) => entry.localSiteId === status.studioSiteId)
    if (matches.length > 1) throw toolError('preview_ambiguous')
    const match = matches[0]
    const host = match ? hostFromUrl(match.url) : null
    if (input.savedHost && input.savedHost !== host) throw toolError('preview_binding_mismatch')
    const updatedAt = match ? new Date(match.date).getTime() : null
    if (updatedAt !== null && (!Number.isFinite(updatedAt) || updatedAt > (dependencies.now?.() ?? Date.now()) + 60_000)) throw toolError('preview_listing_invalid')
    const expired = updatedAt !== null && updatedAt + 7 * 24 * 60 * 60 * 1000 <= (dependencies.now?.() ?? Date.now())
    return { schemaVersion: 1, status: 'passed', provenance: dependencies.runner || owner.result?.provenance === 'fixture' ? 'fixture' : 'local',
      siteId: input.handle.siteId, studioSiteId: status.studioSiteId, host, expired,
      binding: match ? 'observed_not_adopted' : 'absent', runtimeRunning: status.running,
      publication: 'not_authorized', remoteRevision: 'not_verified', uploadSource: 'registered_site_only',
      frozenPackageUpload: 'requires_host_integration', configSafety: 'requires_prepared_config',
    }
  } catch (error) {
    const allowed = new Set(['invalid_input', 'ownership_mismatch', 'reconciliation_required', 'site_registration_mismatch', 'site_state_unknown', 'preview_host_invalid', 'preview_cli_version_unverified', 'preview_ambiguous', 'preview_binding_mismatch', 'preview_listing_invalid'])
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : ''
    throw toolError(allowed.has(code) ? code : 'preview_readiness_failed')
  }
}

const eventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('begin'), approvedPackageHash: hashSchema, approvedHost: hostSchema.nullable() }).strict(),
  z.object({ type: z.literal('interrupted') }).strict(),
  z.object({ type: z.literal('observed'), host: hostSchema }).strict(),
  z.object({ type: z.literal('verified'), host: hostSchema, observedPackageHash: hashSchema }).strict(),
])

export function transitionPreviewPublication(value: unknown, eventValue: unknown): PreviewPublication {
  const current = parseInput(journalSchema, value)
  const event = parseInput(eventSchema, eventValue)
  if (event.type === 'begin') {
    if (current.state !== 'prepared' || event.approvedPackageHash !== current.packageHash || event.approvedHost !== current.host) throw toolError('preview_approval_or_reconciliation_required')
    return { ...current, state: 'uploading' }
  }
  if (event.type === 'interrupted') {
    if (current.state !== 'uploading') throw toolError('preview_transition_conflict')
    return { ...current, state: 'uncertain' }
  }
  if (event.type === 'observed') {
    if (!['uploading', 'uncertain', 'uploaded_unverified'].includes(current.state) || (current.host !== null && current.host !== event.host)) throw toolError('preview_transition_conflict')
    return { ...current, host: event.host, state: 'uploaded_unverified' }
  }
  if (current.state !== 'uploaded_unverified' || current.host !== event.host || current.packageHash !== event.observedPackageHash) throw toolError('preview_revision_mismatch')
  return { ...current, state: 'verified' }
}
