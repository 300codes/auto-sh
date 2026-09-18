import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { createSiteRequestSchema, parseInput } from '../contracts.ts'
import { initializeRoots, requestHashFor, siteIdFor } from '../ownership.ts'
import { validateLocalUrl } from '../tools.ts'

test('strict inputs keep shell, paths, traversal and unknown correlation out', () => {
  const request = { scope: { tenantId: randomUUID(), organizationId: randomUUID(), projectId: randomUUID() },
    attemptId: randomUUID(), idempotencyKey: 'example:1', name: 'Open Mercato', themeSlug: 'om-demo' }
  assert.doesNotThrow(() => parseInput(createSiteRequestSchema, request))
  for (const change of [{ path: '/tmp/other' }, { command: 'touch x' }, { themeSlug: '../other' },
    { name: 'x; echo secret' }, { scope: { ...request.scope, tenantId: 'not-a-uuid' } }]) {
    assert.throws(() => parseInput(createSiteRequestSchema, { ...request, ...change }), /invalid_input/)
  }
  assert.equal(siteIdFor(request.scope), siteIdFor({ ...request.scope }))
  assert.notEqual(siteIdFor(request.scope), siteIdFor({ ...request.scope, tenantId: randomUUID() }))
  assert.notEqual(requestHashFor(request), requestHashFor({ ...request, attemptId: randomUUID() }))
})

test('host roots and smoke URL reject unsafe locations before effects', async () => {
  await assert.rejects(initializeRoots('.', '/tmp/example'), /absolute_roots_required/)
  await assert.rejects(initializeRoots('/tmp/root', '/tmp/root/state'), /overlapping_roots/)
  for (const value of ['https://example.com', 'http://localhost@evil.test', 'http://127.0.0.1/?secret=x', 'file:///tmp/file']) {
    assert.throws(() => validateLocalUrl(value), /invalid_local_url/)
  }
  assert.equal(validateLocalUrl('http://localhost:8881').hostname, 'localhost')
})
