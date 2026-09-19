import { OptionalProps } from '@mikro-orm/core'
import { Check, Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'
import type {
  DeliveryEvidenceKind,
  DeliveryLimits,
  ExecutionAttempt,
  SourceRevision,
} from '@open-mercato/core/modules/delivery_os/lib/contracts'
import type { TaskStatus } from './validators'

export type DeliveryInputMode = 'from_brief' | 'from_design'
export type DeliveryBaselineSource = 'manual' | 'requirements_proposal' | 'plan_proposal'
export type DeliveryTaskStatus = TaskStatus
export type DeliveryEvidenceSource = 'adapter' | 'manual'
export type DeliveryDecisionKind = 'requirements' | 'design' | 'deploy' | 'release'
export type DeliveryDecisionSubjectType = 'baseline' | 'deployment_evidence'
export type DeliveryDecisionVerdict = 'approved' | 'rejected'

@Entity({ tableName: 'delivery_projects' })
@Index({ name: 'delivery_projects_scope_deleted_idx', properties: ['tenantId', 'organizationId', 'deletedAt'] })
@Index({ name: 'delivery_projects_scope_created_idx', properties: ['tenantId', 'organizationId', 'createdAt'] })
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
