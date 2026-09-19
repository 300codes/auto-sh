import { createModuleEvents, type EventPayloadSchema, type EventPayloadSchemaField } from '@open-mercato/shared/modules/events'

const scopeFields: EventPayloadSchemaField[] = [
  { path: 'tenantId', type: 'text' },
  { path: 'organizationId', type: 'text' },
]

const projectCreatedPayloadSchema: EventPayloadSchema = {
  fields: [
    { path: 'projectId', type: 'text' },
    ...scopeFields,
  ],
}

const baselineApprovedPayloadSchema: EventPayloadSchema = {
  fields: [
    { path: 'projectId', type: 'text' },
    { path: 'baselineId', type: 'text' },
    { path: 'version', type: 'number' },
    { path: 'contentHash', type: 'text' },
    { path: 'activeBaselineId', type: 'text' },
    ...scopeFields,
  ],
}

const taskUpdatedPayloadSchema: EventPayloadSchema = {
  fields: [
    { path: 'projectId', type: 'text' },
    { path: 'taskId', type: 'text' },
    { path: 'status', type: 'text' },
    { path: 'statusReason', type: 'text', optional: true },
    { path: 'updatedAt', type: 'date' },
    ...scopeFields,
  ],
}

const evidenceRecordedPayloadSchema: EventPayloadSchema = {
  fields: [
    { path: 'projectId', type: 'text' },
    { path: 'taskId', type: 'text', optional: true },
    { path: 'attemptId', type: 'text', optional: true },
    { path: 'evidenceId', type: 'text' },
    { path: 'kind', type: 'text' },
    { path: 'duplicate', type: 'boolean' },
    { path: 'completionDelivery', type: 'select', optional: true },
    ...scopeFields,
  ],
}

const events = [
  {
    id: 'delivery_os.project.created',
    label: 'Delivery Project Created',
    entity: 'project',
    category: 'crud',
    payloadSchema: projectCreatedPayloadSchema,
  },
  {
    id: 'delivery_os.baseline.approved',
    label: 'Delivery Baseline Approved',
    entity: 'baseline',
    category: 'lifecycle',
    payloadSchema: baselineApprovedPayloadSchema,
  },
  {
    id: 'delivery_os.task.updated',
    label: 'Delivery Task Updated',
    entity: 'task',
    category: 'lifecycle',
    clientBroadcast: true,
    payloadSchema: taskUpdatedPayloadSchema,
  },
  {
    id: 'delivery_os.evidence.recorded',
    label: 'Delivery Evidence Recorded',
    entity: 'evidence',
    category: 'lifecycle',
    clientBroadcast: true,
    payloadSchema: evidenceRecordedPayloadSchema,
  },
] as const

export const DELIVERY_OS_EVENT_IDS = events.map((event) => event.id)

export const eventsConfig = createModuleEvents({
  moduleId: 'delivery_os',
  events,
})

export const emitDeliveryOsEvent = eventsConfig.emit

export type DeliveryOsEventId = typeof events[number]['id']

export default eventsConfig
