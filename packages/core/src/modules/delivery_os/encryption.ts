import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'delivery_os:delivery_intake',
    fields: [{ field: 'brief' }, { field: 'questions' }],
  },
  {
    entityId: 'delivery_os:delivery_flow_stage_decision',
    fields: [{ field: 'client_approver_name' }, { field: 'client_approval_evidence' }],
  },
  {
    entityId: 'delivery_os:delivery_comment_thread',
    fields: [{ field: 'author' }, { field: 'body' }],
  },
  {
    entityId: 'delivery_os:delivery_comment_reply',
    fields: [{ field: 'author' }, { field: 'body' }],
  },
]

export default defaultEncryptionMaps
