import { OptionalProps } from '@mikro-orm/core'
import { Check, Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'
import type {
  AttachmentRef,
  BriefV1,
  CommentAuthor,
  CommentThreadDeferral,
  CommentThreadTriageStatus,
  DeliveryEvidenceKind,
  DeliveryLimits,
  ExecutionAttempt,
  FlowStageId,
  FlowTemplateV1,
  IntakeQuestion,
  IntakeStep,
  PlatformChoice,
  PlatformRecommendation,
  PublicationResultV1,
  SourceRevision,
  StageArtifactDependency,
  StageArtifactV1,
  StageDecisionVerdict,
  StaffSyncCursor,
  ToolChoice,
} from '@open-mercato/core/modules/delivery_os/lib/contracts'
import type { TaskStatus } from './validators'

export type DeliveryInputMode = 'from_brief' | 'from_design'
export type DeliveryBaselineSource = 'manual' | 'requirements_proposal' | 'plan_proposal'
export type DeliveryTaskStatus = TaskStatus
export type DeliveryEvidenceSource = 'adapter' | 'manual'
export type DeliveryDecisionKind = 'requirements' | 'design' | 'deploy' | 'release'
export type DeliveryDecisionSubjectType = 'baseline' | 'deployment_evidence'
export type DeliveryDecisionVerdict = 'approved' | 'rejected'
export type DeliveryFlowStageArtifactSource = StageArtifactV1['source']
export type DeliveryIntakeProposalRef = {
  proposalId: string
  kind: 'scope' | 'platform'
  contentHash: string
  proposedAt: string
  status: 'proposed' | 'accepted' | 'discarded'
}
export type DeliveryIntakePlatform = {
  recommendation: PlatformRecommendation | null
  chosen: PlatformChoice | null
}
export type DeliveryIntakeImportedManifest = { manifestId: string; manifestHash: string }
export type DeliveryClientApprovalEvidence = {
  kind: 'email' | 'meeting' | 'signed_document' | 'other'
  reference: string
  attachment: AttachmentRef | null
  recordedAt: string
}

@Entity({ tableName: 'delivery_projects' })
@Index({ name: 'delivery_projects_scope_deleted_idx', properties: ['tenantId', 'organizationId', 'deletedAt'] })
@Index({ name: 'delivery_projects_scope_created_idx', properties: ['tenantId', 'organizationId', 'createdAt'] })
@Index({
  name: 'delivery_projects_scope_flow_template_idx',
  properties: ['tenantId', 'organizationId', 'flowTemplateId', 'flowTemplateVersion'],
})
export class DeliveryProject {
  [OptionalProps]?: 'draftSpec' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ name: 'input_mode', type: 'text' })
  inputMode!: DeliveryInputMode

  @Property({ type: 'text', nullable: true })
  brief?: string | null

  @Property({ name: 'target_profile_id', type: 'text' })
  targetProfileId!: string

  @Property({ name: 'target_profile_version', type: 'integer' })
  targetProfileVersion!: number

  @Property({ name: 'repository_ref', type: 'text', nullable: true })
  repositoryRef?: string | null

  @Property({ name: 'draft_spec', type: 'jsonb', defaultRaw: "'{}'", nullable: false })
  draftSpec: Record<string, unknown> = {}

  @Property({ name: 'active_baseline_id', type: 'uuid', nullable: true })
  activeBaselineId?: string | null

  @Property({ type: 'jsonb' })
  limits!: DeliveryLimits

  @Property({ name: 'flow_template_id', type: 'text', nullable: true })
  flowTemplateId?: string | null

  @Property({ name: 'flow_template_version', type: 'integer', nullable: true })
  flowTemplateVersion?: number | null

  @Property({ name: 'flow_template_hash', type: 'text', nullable: true })
  flowTemplateHash?: string | null

  @Property({ name: 'flow_template_snapshot', type: 'jsonb', nullable: true })
  flowTemplateSnapshot?: FlowTemplateV1 | null

  @Property({ name: 'flow_pinned_at', type: Date, nullable: true })
  flowPinnedAt?: Date | null

  @Property({ name: 'flow_workflow_instance_id', type: 'uuid', nullable: true })
  flowWorkflowInstanceId?: string | null

  @Property({ name: 'flow_workflow_definition_id', type: 'uuid', nullable: true })
  flowWorkflowDefinitionId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'delivery_baselines' })
