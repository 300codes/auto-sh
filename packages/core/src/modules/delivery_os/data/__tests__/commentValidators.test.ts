import { deliveryErrorFromZod } from '../../lib/contracts'
import { loadCommentImportFixture } from '../../lib/fixtures/flow/index'
import {
  commentImportCommandSchema,
  commentThreadListQuerySchema,
  commentThreadTriageCommandSchema,
  staffLinkCommandSchema,
} from '../validators'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_PROJECT_ID = '99999999-9999-4999-8999-999999999999'
const THREAD_ID = 'ccccccc1-cccc-4ccc-8ccc-ccccccccccc1'
const STAFF_PROJECT_ID = 'fffffff1-ffff-4fff-8fff-fffffffffff1'
const HASH = 'a'.repeat(64)

describe('flow F2 validators (F10–F13)', () => {
  it('F10 accepts a staff link request bound to the path project and rejects scope keys', () => {
    const parsed = staffLinkCommandSchema.safeParse({ projectId: PROJECT_ID, staffProjectId: STAFF_PROJECT_ID, tenantId: 'x' })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data).toEqual({ projectId: PROJECT_ID, staffProjectId: STAFF_PROJECT_ID })
    expect(staffLinkCommandSchema.safeParse({ projectId: PROJECT_ID, staffProjectId: 'not-a-uuid' }).success).toBe(false)
  })

  it('F11 binds the batch to the path project and requires an idempotency key', () => {
    const batch = loadCommentImportFixture()
    expect(commentImportCommandSchema.safeParse({ projectId: batch.projectId, idempotencyKey: 'import-1', batch }).success).toBe(true)
    const foreign = commentImportCommandSchema.safeParse({ projectId: OTHER_PROJECT_ID, idempotencyKey: 'import-1', batch })
    expect(foreign.success).toBe(false)
    if (!foreign.success) expect(deliveryErrorFromZod(foreign.error).body.code).toBe('foreign_reference')
    expect(commentImportCommandSchema.safeParse({ projectId: batch.projectId, idempotencyKey: '', batch }).success).toBe(false)
  })

  it('F11 rejects a batch with duplicate thread keys', () => {
    const batch = loadCommentImportFixture()
    const duplicated = { ...batch, threads: [batch.threads[0], batch.threads[0]] }
    const parsed = commentImportCommandSchema.safeParse({ projectId: batch.projectId, idempotencyKey: 'import-1', batch: duplicated })
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(deliveryErrorFromZod(parsed.error).body.code).toBe('duplicate_stable_id')
  })

  it('F12 list query defaults paging, caps pageSize at 100 and validates filters', () => {
    const defaults = commentThreadListQuerySchema.parse({})
    expect(defaults).toEqual({ page: 1, pageSize: 50 })
    const filtered = commentThreadListQuerySchema.parse({ stageId: 'ux', status: 'open', triage: 'new', page: '2', pageSize: '100' })
    expect(filtered).toEqual({ stageId: 'ux', status: 'open', triage: 'new', page: 2, pageSize: 100 })
    expect(commentThreadListQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false)
    expect(commentThreadListQuerySchema.safeParse({ stageId: 'design' }).success).toBe(false)
    expect(commentThreadListQuerySchema.safeParse({ triage: 'done' }).success).toBe(false)
    expect(commentThreadListQuerySchema.safeParse({ status: 'closed' }).success).toBe(false)
  })

  it('F13 requires a deferral for deferred triage and accepts a linked task', () => {
    const base = { projectId: PROJECT_ID, threadId: THREAD_ID }
    expect(commentThreadTriageCommandSchema.safeParse({ ...base, triage: { triageStatus: 'triaged' } }).success).toBe(true)
    const deferredWithout = commentThreadTriageCommandSchema.safeParse({ ...base, triage: { triageStatus: 'deferred' } })
    expect(deferredWithout.success).toBe(false)
    if (!deferredWithout.success) expect(deliveryErrorFromZod(deferredWithout.error).body.code).toBe('reason_required')
    const deferred = commentThreadTriageCommandSchema.safeParse({
      ...base,
      triage: {
        triageStatus: 'deferred',
        deferral: { artifactId: 'aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2', contentHash: HASH, reason: 'Next version' },
        linkedDeliveryTaskId: 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
      },
    })
    expect(deferred.success).toBe(true)
  })
})
