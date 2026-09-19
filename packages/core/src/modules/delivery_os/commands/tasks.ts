import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { buildChanges, emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { E } from '#generated/entities.ids.generated'
import {
  DeliveryBaseline,
  DeliveryDecision,
  DeliveryEvidence,
  DeliveryTask,
  type DeliveryProject,
} from '../data/entities'
import { taskCreateSchema, taskUpdateSchema, type TaskUpdateInput } from '../data/validators'
import { emitDeliveryOsEvent } from '../events'
import { parseAttemptRegister } from '../lib/attempts'
import {
  collectReadinessReasons,
  type BaselineDecisionRecord,
  type ReadinessReason,
  type ReadinessTask,
} from '../lib/baseline'
import {
  baselineContentV1Schema,
  buildDeliveryError,
  uuidSchema,
  type BaselineContentV1,
  type DeliveryCheckResult,
  type TaskStatus,
} from '../lib/contracts'
import { taskGraphCheck, type TaskGraphNode } from '../lib/dag'
import {
  canTransition,
  findBlockedAncestors,
  planBlockPropagation,
  planUnblockPropagation,
  type CorrectionBudget,
  type LifecycleTask,
  type PlannedStatusChange,
} from '../lib/taskLifecycle'
import { checkAllowedPathsForProfile, getTargetProfile, type TargetProfile } from '../lib/targetProfiles'
import { checkProjectArchivable } from './projects'
import {
  assertDeliveryCheck,
  DELIVERY_TASK_RESOURCE_KIND,
  deliveryHttpError,
  lockScopedProject,
  lockScopedProjectTasks,
  lockTaskForWrite,
  parseDeliveryInput,
  resolveDeliveryEm,
  resolveDeliveryScope,
  type DeliveryScope,
  type LockedTaskForWrite,
} from './shared'

export type TaskCommandResult = {
  taskId: string
  projectId: string
  status: TaskStatus
  updatedAt: string
  propagatedTaskIds: string[]
}

type TaskDeleteInput = { id?: unknown; body?: Record<string, unknown>; query?: Record<string, unknown> }

type TaskSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  projectId: string
  baselineId: string
  title: string
  description: string | null
  acIds: string[]
  dependsOnTaskIds: string[]
  allowedPaths: string[]
  targetProfileId: string
  targetProfileVersion: number
  status: TaskStatus
  statusReason: string | null
  deletedAt: string | null
}

type ReviewEvidenceLike = { kind: string; payload: Record<string, unknown> }

const TASK_CHANGE_KEYS = [
  'title',
  'description',
  'acIds',
  'dependsOnTaskIds',
  'allowedPaths',
  'status',
  'statusReason',
] as const

const SCOPE_EDITABLE_STATUSES: readonly TaskStatus[] = ['draft', 'blocked']
const REOPEN_STATUSES: readonly TaskStatus[] = ['draft', 'ready']
const SYSTEM_OWNED_STATUS_REASONS: readonly string[] = ['reconciliation_required', 'correction_limit_reached']

const taskIdSchema = z.object({ id: uuidSchema })
const taskProjectSchema = z.object({ projectId: uuidSchema })

