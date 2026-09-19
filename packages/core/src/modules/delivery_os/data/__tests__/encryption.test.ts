import { defaultEncryptionMaps } from '../../encryption'

describe('delivery_os defaultEncryptionMaps', () => {
  it('encrypts the intake brief and questions, the client approval PII and the comment authors and bodies', () => {
    const byEntity = new Map(defaultEncryptionMaps.map((entry) => [entry.entityId, entry.fields.map((field) => field.field)]))
    expect([...byEntity.keys()].sort()).toEqual([
      'delivery_os:delivery_comment_reply',
      'delivery_os:delivery_comment_thread',
      'delivery_os:delivery_design_import_session',
      'delivery_os:delivery_flow_stage_decision',
      'delivery_os:delivery_intake',
      'delivery_os:delivery_staff_import_intent',
    ])
    expect(byEntity.get('delivery_os:delivery_design_import_session')).toEqual(['manifest', 'progress'])
    expect(byEntity.get('delivery_os:delivery_staff_import_intent')).toEqual(['payload'])
    expect(byEntity.get('delivery_os:delivery_comment_thread')).toEqual(['author', 'body'])
    expect(byEntity.get('delivery_os:delivery_comment_reply')).toEqual(['author', 'body'])
    expect(byEntity.get('delivery_os:delivery_intake')).toEqual(['brief', 'questions'])
    expect(byEntity.get('delivery_os:delivery_flow_stage_decision')).toEqual([
      'client_approver_name',
      'client_approval_evidence',
    ])
  })

  it('never encrypts hashes or lookup keys', () => {
    const fields = defaultEncryptionMaps.flatMap((entry) => entry.fields.map((field) => field.field))
    for (const field of ['content_hash', 'subject_hash', 'idempotency_key', 'request_hash', 'project_id', 'thread_key', 'comment_key', 'file_key', 'staff_task_id']) {
      expect(fields).not.toContain(field)
    }
  })
})
