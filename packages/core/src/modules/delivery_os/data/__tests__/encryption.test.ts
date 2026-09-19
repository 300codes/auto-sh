import { defaultEncryptionMaps } from '../../encryption'

describe('delivery_os defaultEncryptionMaps', () => {
  it('encrypts the intake brief and questions and the client approval PII', () => {
    const byEntity = new Map(defaultEncryptionMaps.map((entry) => [entry.entityId, entry.fields.map((field) => field.field)]))
    expect([...byEntity.keys()].sort()).toEqual(['delivery_os:delivery_flow_stage_decision', 'delivery_os:delivery_intake'])
    expect(byEntity.get('delivery_os:delivery_intake')).toEqual(['brief', 'questions'])
    expect(byEntity.get('delivery_os:delivery_flow_stage_decision')).toEqual([
      'client_approver_name',
      'client_approval_evidence',
    ])
  })

  it('never encrypts hashes or lookup keys', () => {
    const fields = defaultEncryptionMaps.flatMap((entry) => entry.fields.map((field) => field.field))
    for (const field of ['content_hash', 'subject_hash', 'idempotency_key', 'request_hash', 'project_id']) {
      expect(fields).not.toContain(field)
    }
  })
})
