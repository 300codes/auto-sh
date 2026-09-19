import { z } from 'zod'

export const figmaCommentSchema = z.object({
  id: z.string().min(1).max(200),
  file_key: z.string().min(1).max(200),
  parent_id: z.string().max(200).nullish(),
  message: z.string().min(1).max(20000),
  user: z.object({ id: z.string().max(200), handle: z.string().min(1).max(500) }),
  created_at: z.iso.datetime({ offset: true }),
  resolved_at: z.iso.datetime({ offset: true }).nullish(),
  client_meta: z.object({ node_id: z.string().max(200).optional() }).passthrough().nullish(),
})
export const figmaCommentsSchema = z.object({ comments: z.array(figmaCommentSchema).max(5000) })
export type FigmaComment = z.infer<typeof figmaCommentSchema>
export const figmaCredentialsSchema = z.object({
  token: z.string().min(1),
  authType: z.enum(['personal', 'oauth']).default('personal'),
})

export class FigmaReadError extends Error {
  constructor(readonly code: 'figma_access_denied' | 'figma_file_missing' | 'figma_rate_limited' | 'figma_unavailable' | 'figma_response_invalid' | 'figma_response_too_large') {
    super(`[internal] ${code}`)
  }
}

const MAX_BYTES = 8_000_000

async function readBoundedJson(response: Response): Promise<unknown> {
  if (Number(response.headers.get('content-length') ?? 0) > MAX_BYTES) throw new FigmaReadError('figma_response_too_large')
  if (!response.body) throw new FigmaReadError('figma_response_invalid')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_BYTES) throw new FigmaReadError('figma_response_too_large')
      chunks.push(value)
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown }
    catch { throw new FigmaReadError('figma_response_invalid') }
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
}

export function createFigmaCommentsClient(dependencies: {
  fetch?: typeof fetch
  sleep?: (milliseconds: number) => Promise<void>
} = {}) {
  const request = dependencies.fetch ?? fetch
  const sleep = dependencies.sleep ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
  return {
    async read(fileKey: string, credentials: z.infer<typeof figmaCredentialsSchema>): Promise<FigmaComment[]> {
      if (!/^[A-Za-z0-9_-]{1,200}$/.test(fileKey)) throw new FigmaReadError('figma_response_invalid')
      const secret = figmaCredentialsSchema.parse(credentials)
      const headers: Record<string, string> = { Accept: 'application/json' }
      if (secret.authType === 'oauth') headers.Authorization = `Bearer ${secret.token}`
      else headers['X-Figma-Token'] = secret.token
      for (let attempt = 0; attempt < 3; attempt += 1) {
        let response: Response
        try {
          response = await request(`https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/comments`, {
            headers, redirect: 'error', signal: AbortSignal.timeout(10000),
          })
        } catch { throw new FigmaReadError('figma_unavailable') }
        if (response.status === 403 || response.status === 401) throw new FigmaReadError('figma_access_denied')
        if (response.status === 404) throw new FigmaReadError('figma_file_missing')
        if (response.status === 429 || response.status >= 500) {
          const retryAfter = Number(response.headers.get('retry-after') ?? 0)
          await response.body?.cancel()
          if (attempt === 2 || retryAfter > 5) throw new FigmaReadError(response.status === 429 ? 'figma_rate_limited' : 'figma_unavailable')
          await sleep(Math.max(250 * 2 ** attempt, Number.isFinite(retryAfter) ? retryAfter * 1000 : 0))
          continue
        }
        if (!response.ok) throw new FigmaReadError('figma_unavailable')
        const parsed = figmaCommentsSchema.safeParse(await readBoundedJson(response))
        if (!parsed.success || parsed.data.comments.some((comment) => comment.file_key !== fileKey)) throw new FigmaReadError('figma_response_invalid')
        return parsed.data.comments
      }
      throw new FigmaReadError('figma_unavailable')
    },
  }
}