const taskCrudIndexer: CrudIndexerConfig<DeliveryTask> = {
  entityType: E.delivery_os.delivery_task,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readTaskId(input: unknown): string {
  const source = isRecord(input) ? input : {}
  const body = isRecord(source.body) ? source.body : {}
  const query = isRecord(source.query) ? source.query : {}
  return parseDeliveryInput(taskIdSchema, { id: source.id ?? body.id ?? query.id }).id
}

function toTaskSnapshot(task: DeliveryTask): TaskSnapshot {
  return {
    id: task.id,
    tenantId: task.tenantId,
    organizationId: task.organizationId,
    projectId: task.projectId,
    baselineId: task.baselineId,
    title: task.title,
    description: task.description ?? null,
    acIds: task.acIds,
    dependsOnTaskIds: task.dependsOnTaskIds,
    allowedPaths: task.allowedPaths,
    targetProfileId: task.targetProfileId,
    targetProfileVersion: task.targetProfileVersion,
    status: task.status,
    statusReason: task.statusReason ?? null,
    deletedAt: task.deletedAt ? task.deletedAt.toISOString() : null,
  }
}

async function loadTaskSnapshot(ctx: CommandRuntimeContext, id: string): Promise<TaskSnapshot | null> {
  const scope = resolveDeliveryScope(ctx)
  const task = await findOneWithDecryption(
    resolveDeliveryEm(ctx),
    DeliveryTask,
    { id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    undefined,
    scope,
  )
  return task ? toTaskSnapshot(task) : null
}

function changedTaskKeys(before: TaskSnapshot, after: TaskSnapshot): string[] {
  return TASK_CHANGE_KEYS.filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
}

function toResult(task: DeliveryTask, propagatedTaskIds: string[] = []): TaskCommandResult {
  return {
    taskId: task.id,
    projectId: task.projectId,
    status: task.status,
    updatedAt: (task.updatedAt ?? new Date()).toISOString(),
    propagatedTaskIds,
  }
}

function toGraphNode(task: DeliveryTask): TaskGraphNode {
  return { id: task.id, projectId: task.projectId, baselineId: task.baselineId, dependsOnTaskIds: task.dependsOnTaskIds }
}

function toLifecycleTask(task: DeliveryTask): LifecycleTask {
  return { id: task.id, status: task.status, statusReason: task.statusReason ?? null, dependsOnTaskIds: task.dependsOnTaskIds }
}

export function requireTaskProfile(id: string, version: number): TargetProfile {
  const profile = getTargetProfile(id, version)
  if (profile) return profile
  throw deliveryHttpError(
    buildDeliveryError('unknown_target_profile', 'Unknown target profile', [
      { path: 'targetProfileId', code: 'unknown_target_profile', message: `No profile ${id} v${version}` },
    ]),
  )
}

export async function findProjectBaseline(
  tx: EntityManager,
  baselineId: string,
  projectId: string,
  scope: DeliveryScope,
): Promise<DeliveryBaseline | null> {
  return findOneWithDecryption(
    tx,
    DeliveryBaseline,
    { id: baselineId, projectId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    undefined,
    scope,
  )
}

export function readBaselineContent(baseline: DeliveryBaseline): BaselineContentV1 | null {
  const parsed = baselineContentV1Schema.safeParse(baseline.content)
  return parsed.success ? parsed.data : null
}

export function foreignBaselineError() {
  return buildDeliveryError('foreign_reference', 'Baseline does not belong to this project', [
    { path: 'baselineId', code: 'foreign_baseline' },
  ])
}

export function unreadableBaselineError() {
  return buildDeliveryError('hash_mismatch', 'Stored baseline content is not readable', [
    { path: 'content', code: 'unreadable_baseline_content' },
  ])
}

async function requireBaselineContent(
  tx: EntityManager,
  baselineId: string,
  projectId: string,
  scope: DeliveryScope,
): Promise<BaselineContentV1> {
  const baseline = await findProjectBaseline(tx, baselineId, projectId, scope)
  if (!baseline) throw deliveryHttpError(foreignBaselineError())
  const content = readBaselineContent(baseline)
  if (!content) throw deliveryHttpError(unreadableBaselineError())
  return content
}

export function checkKnownAcIds(acIds: readonly string[], content: BaselineContentV1): DeliveryCheckResult {
  const known = new Set(content.acceptanceCriteria.map((criterion) => criterion.id))
  const unknown = acIds.filter((acId) => !known.has(acId))
  if (unknown.length === 0) return { ok: true }
  return {
    ok: false,
    ...buildDeliveryError(
      'unknown_ac',
      'Unknown acceptance criterion',
      unknown.map((acId) => ({ path: `acIds.${acId}`, code: 'unknown_ac', message: `${acId} is not part of the pinned baseline` })),
    ),
  }
}

async function loadScopedDependencyNodes(
  tx: EntityManager,
  dependencyIds: readonly string[],
  projectTasks: readonly DeliveryTask[],
  scope: DeliveryScope,
): Promise<TaskGraphNode[]> {
  const projectTaskIds = new Set(projectTasks.map((task) => task.id))
  const outsideIds = dependencyIds.filter((dependencyId) => !projectTaskIds.has(dependencyId))
  if (outsideIds.length === 0) return []
  const outside = await findWithDecryption(
    tx,
    DeliveryTask,
    { id: { $in: outsideIds }, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    undefined,
    scope,
  )
  return outside.map(toGraphNode)
}

export function countCorrectionRounds(evidence: readonly ReviewEvidenceLike[]): number {
  return evidence.filter(
    (item) =>
      item.kind === 'review' && item.payload.verdict === 'changes_requested' && item.payload.manualCheckId === undefined,
  ).length
}

export function checkTaskDeletable(task: DeliveryTask, liveProjectTasks: readonly DeliveryTask[]): DeliveryCheckResult {
  const attemptCheck = checkProjectArchivable([task], 'task')
  if (!attemptCheck.ok) return attemptCheck
  const dependents = liveProjectTasks.filter(
    (candidate) => candidate.id !== task.id && candidate.dependsOnTaskIds.includes(task.id),
  )
  if (dependents.length === 0) return { ok: true }
  return {
    ok: false,
    ...buildDeliveryError(
      'foreign_dependency',
      'Other tasks depend on this task',
      dependents.map((dependent) => ({
        path: `tasks.${dependent.id}.dependsOnTaskIds`,
        code: 'has_dependents',
        message: `${dependent.title} depends on this task`,
      })),
    ),
  }
}

function checkScopeEditable(task: DeliveryTask): DeliveryCheckResult {
  const neverAttempted = Array.isArray(task.executionAttempts) && task.executionAttempts.length === 0
  if (SCOPE_EDITABLE_STATUSES.includes(task.status) && neverAttempted) return { ok: true }
  return {
    ok: false,
    ...buildDeliveryError('invalid_transition', 'Task scope can change only before the first attempt', [
      {
        path: 'status',
        code: 'task_not_editable',
        message: 'acIds, dependsOnTaskIds and allowedPaths are editable in draft or blocked, before any attempt',
      },
    ]),
  }
}

function readinessFailure(reasons: readonly ReadinessReason[]): DeliveryCheckResult {
  const [first] = reasons
  if (!first) return { ok: true }
  return { ok: false, ...buildDeliveryError(first.code, first.error, reasons.map((entry) => entry.detail)) }
}

export async function loadBaselineDecisionRecords(
  tx: EntityManager,
  baseline: DeliveryBaseline,
  scope: DeliveryScope,
): Promise<BaselineDecisionRecord[]> {
  const decisions = await findWithDecryption(
    tx,
    DeliveryDecision,
    {
      projectId: baseline.projectId,
      subjectType: 'baseline',
      subjectId: baseline.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    },
    undefined,
    scope,
  )
  return decisions.map((decision) => ({
    kind: decision.kind,
    verdict: decision.verdict,
    subjectHash: decision.subjectHash,
    subjectVersion: decision.subjectVersion ?? null,
    decidedAt: decision.decidedAt,
  }))
}

async function checkReadyGate(
  tx: EntityManager,
  task: ReadinessTask & { baselineId: string },
  project: DeliveryProject,
  scope: DeliveryScope,
): Promise<DeliveryCheckResult> {
  const baseline = await findProjectBaseline(tx, task.baselineId, project.id, scope)
  if (!baseline) return { ok: false, ...foreignBaselineError() }
  const content = readBaselineContent(baseline)
  if (!content) return { ok: false, ...unreadableBaselineError() }
  const decisionRecords = await loadBaselineDecisionRecords(tx, baseline, scope)
  const reasons: ReadinessReason[] = []
  if (task.baselineId !== project.activeBaselineId) {
    reasons.push({
      code: 'baseline_not_approved',
      error: 'Task baseline is not the active approved baseline',
      detail: {
        path: 'baselineId',
        code: 'baseline_not_active',
        message: `Active baseline is ${project.activeBaselineId ?? 'not set'}`,
      },
    })
  }
  reasons.push(
    ...collectReadinessReasons({
      task,
      baseline: { id: baseline.id, contentHash: baseline.contentHash, version: baseline.version, content },
      decisions: decisionRecords,
      profile: getTargetProfile(task.targetProfileId, task.targetProfileVersion),
    }),
  )
  return readinessFailure(reasons)
}

export async function loadCorrectionBudget(
  tx: EntityManager,
  task: DeliveryTask,
  project: DeliveryProject,
  scope: DeliveryScope,
): Promise<CorrectionBudget> {
  const reviews = await findWithDecryption(
    tx,
    DeliveryEvidence,
    { taskId: task.id, kind: 'review', tenantId: scope.tenantId, organizationId: scope.organizationId },
    undefined,
    scope,
  )
  return { requested: countCorrectionRounds(reviews), max: project.limits.maxCorrectionRounds }
}

function nextStatusReason(current: string | null | undefined): string | null {
  if (current && SYSTEM_OWNED_STATUS_REASONS.includes(current)) return current
  return null
}

function planPropagation(task: DeliveryTask, from: TaskStatus, tasks: readonly DeliveryTask[]): PlannedStatusChange[] {
  const lifecycle = tasks.map(toLifecycleTask)
  if (task.status === 'blocked' && from !== 'blocked') return planBlockPropagation(task.id, lifecycle)
  if (from === 'blocked' && REOPEN_STATUSES.includes(task.status)) return planUnblockPropagation(task.id, lifecycle)
  return []
}

function applyPropagation(changes: readonly PlannedStatusChange[], tasks: readonly DeliveryTask[]): DeliveryTask[] {
  const tasksById = new Map(tasks.map((candidate) => [candidate.id, candidate]))
  const changed: DeliveryTask[] = []
  for (const change of changes) {
    const target = tasksById.get(change.taskId)
    if (!target) continue
    target.status = change.to
    target.statusReason = change.statusReason
    changed.push(target)
  }
  return changed
}

export async function emitTaskSideEffects(
  ctx: CommandRuntimeContext,
  action: 'created' | 'updated' | 'deleted',
  task: DeliveryTask,
): Promise<void> {
  await emitCrudSideEffects({
    dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
    action,
    entity: task,
    identifiers: { id: task.id, organizationId: task.organizationId, tenantId: task.tenantId },
    indexer: taskCrudIndexer,
  })
}

export async function emitTaskUpdated(task: DeliveryTask): Promise<void> {
  await emitDeliveryOsEvent(
    'delivery_os.task.updated',
    {
      projectId: task.projectId,
      taskId: task.id,
      status: task.status,
      statusReason: task.statusReason ?? null,
      updatedAt: (task.updatedAt ?? new Date()).toISOString(),
      tenantId: task.tenantId,
      organizationId: task.organizationId,
    },
    { persistent: true, tenantId: task.tenantId, organizationId: task.organizationId },
  )
}

type PendingTaskScope = { acIds: string[]; dependsOnTaskIds: string[] }

function checkReopenAllowed(task: DeliveryTask, to: TaskStatus, blockedAncestorIds: readonly string[]): DeliveryCheckResult {
  if (!REOPEN_STATUSES.includes(to)) return { ok: true }
  const parsed = parseAttemptRegister(task.executionAttempts)
  const hasResult =
    !parsed.ok || parsed.register.some((attempt) => attempt.resultEvidenceId !== null || attempt.outcome === 'result_accepted')
  if (hasResult) {
    return {
      ok: false,
      ...buildDeliveryError('invalid_transition', `Task cannot move from ${task.status} to ${to}`, [
        { path: 'status', code: 'result_awaits_review', message: 'A task with an accepted result continues only through review' },
      ]),
    }
  }
  if (to === 'draft' && task.status === 'blocked' && blockedAncestorIds.length > 0) {
    return {
      ok: false,
      ...buildDeliveryError('invalid_transition', `Task cannot move from ${task.status} to ${to}`, [
        { path: 'status', code: 'dependency_blocked', message: `Blocked by ${blockedAncestorIds.join(', ')}` },
      ]),
    }
  }
  return { ok: true }
}

async function checkStatusChange(
  tx: EntityManager,
  to: TaskStatus,
  locked: LockedTaskForWrite,
  pending: PendingTaskScope,
  scope: DeliveryScope,
): Promise<void> {
  const { project, tasks, task } = locked
  assertDeliveryCheck(checkProjectArchivable([task], 'task'))
  const candidate = {
    baselineId: task.baselineId,
    acIds: pending.acIds,
    targetProfileId: task.targetProfileId,
    targetProfileVersion: task.targetProfileVersion,
  }
  const readiness = to === 'ready' ? await checkReadyGate(tx, candidate, project, scope) : undefined
  const correction = await loadCorrectionBudget(tx, task, project, scope)
  const lifecycle = tasks.map((entry) =>
    entry.id === task.id ? { ...toLifecycleTask(entry), dependsOnTaskIds: pending.dependsOnTaskIds } : toLifecycleTask(entry),
  )
  const blockedAncestorIds = findBlockedAncestors(task.id, lifecycle)
  assertDeliveryCheck(
    canTransition(task.status, to, {
      source: 'status_update',
      statusReason: task.statusReason ?? null,
      readiness,
      correction,
      blockedAncestorIds,
    }),
  )
  assertDeliveryCheck(checkReopenAllowed(task, to, blockedAncestorIds))
}

const createTaskCommand: CommandHandler<unknown, TaskCommandResult> = {
  id: 'delivery_os.tasks.create',
  async execute(rawInput, ctx) {
    const scope = resolveDeliveryScope(ctx)
    const { projectId } = parseDeliveryInput(taskProjectSchema, rawInput)
    const source = isRecord(rawInput) ? rawInput : {}
    const { projectId: _projectId, ...body } = source
    const parsed = parseDeliveryInput(taskCreateSchema, body)
    if (parsed.source !== 'manual') {
      throw deliveryHttpError(
        buildDeliveryError('validation_failed', 'Validation failed', [
          { path: 'source', code: 'unsupported_source', message: 'This command creates manual tasks only' },
        ]),
      )
    }

    const em = resolveDeliveryEm(ctx)
    const task = await em.transactional(async (tx) => {
      const project = await lockScopedProject(tx, projectId, scope)
      const projectTasks = await lockScopedProjectTasks(tx, project.id, scope)
      const content = await requireBaselineContent(tx, parsed.baselineId, project.id, scope)
      assertDeliveryCheck(checkKnownAcIds(parsed.acIds, content))
      const profile = requireTaskProfile(project.targetProfileId, project.targetProfileVersion)
      const allowedPaths = parsed.allowedPaths ?? []
      assertDeliveryCheck(checkAllowedPathsForProfile(profile, allowedPaths))

      const dependsOnTaskIds = [...new Set(parsed.dependsOnTaskIds ?? [])]
      const node: TaskGraphNode = { id: randomUUID(), projectId: project.id, baselineId: parsed.baselineId, dependsOnTaskIds }
      const outsideNodes = await loadScopedDependencyNodes(tx, dependsOnTaskIds, projectTasks, scope)
      assertDeliveryCheck(taskGraphCheck([...projectTasks.map(toGraphNode), ...outsideNodes, node], project.id))

      const created = tx.create(DeliveryTask, {
        id: node.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        projectId: project.id,
        baselineId: parsed.baselineId,
        title: parsed.title,
        description: parsed.description ?? null,
        acIds: parsed.acIds,
        dependsOnTaskIds,
        allowedPaths,
        targetProfileId: profile.id,
        targetProfileVersion: profile.version,
        status: 'draft',
        statusReason: null,
      })
      tx.persist(created)
      await tx.flush()
      return created
    })

    await emitTaskSideEffects(ctx, 'created', task)
    await emitTaskUpdated(task)
    return toResult(task)
  },
  captureAfter: (_input, result, ctx) => loadTaskSnapshot(ctx, result.taskId),
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const after = (snapshots.after as TaskSnapshot | null | undefined) ?? null
    return {
      actionLabel: translate('delivery_os.audit.tasks.create', 'Create delivery task'),
      resourceKind: DELIVERY_TASK_RESOURCE_KIND,
      resourceId: result.taskId,
      tenantId: after?.tenantId ?? null,
      organizationId: after?.organizationId ?? null,
      snapshotAfter: after,
    }
  },
}

const updateTaskCommand: CommandHandler<TaskUpdateInput, TaskCommandResult> = {
  id: 'delivery_os.tasks.update',
  async prepare(rawInput, ctx) {
    const before = await loadTaskSnapshot(ctx, readTaskId(rawInput))
    return before ? { before } : {}
  },
  async execute(rawInput, ctx) {
    const scope = resolveDeliveryScope(ctx)
    const parsed = parseDeliveryInput(taskUpdateSchema, rawInput)

    const em = resolveDeliveryEm(ctx)
    const outcome = await em.transactional(async (tx) => {
      const locked = await lockTaskForWrite(tx, ctx, parsed.id, scope)
      const { project, tasks, task } = locked
      const editsScope =
        parsed.acIds !== undefined || parsed.dependsOnTaskIds !== undefined || parsed.allowedPaths !== undefined
      if (editsScope) assertDeliveryCheck(checkScopeEditable(task))

      if (parsed.acIds !== undefined) {
        const content = await requireBaselineContent(tx, task.baselineId, project.id, scope)
        assertDeliveryCheck(checkKnownAcIds(parsed.acIds, content))
      }
      if (parsed.allowedPaths !== undefined) {
        const profile = requireTaskProfile(task.targetProfileId, task.targetProfileVersion)
        assertDeliveryCheck(checkAllowedPathsForProfile(profile, parsed.allowedPaths))
      }
      const dependsOnTaskIds = parsed.dependsOnTaskIds ? [...new Set(parsed.dependsOnTaskIds)] : undefined
      if (dependsOnTaskIds !== undefined) {
        const outsideNodes = await loadScopedDependencyNodes(tx, dependsOnTaskIds, tasks, scope)
        const nodes = tasks.map((candidate) =>
          candidate.id === task.id ? { ...toGraphNode(candidate), dependsOnTaskIds } : toGraphNode(candidate),
        )
        assertDeliveryCheck(taskGraphCheck([...nodes, ...outsideNodes], project.id))
      }

      const statusChange = parsed.status !== undefined && parsed.status !== task.status ? parsed.status : undefined
      if (statusChange !== undefined) {
        const pending = { acIds: parsed.acIds ?? task.acIds, dependsOnTaskIds: dependsOnTaskIds ?? task.dependsOnTaskIds }
        await checkStatusChange(tx, statusChange, locked, pending, scope)
      }

      if (parsed.title !== undefined) task.title = parsed.title
      if (parsed.description !== undefined) task.description = parsed.description
      if (parsed.acIds !== undefined) task.acIds = parsed.acIds
      if (dependsOnTaskIds !== undefined) task.dependsOnTaskIds = dependsOnTaskIds
      if (parsed.allowedPaths !== undefined) task.allowedPaths = parsed.allowedPaths
      if (statusChange === undefined) return { task, propagated: [] as DeliveryTask[] }

      const from = task.status
      task.status = statusChange
      task.statusReason = nextStatusReason(task.statusReason)
      return { task, propagated: applyPropagation(planPropagation(task, from, tasks), tasks) }
    })

    for (const changed of [outcome.task, ...outcome.propagated]) {
      await emitTaskSideEffects(ctx, 'updated', changed)
      await emitTaskUpdated(changed)
    }
    return toResult(
      outcome.task,
      outcome.propagated.map((changed) => changed.id),
    )
  },
  captureAfter: (_input, result, ctx) => loadTaskSnapshot(ctx, result.taskId),
  buildLog: async ({ result, snapshots }) => {
    const before = (snapshots.before as TaskSnapshot | undefined) ?? null
    const after = (snapshots.after as TaskSnapshot | null | undefined) ?? null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('delivery_os.audit.tasks.update', 'Update delivery task'),
      resourceKind: DELIVERY_TASK_RESOURCE_KIND,
      resourceId: result.taskId,
      tenantId: before?.tenantId ?? after?.tenantId ?? null,
      organizationId: before?.organizationId ?? after?.organizationId ?? null,
      snapshotBefore: before,
      snapshotAfter: after,
      changes: before && after ? buildChanges(before, after, changedTaskKeys(before, after)) : {},
    }
  },
}

const deleteTaskCommand: CommandHandler<TaskDeleteInput, TaskCommandResult> = {
  id: 'delivery_os.tasks.delete',
  async prepare(input, ctx) {
    const before = await loadTaskSnapshot(ctx, readTaskId(input))
    return before ? { before } : {}
  },
  async execute(input, ctx) {
    const scope = resolveDeliveryScope(ctx)
    const id = readTaskId(input)

    const em = resolveDeliveryEm(ctx)
    const task = await em.transactional(async (tx) => {
      const locked = await lockTaskForWrite(tx, ctx, id, scope)
      assertDeliveryCheck(checkTaskDeletable(locked.task, locked.tasks))
      locked.task.deletedAt = new Date()
      return locked.task
    })

    await emitTaskSideEffects(ctx, 'deleted', task)
    return toResult(task)
  },
  buildLog: async ({ result, snapshots }) => {
    const before = (snapshots.before as TaskSnapshot | undefined) ?? null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('delivery_os.audit.tasks.delete', 'Archive delivery task'),
      resourceKind: DELIVERY_TASK_RESOURCE_KIND,
      resourceId: result.taskId,
      tenantId: before?.tenantId ?? null,
      organizationId: before?.organizationId ?? null,
      snapshotBefore: before,
    }
  },
}

registerCommand(createTaskCommand)
registerCommand(updateTaskCommand)
registerCommand(deleteTaskCommand)
