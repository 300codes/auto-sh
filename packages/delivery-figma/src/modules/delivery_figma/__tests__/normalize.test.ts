import { normalizeFigmaComments } from '../lib/normalize'
import type { FigmaComment } from '../lib/client'

const date = '2026-09-19T10:00:00.000Z'
const root: FigmaComment = { id: '1', file_key: 'file', message: 'Review', user: { id: 'u', handle: 'Designer' }, created_at: date, client_meta: { node_id: '1:2' } }
const reply: FigmaComment = { ...root, id: '2', parent_id: '1', message: 'Reply' }

it('keeps source thread/reply ids and never invents a confirmed Figma version', () => {
  const threads = normalizeFigmaComments('file', [reply, root], [], date)
  expect(threads).toHaveLength(1)
  expect(threads[0]).toMatchObject({ threadKey: '1', nodeId: '1:2', figmaVersion: null, status: 'open', replies: [{ commentKey: '2', body: 'Reply', deleted: false }] })
})

it('detects edits, resolution and deletion only from a complete validated snapshot', () => {
  const previous = normalizeFigmaComments('file', [root, reply], [], date)
  const nextDate = '2026-09-19T11:00:00.000Z'
  const changed = normalizeFigmaComments('file', [{ ...root, message: 'Changed', resolved_at: nextDate }], previous, nextDate)
  expect(changed[0]).toMatchObject({ body: 'Changed', updatedAt: nextDate, status: 'resolved', replies: [{ commentKey: '2', deleted: true }] })
  expect(normalizeFigmaComments('file', [], changed, nextDate)[0].status).toBe('deleted')
  expect(normalizeFigmaComments('file', [root, reply], changed, nextDate)[0].replies[0].deleted).toBe(false)
})

it('refuses duplicate IDs and orphan replies instead of creating incomplete cards', () => {
  expect(() => normalizeFigmaComments('file', [root, root], [], date)).toThrow('figma_response_invalid')
  expect(() => normalizeFigmaComments('file', [reply], [], date)).toThrow('figma_response_invalid')
})
