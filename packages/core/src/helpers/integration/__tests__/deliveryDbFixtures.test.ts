import { withClient } from '../dbFixtures'
import { readDeliveryDbCounts, type DeliveryDbSentinel } from '../deliveryDbFixtures'

jest.mock('../dbFixtures', () => ({ withClient: jest.fn() }))

const sentinel: DeliveryDbSentinel = {
  projectId: '11111111-1111-4111-8111-111111111111',
  tenantId: '22222222-2222-4222-8222-222222222222',
  organizationId: '33333333-3333-4333-8333-333333333333',
  runId: 'fixture-run-unique',
  projectName: 'fixture-run-unique-A1',
}
const proof = { id: sentinel.projectId, tenant_id: sentinel.tenantId, organization_id: sentinel.organizationId, name: sentinel.projectName }
const counts = { projects: 1, baselines: 1, tasks: 1, decisions: 2, evidence: 1, attempts: 1, resultManifests: 1 }
const mockWithClient = jest.mocked(withClient)

describe('delivery DB counter environment binding', () => {
  const previousDatabaseUrl = process.env.DATABASE_URL
  const query = jest.fn()

  beforeEach(() => {
    process.env.DATABASE_URL = 'postgres://fixture-user:private-secret@disposable.invalid/qa'
    query.mockReset()
    mockWithClient.mockReset()
    mockWithClient.mockImplementation(async (run) => run({ query }))
  })

  afterAll(() => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousDatabaseUrl
  })

  it.each([undefined, '', '   '])('never invokes the shared env-file fallback when DATABASE_URL is %s', async (databaseUrl) => {
    if (databaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = databaseUrl
    expect(await readDeliveryDbCounts(sentinel)).toMatchObject({ ok: false, status: 'not_run', category: 'environment', reason: 'database_url_missing' })
    expect(mockWithClient).not.toHaveBeenCalled()
  })

  it('rejects a sentinel without the run marker before connecting', async () => {
    expect(await readDeliveryDbCounts({ ...sentinel, projectName: 'another-run-A1' })).toMatchObject({ ok: false, reason: 'invalid_sentinel' })
    expect(mockWithClient).not.toHaveBeenCalled()
  })

  it.each([
    { rows: [] },
    { rows: [{ ...proof, tenant_id: '44444444-4444-4444-8444-444444444444' }] },
    { rows: [{ ...proof, organization_id: '44444444-4444-4444-8444-444444444444' }] },
    { rows: [{ ...proof, id: '44444444-4444-4444-8444-444444444444' }] },
    { rows: [{ ...proof, name: 'old-run-A1' }] },
    { rows: [proof, proof] },
  ])('does not query counters for mismatched sentinel rows %j', async ({ rows }) => {
    query.mockResolvedValueOnce({ rows, rowCount: rows.length })
    expect(await readDeliveryDbCounts(sentinel)).toMatchObject({ ok: false, status: 'not_run', category: 'environment', reason: 'sentinel_mismatch' })
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('binds every counter to the verified project scope and optional attempt target', async () => {
    const taskId = '55555555-5555-4555-8555-555555555555'
    const attemptId = '66666666-6666-4666-8666-666666666666'
    query.mockResolvedValueOnce({ rows: [proof], rowCount: 1 })
    query.mockResolvedValueOnce({ rows: [Object.fromEntries(Object.entries(counts).map(([key, count]) => [key, String(count)]))], rowCount: 1 })
    expect(await readDeliveryDbCounts(sentinel, { taskId, attemptId })).toEqual({ ok: true, counts })
    expect(query).toHaveBeenNthCalledWith(1, expect.stringContaining('and name = $4'), [sentinel.projectId, sentinel.tenantId, sentinel.organizationId, sentinel.projectName])
    expect(query).toHaveBeenNthCalledWith(2, expect.stringContaining('jsonb_array_elements'), [sentinel.projectId, sentinel.tenantId, sentinel.organizationId, taskId, attemptId])
    expect(query.mock.calls.every(([sql]) => !/\b(insert|update|delete|truncate|drop)\b/i.test(String(sql)))).toBe(true)
  })

  it('uses the whole project when no task target is given', async () => {
    query.mockResolvedValueOnce({ rows: [proof], rowCount: 1 })
    query.mockResolvedValueOnce({ rows: [counts], rowCount: 1 })
    expect(await readDeliveryDbCounts(sentinel)).toEqual({ ok: true, counts })
    expect(query.mock.calls[1][1]).toEqual([sentinel.projectId, sentinel.tenantId, sentinel.organizationId, null, null])
  })

  it('does not expose connection errors or credentials', async () => {
    mockWithClient.mockRejectedValueOnce(new Error(`Connection failed: ${process.env.DATABASE_URL}`))
    const result = await readDeliveryDbCounts(sentinel)
    expect(result).toEqual({ ok: false, status: 'not_run', category: 'environment', reason: 'database_query_failed' })
    expect(JSON.stringify(result)).not.toContain('private-secret')
  })

  it('reports query errors after sentinel verification without inventing zero counts', async () => {
    query.mockResolvedValueOnce({ rows: [proof], rowCount: 1 })
    query.mockRejectedValueOnce(new Error('private database details'))
    expect(await readDeliveryDbCounts(sentinel)).toMatchObject({ ok: false, reason: 'database_query_failed' })
  })

  it.each([-1, null, 'unknown'])('rejects malformed database counters %j', async (attempts) => {
    query.mockResolvedValueOnce({ rows: [proof], rowCount: 1 })
    query.mockResolvedValueOnce({ rows: [{ ...counts, attempts }], rowCount: 1 })
    expect(await readDeliveryDbCounts(sentinel)).toMatchObject({ ok: false, reason: 'invalid_database_result' })
  })
})
