import type { DeliveryEvidenceKind, SourceRevision, TaskStatus } from './contracts'
import { countsAsAcEvidence } from './targetProfiles'

export const MAX_TRACEABILITY_ROWS = 1000

export type TraceabilityTask = {
  id: string
  projectId: string
  baselineId: string
  title: string
  status: TaskStatus
  acIds: readonly string[]
}

export type TraceabilityEvidence = {
  id: string
  projectId: string
  baselineId: string
  taskId: string | null
  kind: DeliveryEvidenceKind
  sourceRevision: SourceRevision | null
  rawReportHash: string | null
}

export type TraceabilityInput = {
  projectId: string
  baseline: {
    id: string
    projectId: string
    requirements: readonly { id: string; title: string }[]
    acceptanceCriteria: readonly { id: string; requirementId: string; description: string }[]
  }
  tasks: readonly TraceabilityTask[]
  evidence: readonly TraceabilityEvidence[]
  limit: number
}

export type TraceabilityRow = {
  requirementId: string | null
  acId: string | null
  taskId: string | null
  taskStatus: TaskStatus | null
  evidenceId: string | null
  evidenceKind: DeliveryEvidenceKind | null
  countsAsAcEvidence: boolean
  sourceRevision: SourceRevision | null
  rawReportHash: string | null
}

export type TraceabilityIssue = { code: 'unknown_ac'; taskId: string; acId: string }

export type TraceabilityBatch = {
  projectId: string
  baselineId: string
  rows: TraceabilityRow[]
  totalRows: number
  truncated: boolean
  limit: number
  issues: TraceabilityIssue[]
}

const EMPTY_LINK = {
  taskId: null,
  taskStatus: null,
  evidenceId: null,
  evidenceKind: null,
  countsAsAcEvidence: false,
  sourceRevision: null,
  rawReportHash: null,
} as const

export function clampTraceabilityLimit(limit: number): number {
  if (!Number.isFinite(limit)) return MAX_TRACEABILITY_ROWS
  return Math.min(MAX_TRACEABILITY_ROWS, Math.max(1, Math.floor(limit)))
}

export function buildTraceability(input: TraceabilityInput): TraceabilityBatch {
  const { projectId, baseline } = input
  const limit = clampTraceabilityLimit(input.limit)
  const inScope = baseline.projectId === projectId
  const tasks = inScope ? input.tasks.filter((task) => task.projectId === projectId && task.baselineId === baseline.id) : []
  const evidenceByTask = new Map<string, TraceabilityEvidence[]>()
  if (inScope) {
    for (const item of input.evidence) {
      if (item.projectId !== projectId || item.baselineId !== baseline.id || !item.taskId) continue
      const existing = evidenceByTask.get(item.taskId)
      if (existing) existing.push(item)
      else evidenceByTask.set(item.taskId, [item])
    }
  }

  const rows: TraceabilityRow[] = []
  let totalRows = 0
  const emit = (buildRow: () => TraceabilityRow) => {
    totalRows += 1
    if (rows.length < limit) rows.push(buildRow())
  }
  const linkRows = (requirementId: string | null, acId: string) => {
    const coveringTasks = tasks.filter((task) => task.acIds.includes(acId))
    if (coveringTasks.length === 0) emit(() => ({ requirementId, acId, ...EMPTY_LINK }))
    for (const task of coveringTasks) {
      const taskLink = { requirementId, acId, ...EMPTY_LINK, taskId: task.id, taskStatus: task.status }
      const taskEvidence = evidenceByTask.get(task.id) ?? []
      if (taskEvidence.length === 0) emit(() => taskLink)
      for (const item of taskEvidence) {
        emit(() => ({
          ...taskLink,
          evidenceId: item.id,
          evidenceKind: item.kind,
          countsAsAcEvidence: countsAsAcEvidence(item.kind),
          sourceRevision: item.sourceRevision,
          rawReportHash: item.rawReportHash,
        }))
      }
    }
  }

  if (inScope) {
    for (const requirement of baseline.requirements) {
      const criteria = baseline.acceptanceCriteria.filter((criterion) => criterion.requirementId === requirement.id)
      if (criteria.length === 0) emit(() => ({ requirementId: requirement.id, acId: null, ...EMPTY_LINK }))
      for (const criterion of criteria) linkRows(requirement.id, criterion.id)
    }
    const requirementIds = new Set(baseline.requirements.map((requirement) => requirement.id))
    for (const criterion of baseline.acceptanceCriteria) {
      if (!requirementIds.has(criterion.requirementId)) linkRows(criterion.requirementId, criterion.id)
    }
  }

  const knownAcIds = new Set(baseline.acceptanceCriteria.map((criterion) => criterion.id))
  const issues: TraceabilityIssue[] = []
  for (const task of tasks) {
    for (const acId of new Set(task.acIds)) {
      if (!knownAcIds.has(acId)) issues.push({ code: 'unknown_ac', taskId: task.id, acId })
    }
  }
  for (const acId of new Set(issues.map((issue) => issue.acId))) linkRows(null, acId)

  return {
    projectId,
    baselineId: baseline.id,
    rows,
    totalRows,
    truncated: totalRows > limit,
    limit,
    issues,
  }
}