@Unique({
  name: 'delivery_baselines_project_version_uq',
  properties: ['tenantId', 'organizationId', 'projectId', 'version'],
})
@Unique({
  name: 'delivery_baselines_project_hash_uq',
  properties: ['tenantId', 'organizationId', 'projectId', 'contentHash'],
})
export class DeliveryBaseline {
  [OptionalProps]?: 'attachmentIds' | 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'project_id', type: 'uuid' })
  projectId!: string

  @Property({ type: 'integer' })
  version!: number

  @Property({ name: 'content_hash', type: 'text' })
  contentHash!: string

  @Property({ type: 'text' })
  source!: DeliveryBaselineSource

  @Property({ name: 'parent_baseline_id', type: 'uuid', nullable: true })
  parentBaselineId?: string | null

  @Property({ type: 'jsonb' })
  content!: Record<string, unknown>

  @Property({ name: 'attachment_ids', type: 'jsonb', default: [], nullable: false })
  attachmentIds: string[] = []

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'delivery_tasks' })
@Index({
  name: 'delivery_tasks_scope_project_deleted_idx',
  properties: ['tenantId', 'organizationId', 'projectId', 'deletedAt'],
})
@Index({
  name: 'delivery_tasks_proposal_key_uq',
  expression:
    'create unique index "delivery_tasks_proposal_key_uq" on "delivery_tasks" ("tenant_id", "organization_id", "project_id", "baseline_id", "proposal_task_key") where "proposal_task_key" is not null',
})
export class DeliveryTask {
  [OptionalProps]?:
    | 'dependsOnTaskIds'
    | 'allowedPaths'
    | 'status'
    | 'attemptNumber'
    | 'executionAttempts'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'project_id', type: 'uuid' })
  projectId!: string

  @Property({ name: 'baseline_id', type: 'uuid' })
  baselineId!: string

  @Property({ type: 'text' })
  title!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'ac_ids', type: 'jsonb' })
  acIds!: string[]

  @Property({ name: 'depends_on_task_ids', type: 'jsonb', default: [], nullable: false })
  dependsOnTaskIds: string[] = []

  @Property({ name: 'allowed_paths', type: 'jsonb', default: [], nullable: false })
  allowedPaths: string[] = []

  @Property({ name: 'target_profile_id', type: 'text' })
  targetProfileId!: string

  @Property({ name: 'target_profile_version', type: 'integer' })
  targetProfileVersion!: number

  @Property({ type: 'text', default: 'draft' })
  status: DeliveryTaskStatus = 'draft'

  @Property({ name: 'status_reason', type: 'text', nullable: true })
  statusReason?: string | null

  @Property({ name: 'attempt_number', type: 'integer', default: 0 })
  attemptNumber: number = 0

  @Property({ name: 'execution_attempts', type: 'jsonb', default: [], nullable: false })
  executionAttempts: ExecutionAttempt[] = []

  @Property({ name: 'proposal_task_key', type: 'text', nullable: true })
  proposalTaskKey?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'delivery_evidence' })
@Index({
  name: 'delivery_evidence_scope_project_kind_idx',
  properties: ['tenantId', 'organizationId', 'projectId', 'kind'],
})
@Index({ name: 'delivery_evidence_scope_task_idx', properties: ['tenantId', 'organizationId', 'taskId'] })
@Index({
  name: 'delivery_evidence_scope_project_kind_hash_idx',
  properties: ['tenantId', 'organizationId', 'projectId', 'kind', 'payloadHash'],
})
@Index({
  name: 'delivery_evidence_result_manifest_uq',
  expression:
    `create unique index "delivery_evidence_result_manifest_uq" on "delivery_evidence" ("tenant_id", "organization_id", "task_id", "attempt_id") where "kind" = 'result_manifest'`,
})
@Check({
  name: 'delivery_evidence_result_manifest_attempt_chk',
  expression: `"kind" <> 'result_manifest' or ("task_id" is not null and "attempt_id" is not null)`,
})
export class DeliveryEvidence {
  [OptionalProps]?: 'attachmentIds' | 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'project_id', type: 'uuid' })
  projectId!: string

  @Property({ name: 'baseline_id', type: 'uuid' })
  baselineId!: string

  @Property({ name: 'task_id', type: 'uuid', nullable: true })
  taskId?: string | null

  @Property({ name: 'attempt_id', type: 'uuid', nullable: true })
  attemptId?: string | null

  @Property({ type: 'text' })
  kind!: DeliveryEvidenceKind

  @Property({ type: 'text' })
  source!: DeliveryEvidenceSource

  @Property({ name: 'source_revision', type: 'jsonb', nullable: true })
  sourceRevision?: SourceRevision | null

  @Property({ type: 'jsonb' })
  payload!: Record<string, unknown>

  @Property({ name: 'payload_hash', type: 'text' })
  payloadHash!: string

  @Property({ name: 'raw_report_hash', type: 'text', nullable: true })
  rawReportHash?: string | null

  @Property({ name: 'attachment_ids', type: 'jsonb', default: [], nullable: false })
  attachmentIds: string[] = []

  @Property({ name: 'recorded_by', type: 'uuid', nullable: true })
  recordedBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'delivery_decisions' })
