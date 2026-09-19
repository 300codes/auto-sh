import type { DeliveryBaseline, DeliveryDecision, DeliveryProject, DeliveryTask } from '../data/entities'
import { parseAttemptRegister } from '../lib/attempts'
import { baselineContentV1Schema } from '../lib/contracts'
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
