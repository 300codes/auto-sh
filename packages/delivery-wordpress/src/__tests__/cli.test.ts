import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import http from 'node:http'
import test from 'node:test'
import { runCreateScenario, smokeLocalUrl } from '../cli-support.ts'
import { createWordPressStudioTools } from '../index.ts'
import { siteIdFor } from '../ownership.ts'

async function fixture(handler: http.RequestListener) {
  const server = http.createServer(handler)
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  return { url: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
    server.closeAllConnections()
  }) }
}

test('HTTP absolute deadline stops a continuously streaming response', async () => {
  const server = await fixture((_request, response) => {
    response.write('start')
    const interval = setInterval(() => response.write('x'), 10)
    response.on('close', () => clearInterval(interval))
  })
  try { await assert.rejects(smokeLocalUrl(server.url, { timeoutMs: 80 }), /http_timeout/) }
  finally { await server.close() }
})

test('HTTP smoke refuses redirects and oversized bodies', async () => {
  let targetHits = 0
  const target = await fixture((_request, response) => { targetHits += 1; response.end('target') })
  const redirect = await fixture((_request, response) => { response.writeHead(302, { Location: target.url }); response.end() })
  const oversized = await fixture((_request, response) => response.end('x'.repeat(100)))
  try {
    await assert.rejects(smokeLocalUrl(redirect.url), /http_smoke_failed/)
    assert.equal(targetHits, 0)
    await assert.rejects(smokeLocalUrl(oversized.url, { maxBytes: 16 }), /http_body_limit/)
    assert.deepEqual(await smokeLocalUrl(target.url), { statusCode: 200, bytes: 6 })
  } finally { await Promise.all([target.close(), redirect.close(), oversized.close()]) }
})

test('failed scenarios keep safe correlation, completed checks and not-run checks', async () => {
  const request = { scope: { tenantId: randomUUID(), organizationId: randomUUID(), projectId: randomUUID() },
    attemptId: randomUUID(), idempotencyKey: 'fixture', name: 'Fixture', themeSlug: 'fixture' }
  const siteId = siteIdFor(request.scope)
  const checkedAt = new Date().toISOString()
  const site = { schemaVersion: 1 as const, provenance: 'fixture' as const, siteId, scope: request.scope,
    attemptId: request.attemptId, toolExecutionId: randomUUID(), studioSiteId: 'fixture', localUrl: 'http://127.0.0.1:9999',
    themeSlug: 'fixture', themeCommit: 'a'.repeat(40), createdAt: checkedAt,
    checks: ['studio.create', 'theme.scaffold', 'theme.git', 'theme.activate'].map((checkId) => ({ checkId, status: 'passed' as const, checkedAt })) }
  const tools = createWordPressStudioTools({ sitesRoot: '/unused', stateRoot: '/unused-state' })
  const error = Object.assign(new Error('PRIVATE_PAYLOAD'), { code: 'fixture_failed', stderr: 'PRIVATE_SECRET' })
  tools.createSite = async () => site
  tools.captureSnapshot = async () => { throw error }
  const report = await runCreateScenario(request, tools, { provenance: 'fixture' })
  assert.equal(report.status, 'blocked')
  assert.equal(report.provenance, 'fixture')
  assert.deepEqual(report.scope, request.scope)
  assert.equal(report.attemptId, request.attemptId)
  assert.equal(report.siteId, siteId)
  assert.equal(report.toolExecutionId, site.toolExecutionId)
  assert.equal(report.checks.filter((check) => check.status === 'passed').length, 4)
  assert.equal(report.checks.find((check) => check.checkId === 'snapshot.capture')?.status, 'failed')
  assert.equal(report.checks.find((check) => check.checkId === 'http.local')?.status, 'not_run')
  assert.ok(!JSON.stringify(report).includes('PRIVATE_'))
  tools.createSite = async () => { throw error }
  const failedCreate = await runCreateScenario(request, tools, { provenance: 'fixture' })
  assert.equal(failedCreate.siteId, siteId)
  assert.equal(failedCreate.checks.find((check) => check.checkId === 'site.create')?.status, 'failed')
  assert.deepEqual(failedCreate.checks.map((check) => check.checkId), ['site.create', 'snapshot.capture', 'http.local'])
  tools.createSite = async () => site
  tools.captureSnapshot = async () => ({ schemaVersion: 1, provenance: 'fixture', siteId, toolExecutionId: randomUUID(), creationAttemptId: request.attemptId,
    sourceRevision: { kind: 'snapshot', contentHash: 'b'.repeat(64), externalWorkspaceId: siteId },
    themeFiles: {}, databaseHash: 'c'.repeat(64), capturedAt: checkedAt })
  const failedHttp = await runCreateScenario(request, tools, { provenance: 'fixture', smoke: async () => { throw error } })
  assert.equal(failedHttp.checks.find((check) => check.checkId === 'snapshot.capture')?.status, 'passed')
  assert.equal(failedHttp.checks.find((check) => check.checkId === 'http.local')?.status, 'failed')
  assert.ok(failedHttp.snapshot)
})

