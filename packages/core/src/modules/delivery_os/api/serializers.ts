import { toIntakeDocument, toIntakeResponse } from '../commands/intake'
import type {
  DeliveryBaseline,
  DeliveryCommentReply,
  DeliveryCommentThread,
  DeliveryDecision,
  DeliveryFlowStageArtifact,
  DeliveryFlowStageDecision,
  DeliveryIntake,
  DeliveryProject,
  DeliveryPublication,
  DeliveryTask,
} from '../data/entities'
import { parseAttemptRegister } from '../lib/attempts'
import {
  baselineContentV1Schema,
  clientApprovalSchema,
  type ClientApproval,
  DELIVERY_FLOW_SCHEMA_VERSIONS,
  type CommentThreadListItem,
  type CommentThreadReplyItem,
  type IntakeResponse,
  type PublicationListItem,
  type StageArtifactListItem,
  type StageDecisionListItem,
} from '../lib/contracts'
import { defaultIntake } from '../lib/intakeRules'
import type { ProjectStatusSummary } from '../lib/projectStatus'
import type { BaselineDto, ProjectDetail, ProjectListItem, TaskDto } from './schemas'

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function requireIso(value: Date | string): string {
  return toIso(value) ?? new Date(0).toISOString()
}

export function serializeProjectListRow(row: Record<string, unknown>): ProjectListItem {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    inputMode: String(row.input_mode ?? ''),
    brief: typeof row.brief === 'string' ? row.brief : null,
    targetProfileId: String(row.target_profile_id ?? ''),
    targetProfileVersion: Number(row.target_profile_version ?? 0),
    repositoryRef: typeof row.repository_ref === 'string' ? row.repository_ref : null,
    activeBaselineId: typeof row.active_baseline_id === 'string' ? row.active_baseline_id : null,
    createdAt: toIso(row.created_at as Date | string | null),
    updatedAt: toIso(row.updated_at as Date | string | null),
    archivedAt: toIso(row.deleted_at as Date | string | null),
  }
}

export function serializeProjectDetail(project: DeliveryProject, summary: ProjectStatusSummary): ProjectDetail {
  return {
    id: project.id,
    name: project.name,
    inputMode: project.inputMode,
    brief: project.brief ?? null,
    targetProfileId: project.targetProfileId,
    targetProfileVersion: project.targetProfileVersion,
    repositoryRef: project.repositoryRef ?? null,
    activeBaselineId: project.activeBaselineId ?? null,
    createdAt: toIso(project.createdAt),
    updatedAt: toIso(project.updatedAt),
    archivedAt: toIso(project.deletedAt),
    draftSpec: project.draftSpec,
    limits: project.limits,
    status: summary.status,
    progress: summary.progress,
    taskCounts: summary.taskCounts,
    attention: summary.attention,
  }
}

export function readBaselineAcIds(baseline: DeliveryBaseline): string[] {
  const parsed = baselineContentV1Schema.safeParse(baseline.content)
  return parsed.success ? parsed.data.acceptanceCriteria.map((criterion) => criterion.id) : []
}

export function serializeBaseline(
  baseline: DeliveryBaseline,
  decisions: readonly DeliveryDecision[],
  activeBaselineId: string | null,
): BaselineDto {
  return {
    id: baseline.id,
    projectId: baseline.projectId,
    version: baseline.version,
    contentHash: baseline.contentHash,
    source: baseline.source,
    parentBaselineId: baseline.parentBaselineId ?? null,
    content: baseline.content,
    attachmentIds: baseline.attachmentIds ?? [],
    createdBy: baseline.createdBy ?? null,
    createdAt: requireIso(baseline.createdAt),
    isActive: baseline.id === activeBaselineId,
    decisions: decisions
      .filter((decision) => decision.subjectType === 'baseline' && decision.subjectId === baseline.id)
      .map((decision) => ({
        id: decision.id,
        kind: decision.kind,
        verdict: decision.verdict,
        subjectHash: decision.subjectHash,
        subjectVersion: decision.subjectVersion ?? null,
        reason: decision.reason ?? null,
        actorUserId: decision.actorUserId,
        decidedAt: requireIso(decision.decidedAt),
      })),
  }
}

export function serializeTask(task: DeliveryTask): TaskDto {
  const register = parseAttemptRegister(task.executionAttempts)
  return {
    id: task.id,
    projectId: task.projectId,
    baselineId: task.baselineId,
    title: task.title,
    description: task.description ?? null,
    acIds: task.acIds,
    dependsOnTaskIds: task.dependsOnTaskIds ?? [],
    allowedPaths: task.allowedPaths ?? [],
    targetProfileId: task.targetProfileId,
    targetProfileVersion: task.targetProfileVersion,
    status: task.status,
    statusReason: task.statusReason ?? null,
    attemptNumber: task.attemptNumber,
    executionAttempts: register.ok ? register.register : [],
    attemptRegisterReadable: register.ok,
    proposalTaskKey: task.proposalTaskKey ?? null,
    createdAt: requireIso(task.createdAt),
    updatedAt: requireIso(task.updatedAt),
    archivedAt: toIso(task.deletedAt),
  }
}

