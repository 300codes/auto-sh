import { createFigmaCommentsClient } from '../lib/client'

const credentials = { token: 'test-only-token', authType: 'personal' as const }
const comment = { id: '1', file_key: 'file', message: 'Review', user: { id: 'u', handle: 'Designer' }, created_at: '2026-09-19T10:00:00Z' }

it('uses a fixed HTTPS origin, rejects redirects, and reads a bounded validated snapshot', async () => {
  const request = jest.fn(async () => Response.json({ comments: [comment] }))
  expect(await createFigmaCommentsClient({ fetch: request }).read('file', credentials)).toEqual([comment])
  expect(request).toHaveBeenCalledWith('https://api.figma.com/v1/files/file/comments', expect.objectContaining({ redirect: 'error', headers: { Accept: 'application/json', 'X-Figma-Token': credentials.token } }))
  await expect(createFigmaCommentsClient({ fetch: request }).read('../foreign', credentials)).rejects.toMatchObject({ code: 'figma_response_invalid' })
  expect(request).toHaveBeenCalledTimes(1)
})

it('limits rate-limit retries and exposes a typed failure', async () => {
  const request = jest.fn(async () => new Response(null, { status: 429 }))
  const sleep = jest.fn(async () => undefined)
  await expect(createFigmaCommentsClient({ fetch: request, sleep }).read('file', credentials)).rejects.toMatchObject({ code: 'figma_rate_limited' })
  expect(request).toHaveBeenCalledTimes(3)
  expect(sleep.mock.calls).toEqual([[250], [500]])
})

it('rejects foreign files, oversized responses, and missing access without leaking credentials', async () => {
  for (const [response, code] of [
    [Response.json({ comments: [{ ...comment, file_key: 'other' }] }), 'figma_response_invalid'],
    [new Response('{}', { headers: { 'content-length': '8000001' } }), 'figma_response_too_large'],
    [new Response(null, { status: 403 }), 'figma_access_denied'],
  ] as const) {
    await expect(createFigmaCommentsClient({ fetch: jest.fn(async () => response) }).read('file', credentials)).rejects.toMatchObject({ code, message: `[internal] ${code}` })
  }
})