@Index({
  name: 'delivery_decisions_scope_project_kind_decided_idx',
  properties: ['tenantId', 'organizationId', 'projectId', 'kind', 'decidedAt'],
})
export class DeliveryDecision {
  [OptionalProps]?: 'decidedAt' | 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'project_id', type: 'uuid' })
  projectId!: string

  @Property({ type: 'text' })
  kind!: DeliveryDecisionKind

  @Property({ name: 'subject_type', type: 'text' })
  subjectType!: DeliveryDecisionSubjectType

  @Property({ name: 'subject_id', type: 'uuid' })
  subjectId!: string

  @Property({ name: 'subject_hash', type: 'text' })
  subjectHash!: string

  @Property({ name: 'subject_version', type: 'integer', nullable: true })
  subjectVersion?: number | null

  @Property({ name: 'source_revision', type: 'jsonb', nullable: true })
  sourceRevision?: SourceRevision | null

  @Property({ type: 'text' })
  verdict!: DeliveryDecisionVerdict

  @Property({ type: 'text', nullable: true })
  reason?: string | null

  @Property({ name: 'actor_user_id', type: 'uuid' })
  actorUserId!: string

  @Property({ name: 'decided_at', type: Date, onCreate: () => new Date() })
  decidedAt: Date = new Date()

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'delivery_intakes' })
@Unique({ name: 'delivery_intakes_scope_project_uq', properties: ['tenantId', 'organizationId', 'projectId'] })
export class DeliveryIntake {
  [OptionalProps]?:
    | 'step'
    | 'questions'
    | 'proposals'
    | 'tools'
    | 'importedManifests'
    | 'createdAt'
    | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'project_id', type: 'uuid' })
  projectId!: string

  @Property({ name: 'schema_version', type: 'text' })
  schemaVersion!: string

  @Property({ type: 'text', default: 'brief' })
  step: IntakeStep = 'brief'

  @Property({ type: 'jsonb' })
  brief!: BriefV1

  @Property({ type: 'jsonb', default: [], nullable: false })
  questions: IntakeQuestion[] = []

  @Property({ type: 'jsonb', default: [], nullable: false })
  proposals: DeliveryIntakeProposalRef[] = []

  @Property({ type: 'jsonb' })
  platform!: DeliveryIntakePlatform

  @Property({ type: 'jsonb', default: [], nullable: false })
  tools: ToolChoice[] = []

  @Property({ name: 'imported_manifests', type: 'jsonb', default: [], nullable: false })
  importedManifests: DeliveryIntakeImportedManifest[] = []

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'delivery_flow_stage_artifacts' })
@Unique({
  name: 'delivery_flow_stage_artifacts_project_stage_version_uq',
  properties: ['tenantId', 'organizationId', 'projectId', 'stageId', 'version'],
})
@Unique({
  name: 'delivery_flow_stage_artifacts_project_stage_hash_uq',
  properties: ['tenantId', 'organizationId', 'projectId', 'stageId', 'contentHash'],
})
export class DeliveryFlowStageArtifact {
  [OptionalProps]?: 'dependsOn' | 'attachmentIds' | 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'project_id', type: 'uuid' })
  projectId!: string

  @Property({ name: 'stage_id', type: 'text' })
  stageId!: FlowStageId

  @Property({ type: 'integer' })
  version!: number

  @Property({ name: 'content_hash', type: 'text' })
  contentHash!: string

  @Property({ type: 'text' })
  source!: DeliveryFlowStageArtifactSource

  @Property({ type: 'jsonb' })
  content!: Record<string, unknown>

  @Property({ name: 'depends_on', type: 'jsonb', default: [], nullable: false })
  dependsOn: StageArtifactDependency[] = []

  @Property({ name: 'attachment_ids', type: 'jsonb', default: [], nullable: false })
  attachmentIds: string[] = []

  @Property({ name: 'template_hash', type: 'text' })
  templateHash!: string

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'delivery_flow_stage_decisions' })
@Index({
  name: 'delivery_flow_stage_decisions_scope_project_stage_decided_idx',
  properties: ['tenantId', 'organizationId', 'projectId', 'stageId', 'decidedAt'],
})
@Unique({
  name: 'delivery_flow_stage_decisions_project_idempotency_uq',
  properties: ['tenantId', 'organizationId', 'projectId', 'idempotencyKey'],
})
export class DeliveryFlowStageDecision {
  [OptionalProps]?: 'deferredThreadKeys' | 'decidedAt' | 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'project_id', type: 'uuid' })
  projectId!: string

  @Property({ name: 'stage_id', type: 'text' })
  stageId!: FlowStageId

  @Property({ name: 'artifact_id', type: 'uuid' })
  artifactId!: string

  @Property({ name: 'subject_hash', type: 'text' })
  subjectHash!: string

  @Property({ name: 'subject_version', type: 'integer' })
  subjectVersion!: number

  @Property({ type: 'text' })
  verdict!: StageDecisionVerdict

  @Property({ type: 'text', nullable: true })
  reason?: string | null

  @Property({ name: 'actor_user_id', type: 'uuid' })
  actorUserId!: string

  @Property({ name: 'decided_at', type: Date, onCreate: () => new Date() })
  decidedAt: Date = new Date()

  @Property({ name: 'client_approver_name', type: 'text', nullable: true })
  clientApproverName?: string | null

  @Property({ name: 'client_approver_role', type: 'text', nullable: true })
  clientApproverRole?: string | null

  @Property({ name: 'client_approval_evidence', type: 'jsonb', nullable: true })
  clientApprovalEvidence?: DeliveryClientApprovalEvidence | null

  @Property({ name: 'deferred_thread_keys', type: 'jsonb', default: [], nullable: false })
  deferredThreadKeys: string[] = []

  @Property({ name: 'template_hash', type: 'text' })
  templateHash!: string

  @Property({ name: 'idempotency_key', type: 'text' })
  idempotencyKey!: string

  @Property({ name: 'request_hash', type: 'text' })
  requestHash!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'delivery_staff_links' })
