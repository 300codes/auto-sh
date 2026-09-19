import { randomUUID } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { API, caller, cleanupRegistry, createRegistry, createSiblingOrgUser, type Json } from './flowSpecKit'
import { commentFixture } from './commentSpecKit'

test('FLOW-03: replay, edits, deletion, parallel cursor advance and foreign scope', async ({ request }) => {
  test.slow()
  const registry = createRegistry()
  const token = await getAuthToken(request, 'admin')
  const call = caller(request, token)
  let fixture: Awaited<ReturnType<typeof commentFixture>> | undefined
  try {
    fixture = await commentFixture(request, token, call, registry)
    const { projectId, batch } = fixture
    const path = `${API}/projects/${projectId}/comment-imports`
    const key = randomUUID()
    const imported = await call('POST', path, { body: batch, headers: { 'Idempotency-Key': key } })
    expect(imported.status, JSON.stringify(imported.body)).toBe(201)
    expect(imported.body.counts).toMatchObject({ threadsCreated: 1, repliesCreated: 1 })
    const replay = await call('POST', path, { body: batch, headers: { 'Idempotency-Key': key } })
    expect(replay.status).toBe(200)
    expect(replay.body.replayed).toBe(true)
    const edited = structuredClone(batch)
    edited.cursor = { after: 'cursor-1', next: 'cursor-2' }
    edited.threads[0].replies[0] = { ...edited.threads[0].replies[0], body: 'Revised response', editedAt: '2026-09-19T10:30:00.000Z', deleted: true }
    const revision = await call('POST', path, { body: edited, headers: { 'Idempotency-Key': randomUUID() } })
    expect(revision.status, JSON.stringify(revision.body)).toBe(201)
    const listed = await call('GET', `${API}/projects/${projectId}/comment-threads?stageId=ux`)
    expect(listed.body.total).toBe(1)
    expect(((listed.body.items as Json[])[0].replies as Json[])).toEqual([expect.objectContaining({ revision: 2, deleted: true, body: 'Revised response' })])
    const concurrent = await Promise.all(['next-a', 'next-b'].map((next) => call('POST', path, {
      body: { ...edited, cursor: { after: 'cursor-2', next } }, headers: { 'Idempotency-Key': randomUUID() },
    })))
    expect(concurrent.map((result) => result.status).sort()).toEqual([201, 409])
    expect(concurrent.find((result) => result.status === 409)?.body.code).toBe('sync_cursor_conflict')
    const foreign = await createSiblingOrgUser(request, token, registry, 'comments')
    const hidden = await caller(request, foreign.token)('GET', `${API}/projects/${projectId}/comment-threads`)
    expect(hidden.status).toBe(404)
    expect(JSON.stringify(hidden.body)).not.toContain('Increase spacing')
  } finally {
    await cleanupRegistry(request, token, registry)
    await fixture?.cleanup()
  }
})