test('HTTP readiness retries temporary status failures within the same deadline', async () => {
  let requests = 0
  const server = await fixture((_request, response) => {
    requests += 1
    response.statusCode = requests < 3 ? 503 : 200
    response.end(requests < 3 ? 'starting' : 'ready')
  })
  try {
    assert.deepEqual(await smokeLocalUrl(server.url, { timeoutMs: 2000 }), { statusCode: 200, bytes: 5 })
    assert.equal(requests, 3)
  } finally { await server.close() }
})

test('HTTP readiness bounds repeated transient errors and does not retry permanent status', async () => {
  let temporaryRequests = 0
  let permanentRequests = 0
  const temporary = await fixture((_request, response) => { temporaryRequests += 1; response.writeHead(503); response.end('starting') })
  const permanent = await fixture((_request, response) => { permanentRequests += 1; response.writeHead(403); response.end('denied') })
  try {
    const started = Date.now()
    await assert.rejects(smokeLocalUrl(temporary.url, { timeoutMs: 400 }), /http_timeout/)
    assert.ok(Date.now() - started < 2000)
    assert.ok(temporaryRequests >= 2)
    await assert.rejects(smokeLocalUrl(permanent.url, { timeoutMs: 1000 }), /http_smoke_failed/)
    assert.equal(permanentRequests, 1)
  } finally { await Promise.all([temporary.close(), permanent.close()]) }
})

test('HTTP readiness retries a connection reset without exposing error details', async () => {
  let requests = 0
  const server = await fixture((request, response) => {
    requests += 1
    if (requests === 1) request.socket.destroy()
    else response.end('ready')
  })
  try {
    assert.deepEqual(await smokeLocalUrl(server.url, { timeoutMs: 1500 }), { statusCode: 200, bytes: 5 })
    assert.equal(requests, 2)
  } finally { await server.close() }
})

test('HTTP readiness retries only exact self redirects without following Location', async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    let requests = 0
    const server = await fixture((request, response) => {
      requests += 1
      assert.equal(request.url, '/')
      if (requests === 1) { response.writeHead(status, { Location: `http://${request.headers.host}/` }); response.end() }
      else response.end('ready')
    })
    try {
      assert.deepEqual(await smokeLocalUrl(server.url, { timeoutMs: 1500 }), { statusCode: 200, bytes: 5 })
      assert.equal(requests, 2)
    } finally { await server.close() }
  }
})

test('persistent exact self redirects exhaust the single readiness deadline', async () => {
  let requests = 0
  const server = await fixture((_request, response) => { requests += 1; response.writeHead(302, { Location: '/' }); response.end() })
  try {
    const started = Date.now()
    await assert.rejects(smokeLocalUrl(server.url, { timeoutMs: 400 }), /http_timeout/)
    assert.ok(Date.now() - started < 2000)
    assert.ok(requests >= 2)
  } finally { await server.close() }
})

test('redirects changing path, query, credentials or host are rejected immediately', async () => {
  for (const location of ['/other', '/?ready=1', 'http://user@127.0.0.1/', 'http://example.invalid/', 'http://[invalid']) {
    let requests = 0
    const server = await fixture((_request, response) => { requests += 1; response.writeHead(302, { Location: location }); response.end() })
    try {
      await assert.rejects(smokeLocalUrl(server.url, { timeoutMs: 1000 }), /http_smoke_failed_302/)
      assert.equal(requests, 1)
    } finally { await server.close() }
  }
})
