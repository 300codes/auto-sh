import { isSameRevision, type DeliveryEvidenceKind, type SourceRevision, type TaskStatus } from './contracts'

export type ProjectStatus =
  | 'archived'
  | 'draft'
  | 'awaiting_approval'
  | 'planning'
  | 'in_progress'
  | 'coverage_gap'
  | 'verified'
  | 'released'

export type ProjectProgress = { proven: number; total: number; unit: 'ac'; percent: number | null }

export type ProjectStatusInput = {
  project: { deletedAt: Date | string | null; activeBaselineId: string | null }
  baselines: readonly { id: string; acIds: readonly string[] }[]
  tasks: readonly {
    id: string
    baselineId: string
    status: TaskStatus
    statusReason?: string | null
    acIds: readonly string[]
    deletedAt?: Date | string | null
  }[]
  evidence: readonly { kind: DeliveryEvidenceKind; baselineId: string; sourceRevision: SourceRevision | null; createdAt: Date | string }[]
  decisions: readonly { kind: string; verdict: 'approved' | 'rejected'; sourceRevision: SourceRevision | null; decidedAt: Date | string }[]
}

export type ProjectStatusSummary = {
  status: ProjectStatus
  progress: ProjectProgress
  taskCounts: Record<TaskStatus, number>
  attention: { blockedTaskIds: string[]; reconciliationRequiredTaskIds: string[] }
}

function toTime(value: Date | string): number {
  const time = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time
}

function latestBy<TItem>(
  items: readonly TItem[],
  readTime: (item: TItem) => Date | string,
  winsTie: (candidate: TItem, current: TItem) => boolean = () => false,
): TItem | null {
  let latest: TItem | null = null
  for (const item of items) {
    if (!latest) {
      latest = item
      continue
    }
    const candidateTime = toTime(readTime(item))
    const currentTime = toTime(readTime(latest))
    if (candidateTime > currentTime || (candidateTime === currentTime && winsTie(item, latest))) latest = item
  }
  return latest
}

export function buildProgress(proven: number, total: number): ProjectProgress {
  return { proven, total, unit: 'ac', percent: total === 0 ? null : Math.floor((proven * 100) / total) }
}

function emptyTaskCounts(): Record<TaskStatus, number> {
  return {
    draft: 0,
    ready: 0,
    executing: 0,
    awaiting_review: 0,
    changes_requested: 0,
    verified: 0,
    blocked: 0,
    cancelled: 0,
  }
}

export function deriveProjectStatus(input: ProjectStatusInput): ProjectStatusSummary {
  const activeBaseline = input.baselines.find((baseline) => baseline.id === input.project.activeBaselineId) ?? null
  const baselineTasks = activeBaseline
    ? input.tasks.filter((task) => !task.deletedAt && task.baselineId === activeBaseline.id)
    : []
  const liveTasks = baselineTasks.filter((task) => task.status !== 'cancelled')
  const taskCounts = emptyTaskCounts()
  for (const task of baselineTasks) taskCounts[task.status] += 1

  const acIds = [...new Set(activeBaseline?.acIds ?? [])]
  const provenAcIds = acIds.filter((acId) => {
    const covering = liveTasks.filter((task) => task.acIds.includes(acId))
    return covering.length > 0 && covering.every((task) => task.status === 'verified')
  })
  const progress = buildProgress(provenAcIds.length, acIds.length)
  const attention = {
    blockedTaskIds: liveTasks.filter((task) => task.status === 'blocked').map((task) => task.id),
    reconciliationRequiredTaskIds: liveTasks.filter((task) => task.statusReason === 'reconciliation_required').map((task) => task.id),
  }
  const summary = (status: ProjectStatus): ProjectStatusSummary => ({ status, progress, taskCounts, attention })

  if (input.project.deletedAt) return summary('archived')
  if (input.baselines.length === 0) return summary('draft')
  if (!activeBaseline) return summary('awaiting_approval')
  if (liveTasks.length === 0) return summary('planning')
  if (liveTasks.some((task) => task.status !== 'verified')) return summary('in_progress')
  if (progress.total === 0 || progress.proven < progress.total) return summary('coverage_gap')

  const latestResult = latestBy(
    input.evidence.filter((item) => item.kind === 'result_manifest' && item.baselineId === activeBaseline.id && item.sourceRevision),
    (item) => item.createdAt,
  )
  const latestRelease = latestBy(
    input.decisions.filter((decision) => decision.kind === 'release'),
    (decision) => decision.decidedAt,
    (candidate, current) => candidate.verdict === 'rejected' && current.verdict === 'approved',
  )
  const releaseApplies = Boolean(
    latestRelease?.verdict === 'approved' &&
      latestRelease.sourceRevision &&
      latestResult?.sourceRevision &&
      isSameRevision(latestRelease.sourceRevision, latestResult.sourceRevision),
  )
  return summary(releaseApplies ? 'released' : 'verified')
}
