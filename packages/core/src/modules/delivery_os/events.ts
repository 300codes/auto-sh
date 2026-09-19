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

const flowPinnedPayloadSchema: EventPayloadSchema = {
  fields: [
    { path: 'projectId', type: 'text' },
    { path: 'templateId', type: 'text' },
    { path: 'templateVersion', type: 'number' },
    { path: 'templateHash', type: 'text' },
    ...scopeFields,
  ],
}

const stageArtifactCreatedPayloadSchema: EventPayloadSchema = {
  fields: [
    { path: 'projectId', type: 'text' },
    { path: 'stageId', type: 'text' },
    { path: 'artifactId', type: 'text' },
    { path: 'version', type: 'number' },
    { path: 'contentHash', type: 'text' },
    { path: 'downstreamNowStale', type: 'object' },
    ...scopeFields,
  ],
}

const stageDecidedPayloadSchema: EventPayloadSchema = {
  fields: [
    { path: 'projectId', type: 'text' },
    { path: 'stageId', type: 'text' },
    { path: 'artifactId', type: 'text' },
    { path: 'decisionId', type: 'text' },
    { path: 'verdict', type: 'select' },
    { path: 'currency', type: 'select' },
    ...scopeFields,
  ],
}

const commentThreadImportedPayloadSchema: EventPayloadSchema = {
  fields: [
    { path: 'projectId', type: 'text' },
    { path: 'threadId', type: 'text' },
    { path: 'staffTaskId', type: 'text', optional: true },
    { path: 'outcome', type: 'select' },
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
  {
    id: 'delivery_os.flow.pinned',
    label: 'Delivery Flow Template Pinned',
    entity: 'flow',
    category: 'lifecycle',
    payloadSchema: flowPinnedPayloadSchema,
  },
  {
    id: 'delivery_os.stage.artifact_created',
    label: 'Delivery Stage Artifact Created',
    entity: 'stage',
    category: 'lifecycle',
    clientBroadcast: true,
    payloadSchema: stageArtifactCreatedPayloadSchema,
  },
  {
    id: 'delivery_os.stage.decided',
    label: 'Delivery Stage Decided',
    entity: 'stage',
    category: 'lifecycle',
    clientBroadcast: true,
    payloadSchema: stageDecidedPayloadSchema,
  },
  {
    id: 'delivery_os.comment_thread.imported',
    label: 'Delivery Comment Thread Imported',
    entity: 'comment_thread',
    category: 'lifecycle',
    payloadSchema: commentThreadImportedPayloadSchema,
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