/** F1: the stored draft (decrypted by the caller's loader) or the empty default whose version is the project `createdAt`. */
export function serializeIntakeResponse(project: DeliveryProject, intake: DeliveryIntake | null): IntakeResponse {
  if (intake) return toIntakeResponse(toIntakeDocument(intake), project, intake.updatedAt)
  return toIntakeResponse(defaultIntake(project.id, project.brief), project, project.createdAt)
}

export function serializeStageArtifact(row: DeliveryFlowStageArtifact): StageArtifactListItem {
  return {
    artifactId: row.id,
    projectId: row.projectId,
    stageId: row.stageId,
    version: row.version,
    contentHash: row.contentHash,
    source: row.source,
    content: row.content,
    dependsOn: row.dependsOn,
    attachmentIds: row.attachmentIds,
    templateHash: row.templateHash,
    createdBy: row.createdBy ?? null,
    createdAt: requireIso(row.createdAt),
  }
}

function readClientApproval(row: DeliveryFlowStageDecision): ClientApproval | null {
  if (typeof row.clientApproverName !== 'string' || row.clientApproverName.length === 0) return null
  const parsed = clientApprovalSchema.safeParse({
    approverName: row.clientApproverName,
    approverRole: row.clientApproverRole ?? null,
    evidence: row.clientApprovalEvidence,
  })
  return parsed.success ? parsed.data : null
}

/** Approver fields arrive decrypted: rows are loaded with `findWithDecryption` for the session scope only. */
export function serializeStageDecision(row: DeliveryFlowStageDecision): StageDecisionListItem {
  return {
    decisionId: row.id,
    projectId: row.projectId,
    stageId: row.stageId,
    artifactId: row.artifactId,
    subjectHash: row.subjectHash,
    subjectVersion: row.subjectVersion,
    verdict: row.verdict,
    reason: row.reason ?? null,
    actorUserId: row.actorUserId,
    decidedAt: requireIso(row.decidedAt),
    clientApproved: typeof row.clientApproverName === 'string' && row.clientApproverName.length > 0,
    clientApproval: readClientApproval(row),
    deferredThreadKeys: row.deferredThreadKeys,
    templateHash: row.templateHash,
  }
}

export { toStaffLink as serializeStaffLink } from '../commands/staffLink'

function serializeCommentReply(row: DeliveryCommentReply): CommentThreadReplyItem {
  return {
    replyId: row.id,
    commentKey: row.commentKey,
    revision: row.revision,
    author: row.author,
    body: row.body,
    sourceCreatedAt: requireIso(row.sourceCreatedAt),
    editedAt: toIso(row.editedAt),
    deleted: row.deleted,
    staffCommentId: row.staffCommentId ?? null,
    fetchedAt: requireIso(row.fetchedAt),
  }
}

/** Author and body arrive decrypted: threads and replies are loaded with `findWithDecryption` for the session scope. */
export function serializeCommentThread(row: DeliveryCommentThread, replies: DeliveryCommentReply[]): CommentThreadListItem {
  return {
    threadId: row.id,
    threadKey: row.threadKey,
    source: row.source,
    fileKey: row.fileKey,
    stageId: row.stageId,
    artifactId: row.artifactId ?? null,
    nodeId: row.nodeId ?? null,
    sourceUrl: row.sourceUrl,
    author: row.author,
    body: row.body,
    sourceCreatedAt: requireIso(row.sourceCreatedAt),
    sourceUpdatedAt: toIso(row.sourceUpdatedAt),
    sourceStatus: row.sourceStatus,
    figmaVersion: row.figmaVersion ?? null,
    versionConfirmed: row.versionConfirmed,
    fetchedAt: requireIso(row.fetchedAt),
    staffTaskId: row.staffTaskId ?? null,
    triageStatus: row.triageStatus,
    deferral: row.deferral ?? null,
    linkedDeliveryTaskId: row.linkedDeliveryTaskId ?? null,
    replies: replies.map(serializeCommentReply),
    updatedAt: requireIso(row.updatedAt),
  }
}

export function serializePublication(row: DeliveryPublication): PublicationListItem {
  return {
    schemaVersion: DELIVERY_FLOW_SCHEMA_VERSIONS.publicationResult,
    publicationId: row.id,
    projectId: row.projectId,
    baselineId: row.baselineId,
    sourceRevision: row.sourceRevision,
    snapshotRef: row.snapshotRef ?? null,
    target: row.target,
    url: row.url,
    deployDecisionId: row.deployDecisionId,
    deploymentEvidenceId: row.deploymentEvidenceId,
    publishedAt: requireIso(row.publishedAt),
    publishedBy: row.publishedBy ?? null,
    verification: row.verification,
    recordedBy: row.recordedBy ?? null,
    createdAt: requireIso(row.createdAt),
  }
}
