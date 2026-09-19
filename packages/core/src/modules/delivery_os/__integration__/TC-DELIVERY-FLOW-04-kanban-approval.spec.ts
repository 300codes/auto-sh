import { randomUUID } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { API, approvalFor, caller, cleanupRegistry, createRegistry, designArtifact, getFlow, postDecision, projectVersion, recordArtifact, sql, stageCurrencies, withStage, type Json } from './flowSpecKit'
import { commentFixture } from './commentSpecKit'

test('FLOW-04: Staff Done does not approve, thread deferral is version locked and bound to artifact hash', async ({ request }) => {
  test.slow()
  const registry = createRegistry()
  const token = await getAuthToken(request, 'admin')
  const call = caller(request, token)
  let fixture: Awaited<ReturnType<typeof commentFixture>> | undefined
  try {
    fixture = await commentFixture(request, token, call, registry)
    const { projectId, staffProjectId, scope, batch } = fixture
    const artifact = await recordArtifact(call, projectId, designArtifact(projectId, 'ux', [withStage('scope', scope)]))
    const imported = await call('POST', `${API}/projects/${projectId}/comment-imports`, { body: batch, headers: { 'Idempotency-Key': randomUUID() } })
    expect(imported.status, JSON.stringify(imported.body)).toBe(201)
    const done = await call('POST', '/api/staff/timesheets/task-statuses', { body: { timeProjectId: staffProjectId, name: 'Done', slug: 'flow-done', isDone: true, position: 10 } })
    expect(done.status).toBe(201)
    const item = ((await call('GET', `${API}/projects/${projectId}/comment-threads`)).body.items as Json[])[0]
    const version = await sql<{ updated_at: Date }>('select updated_at from staff_time_tasks where id = $1', [item.staffTaskId])
    const moved = await call('PATCH', `/api/staff/timesheets/tasks/${item.staffTaskId}/status`, { body: { taskStatusId: done.body.id }, lock: version[0].updated_at.toISOString() })
    expect(moved.status, JSON.stringify(moved.body)).toBe(200)
    expect(stageCurrencies(await getFlow(call, projectId)).ux).toBe('pending')
    const blocked = await postDecision(call, projectId, 'ux', approvalFor(artifact), { key: randomUUID(), lock: await projectVersion(call, projectId) })
    expect(blocked.status).toBe(422)
    expect(blocked.body.code).toBe('blocking_comments_open')
    const triagePath = `${API}/projects/${projectId}/comment-threads/${item.threadId}/triage`
    const deferred = await call('POST', triagePath, { body: { triageStatus: 'deferred', deferral: { artifactId: artifact.artifactId, contentHash: artifact.contentHash, reason: 'Accepted for the next scope' } }, lock: String(item.updatedAt) })
    expect(deferred.status, JSON.stringify(deferred.body)).toBe(200)
    expect(stageCurrencies(await getFlow(call, projectId)).ux).toBe('pending')
    const stale = await call('POST', triagePath, { body: { triageStatus: 'new' }, lock: String(item.updatedAt) })
    expect(stale.status).toBe(409)
    const approved = await postDecision(call, projectId, 'ux', approvalFor(artifact), { key: randomUUID(), lock: await projectVersion(call, projectId) })
    expect(approved.status, JSON.stringify(approved.body)).toBe(201)
  } finally {
    await cleanupRegistry(request, token, registry)
    await fixture?.cleanup()
  }
})