@Unique({ name: 'delivery_staff_links_scope_project_uq', properties: ['tenantId', 'organizationId', 'projectId'] })
@Unique({ name: 'delivery_staff_links_scope_staff_project_uq', properties: ['tenantId', 'organizationId', 'staffProjectId'] })
export class DeliveryStaffLink {
  [OptionalProps]?: 'syncCursors' | 'linkedAt' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'project_id', type: 'uuid' })
  projectId!: string

  @Property({ name: 'staff_project_id', type: 'uuid' })
  staffProjectId!: string

  @Property({ name: 'linked_by', type: 'uuid' })
  linkedBy!: string

  @Property({ name: 'linked_at', type: Date, onCreate: () => new Date() })
  linkedAt: Date = new Date()

  @Property({ name: 'sync_cursors', type: 'jsonb', defaultRaw: "'{}'", nullable: false })
  syncCursors: Record<string, StaffSyncCursor> = {}

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'delivery_comment_threads' })
@Unique({
  name: 'delivery_comment_threads_scope_file_thread_uq',
  properties: ['tenantId', 'organizationId', 'projectId', 'source', 'fileKey', 'threadKey'],
})
@Index({ name: 'delivery_comment_threads_scope_staff_task_idx', properties: ['tenantId', 'organizationId', 'staffTaskId'] })
@Index({
  name: 'delivery_comment_threads_scope_project_stage_idx',
  properties: ['tenantId', 'organizationId', 'projectId', 'stageId'],
})
export class DeliveryCommentThread {
  [OptionalProps]?: 'versionConfirmed' | 'triageStatus' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'project_id', type: 'uuid' })
  projectId!: string

  @Property({ type: 'text' })
  source!: 'figma'

  @Property({ name: 'file_key', type: 'text' })
  fileKey!: string

  @Property({ name: 'thread_key', type: 'text' })
  threadKey!: string

  @Property({ name: 'stage_id', type: 'text' })
  stageId!: FlowStageId

  @Property({ name: 'artifact_id', type: 'uuid', nullable: true })
  artifactId?: string | null

  @Property({ name: 'node_id', type: 'text', nullable: true })
  nodeId?: string | null

  @Property({ name: 'source_url', type: 'text' })
  sourceUrl!: string

  @Property({ type: 'jsonb' })
  author!: CommentAuthor

  @Property({ type: 'text' })
  body!: string

  @Property({ name: 'source_created_at', type: Date })
  sourceCreatedAt!: Date

  @Property({ name: 'source_updated_at', type: Date, nullable: true })
  sourceUpdatedAt?: Date | null

  @Property({ name: 'source_status', type: 'text' })
  sourceStatus!: 'open' | 'resolved' | 'deleted'

  @Property({ name: 'figma_version', type: 'text', nullable: true })
  figmaVersion?: string | null

  @Property({ name: 'version_confirmed', type: 'boolean', default: false })
  versionConfirmed: boolean = false

  @Property({ name: 'fetched_at', type: Date })
  fetchedAt!: Date

  @Property({ name: 'staff_task_id', type: 'uuid', nullable: true })
  staffTaskId?: string | null

  @Property({ name: 'triage_status', type: 'text', default: 'new' })
  triageStatus: CommentThreadTriageStatus = 'new'

  @Property({ type: 'jsonb', nullable: true })
  deferral?: CommentThreadDeferral | null

  @Property({ name: 'linked_delivery_task_id', type: 'uuid', nullable: true })
  linkedDeliveryTaskId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'delivery_comment_replies' })
