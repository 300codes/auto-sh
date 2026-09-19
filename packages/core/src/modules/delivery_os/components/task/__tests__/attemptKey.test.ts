import { idempotencyKeySchema, type SourceRevision } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { buildAttemptIdempotencyKey } from '../attemptKey'
import { parseRevisionDraft, emptyRevisionDraft } from '../baseRevision'

const taskId = '33333333-3333-4333-8333-333333333333'
const gitRevision: SourceRevision = { kind: 'git', commitSha: 'a'.repeat(40) }
const snapshotRevision: SourceRevision = {
  kind: 'snapshot',
  contentHash: 'b'.repeat(64),
  externalWorkspaceId: 'wp-demo',
}

describe('buildAttemptIdempotencyKey', () => {
  it('is stable for the same task, revision and attempt number, so a repeated click lands on the same attempt', () => {
    const first = buildAttemptIdempotencyKey({ taskId, baseRevision: gitRevision, attemptNumber: 0 })
    const second = buildAttemptIdempotencyKey({ taskId, baseRevision: gitRevision, attemptNumber: 0 })
    expect(first).toBe(second)
  })

  it.each([
    ['task', { taskId: '44444444-4444-4444-8444-444444444444', baseRevision: gitRevision, attemptNumber: 0 }],
    ['attempt number', { taskId, baseRevision: gitRevision, attemptNumber: 1 }],
    ['revision kind', { taskId, baseRevision: snapshotRevision, attemptNumber: 0 }],
    ['commit', { taskId, baseRevision: { kind: 'git', commitSha: 'c'.repeat(40) } as SourceRevision, attemptNumber: 0 }],
  ])('changes when the %s changes', (_label, input) => {
    expect(buildAttemptIdempotencyKey(input)).not.toBe(
      buildAttemptIdempotencyKey({ taskId, baseRevision: gitRevision, attemptNumber: 0 }),
    )
  })

  it('separates two snapshots that differ only in the workspace they came from', () => {
    const other: SourceRevision = { ...snapshotRevision, externalWorkspaceId: 'wp-other' }
    expect(buildAttemptIdempotencyKey({ taskId, baseRevision: snapshotRevision, attemptNumber: 0 }))
      .not.toBe(buildAttemptIdempotencyKey({ taskId, baseRevision: other, attemptNumber: 0 }))
  })

  it.each([
    ['git', gitRevision],
    ['snapshot', snapshotRevision],
    ['snapshot with a hostile workspace id', {
      kind: 'snapshot',
      contentHash: 'b'.repeat(64),
      externalWorkspaceId: `${'workspace with spaces and ümlauts '.repeat(6)}`,
    } as SourceRevision],
  ])('satisfies the Idempotency-Key header contract for a %s revision', (_label, revision) => {
    const key = buildAttemptIdempotencyKey({ taskId, baseRevision: revision, attemptNumber: 3 })
    expect(idempotencyKeySchema.safeParse(key).success).toBe(true)
    expect(key.length).toBeLessThanOrEqual(200)
  })
})

describe('parseRevisionDraft', () => {
  it('names the field a git revision is missing instead of calling the whole revision invalid', () => {
    const result = parseRevisionDraft('git', emptyRevisionDraft)
    expect(result).toEqual({ ok: false, field: 'commitSha' })
  })

  it('names the workspace id separately from the content hash', () => {
    const result = parseRevisionDraft('snapshot', { ...emptyRevisionDraft, contentHash: 'b'.repeat(64) })
    expect(result).toEqual({ ok: false, field: 'externalWorkspaceId' })
  })

  it('accepts a well-formed revision of each kind', () => {
    expect(parseRevisionDraft('git', { ...emptyRevisionDraft, commitSha: ` ${'a'.repeat(40)} ` }))
      .toEqual({ ok: true, revision: gitRevision })
    expect(parseRevisionDraft('snapshot', { commitSha: '', contentHash: 'b'.repeat(64), externalWorkspaceId: 'wp-demo' }))
      .toEqual({ ok: true, revision: snapshotRevision })
  })
})