@Unique({
  name: 'delivery_comment_replies_scope_thread_comment_revision_uq',
  properties: ['tenantId', 'organizationId', 'threadId', 'commentKey', 'revision'],
})
@Index({ name: 'delivery_comment_replies_scope_thread_idx', properties: ['tenantId', 'organizationId', 'threadId'] })
export class DeliveryCommentReply {
  [OptionalProps]?: 'deleted' | 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'thread_id', type: 'uuid' })
  threadId!: string

  @Property({ name: 'comment_key', type: 'text' })
  commentKey!: string

  @Property({ type: 'integer' })
  revision!: number

  @Property({ type: 'jsonb' })
  author!: CommentAuthor

  @Property({ type: 'text' })
  body!: string

  @Property({ name: 'source_created_at', type: Date })
  sourceCreatedAt!: Date

  @Property({ name: 'edited_at', type: Date, nullable: true })
  editedAt?: Date | null

  @Property({ type: 'boolean', default: false })
  deleted: boolean = false

  @Property({ name: 'staff_comment_id', type: 'uuid', nullable: true })
  staffCommentId?: string | null

  @Property({ name: 'fetched_at', type: Date })
  fetchedAt!: Date

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

export type DeliveryPublicationTarget = PublicationResultV1['target']
export type DeliveryPublicationVerification = PublicationResultV1['verification']

@Entity({ tableName: 'delivery_publications' })
@Index({
  name: 'delivery_publications_scope_project_created_idx',
  properties: ['tenantId', 'organizationId', 'projectId', 'createdAt'],
})
@Unique({
  name: 'delivery_publications_scope_project_payload_hash_uq',
  properties: ['tenantId', 'organizationId', 'projectId', 'payloadHash'],
})
export class DeliveryPublication {
  [OptionalProps]?: 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'project_id', type: 'uuid' })
  projectId!: string

  @Property({ name: 'baseline_id', type: 'uuid' })
  baselineId!: string

  @Property({ name: 'source_revision', type: 'jsonb' })
  sourceRevision!: SourceRevision

  @Property({ name: 'snapshot_ref', type: 'jsonb', nullable: true })
  snapshotRef?: AttachmentRef | null

  @Property({ type: 'jsonb' })
  target!: DeliveryPublicationTarget

  @Property({ type: 'text' })
  url!: string

  @Property({ name: 'deploy_decision_id', type: 'uuid' })
  deployDecisionId!: string

  @Property({ name: 'deployment_evidence_id', type: 'uuid' })
  deploymentEvidenceId!: string

  @Property({ type: 'jsonb' })
  verification!: DeliveryPublicationVerification

  @Property({ name: 'published_at', type: Date })
  publishedAt!: Date

  @Property({ name: 'published_by', type: 'uuid', nullable: true })
  publishedBy?: string | null

  @Property({ name: 'payload_hash', type: 'text' })
  payloadHash!: string

  @Property({ name: 'recorded_by', type: 'uuid', nullable: true })
  recordedBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}
