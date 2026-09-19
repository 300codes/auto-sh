import { z } from 'zod'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { buildChanges, emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { E } from '#generated/entities.ids.generated'
import { DeliveryProject, type DeliveryTask } from '../data/entities'
import {
  draftSpecV1Schema,
  projectCreateSchema,
  projectUpdateSchema,
  type ProjectCreateInput,
  type ProjectUpdateInput,
} from '../data/validators'
import { emitDeliveryOsEvent } from '../events'
import { isAttemptActive, parseAttemptRegister } from '../lib/attempts'
import { canonicalize } from '../lib/hash'
import {
  buildDeliveryError,
  DEFAULT_DELIVERY_LIMITS,
  uuidSchema,
  type DeliveryCheckResult,
  type DeliveryErrorDetail,
  type DeliveryLimits,
} from '../lib/contracts'
import { getLatestTargetProfile, getTargetProfile, type TargetProfile } from '../lib/targetProfiles'
import {
  assertDeliveryCheck,
  DELIVERY_PROJECT_RESOURCE_KIND,
  deliveryHttpError,
  findScopedProject,
  lockProjectForWrite,
  lockScopedProjectTasks,
  parseDeliveryInput,
  resolveDeliveryEm,
  resolveDeliveryScope,
} from './shared'

export type ProjectCommandResult = { projectId: string; updatedAt: string }

type ProjectDeleteInput = { body?: Record<string, unknown>; query?: Record<string, unknown> }

type ProjectSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  name: string
  inputMode: string
  brief: string | null
  targetProfileId: string
  targetProfileVersion: number
  repositoryRef: string | null
  draftSpec: Record<string, unknown>
  activeBaselineId: string | null
  limits: DeliveryLimits
  deletedAt: string | null
}

const PROJECT_CHANGE_KEYS = ['name', 'brief', 'repositoryRef', 'draftSpec', 'limits'] as const

const projectIdSchema = z.object({ id: uuidSchema })

const projectCrudIndexer: CrudIndexerConfig<DeliveryProject> = {
  entityType: E.delivery_os.delivery_project,
}

function toProjectSnapshot(project: DeliveryProject): ProjectSnapshot {
  return {
    id: project.id,
    tenantId: project.tenantId,
    organizationId: project.organizationId,
    name: project.name,
    inputMode: project.inputMode,
    brief: project.brief ?? null,
    targetProfileId: project.targetProfileId,
    targetProfileVersion: project.targetProfileVersion,
    repositoryRef: project.repositoryRef ?? null,
    draftSpec: project.draftSpec,
    activeBaselineId: project.activeBaselineId ?? null,
    limits: project.limits,
    deletedAt: project.deletedAt ? project.deletedAt.toISOString() : null,
  }
}

async function loadProjectSnapshot(ctx: CommandRuntimeContext, id: string): Promise<ProjectSnapshot | null> {
  const scope = resolveDeliveryScope(ctx)
  const project = await findScopedProject(resolveDeliveryEm(ctx), id, scope)
  return project ? toProjectSnapshot(project) : null
}

function isSameProjectValue(before: unknown, after: unknown): boolean {
  try {
    return canonicalize(before) === canonicalize(after)
  } catch {
    return JSON.stringify(before) === JSON.stringify(after)
  }
}

function changedProjectKeys(before: ProjectSnapshot, after: ProjectSnapshot): string[] {
  return PROJECT_CHANGE_KEYS.filter((key) => !isSameProjectValue(before[key], after[key]))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readProjectId(input: unknown): string {
  const source = isRecord(input) ? input : {}
  const body = isRecord(source.body) ? source.body : {}
  const query = isRecord(source.query) ? source.query : {}
  return parseDeliveryInput(projectIdSchema, { id: source.id ?? body.id ?? query.id }).id
}

function mergeLimits(base: DeliveryLimits, patch: Partial<DeliveryLimits> | undefined): DeliveryLimits {
  return {
    maxParallelTasks: patch?.maxParallelTasks ?? base.maxParallelTasks,
    maxCorrectionRounds: patch?.maxCorrectionRounds ?? base.maxCorrectionRounds,
    attemptTimeoutMinutes: patch?.attemptTimeoutMinutes ?? base.attemptTimeoutMinutes,
  }
}

function resolveTargetProfile(id: string, version: number | undefined): TargetProfile {
  const profile = version === undefined ? getLatestTargetProfile(id) : getTargetProfile(id, version)
  if (profile) return profile
  const path = getLatestTargetProfile(id) ? 'targetProfileVersion' : 'targetProfileId'
  throw deliveryHttpError(
    buildDeliveryError('unknown_target_profile', 'Unknown target profile', [{ path, code: 'unknown_target_profile' }]),
  )
}

export type ArchivableSubject = 'project' | 'task' | 'stage'

const UNKNOWN_ATTEMPT_MESSAGES: Record<ArchivableSubject, string> = {
  project: 'Reconcile unknown attempts before archiving the project',
  task: 'Reconcile the unknown attempt before changing the task',
  stage: 'Reconcile the unknown attempt before a new stage version',
}

const ACTIVE_ATTEMPT_MESSAGES: Record<ArchivableSubject, string> = {
  project: 'Project has an active attempt or task',
  task: 'Task has an active attempt',
  stage: 'Cancel or reconcile the active attempt before a new stage version',
}

export function checkProjectArchivable(
  tasks: readonly DeliveryTask[],
  subject: ArchivableSubject = 'project',
): DeliveryCheckResult {
  const unknownMessage = UNKNOWN_ATTEMPT_MESSAGES[subject]
  const activeMessage = ACTIVE_ATTEMPT_MESSAGES[subject]
  const unknown: DeliveryErrorDetail[] = []
  const active: DeliveryErrorDetail[] = []
  for (const task of tasks) {
    const taskPath = `tasks.${task.id}`
    const parsed = parseAttemptRegister(task.executionAttempts)
    if (!parsed.ok) {
      unknown.push({ path: taskPath, code: 'unreadable_attempt_register' })
      continue
    }
    for (const attempt of parsed.register) {
      const attemptPath = `${taskPath}.attempts.${attempt.attemptId}`
      if (attempt.state === 'reconciliation_required') unknown.push({ path: attemptPath, code: 'reconciliation_required' })
      else if (isAttemptActive(attempt)) active.push({ path: attemptPath, code: `attempt_${attempt.state}` })
    }
    if (task.statusReason === 'reconciliation_required') unknown.push({ path: taskPath, code: 'reconciliation_required' })
    if (task.status === 'executing') active.push({ path: taskPath, code: 'task_executing' })
  }
  if (unknown.length > 0) {
    return {
      ok: false,
      ...buildDeliveryError('reconciliation_required', unknownMessage, [...unknown, ...active]),
    }
  }
  if (active.length > 0) {
    return { ok: false, ...buildDeliveryError('attempt_active', activeMessage, active) }
  }
  return { ok: true }
}

async function emitProjectSideEffects(
  ctx: CommandRuntimeContext,
  action: 'created' | 'updated' | 'deleted',
  project: DeliveryProject,
): Promise<void> {
  await emitCrudSideEffects({
    dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
    action,
    entity: project,
    identifiers: { id: project.id, organizationId: project.organizationId, tenantId: project.tenantId },
    indexer: projectCrudIndexer,
  })
}

const createProjectCommand: CommandHandler<ProjectCreateInput, ProjectCommandResult> = {
  id: 'delivery_os.projects.create',
  async execute(rawInput, ctx) {
    const scope = resolveDeliveryScope(ctx)
    const parsed = parseDeliveryInput(projectCreateSchema, rawInput)
    const profile = resolveTargetProfile(parsed.targetProfileId, parsed.targetProfileVersion)

    const em = resolveDeliveryEm(ctx)
    const project = em.create(DeliveryProject, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      name: parsed.name,
      inputMode: parsed.inputMode,
      brief: parsed.brief ?? null,
      targetProfileId: profile.id,
      targetProfileVersion: profile.version,
      repositoryRef: parsed.repositoryRef ?? null,
      draftSpec: draftSpecV1Schema.parse({}),
      activeBaselineId: null,
      limits: mergeLimits(DEFAULT_DELIVERY_LIMITS, parsed.limits),
    })
    em.persist(project)
    await em.flush()

    await emitProjectSideEffects(ctx, 'created', project)
    await emitDeliveryOsEvent(
      'delivery_os.project.created',
      { projectId: project.id, tenantId: scope.tenantId, organizationId: scope.organizationId },
      { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId },
    )

    return { projectId: project.id, updatedAt: project.updatedAt.toISOString() }
  },
  captureAfter: (_input, result, ctx) => loadProjectSnapshot(ctx, result.projectId),
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const after = (snapshots.after as ProjectSnapshot | null | undefined) ?? null
    return {
      actionLabel: translate('delivery_os.audit.projects.create', 'Create delivery project'),
      resourceKind: DELIVERY_PROJECT_RESOURCE_KIND,
      resourceId: result.projectId,
      tenantId: after?.tenantId ?? null,
      organizationId: after?.organizationId ?? null,
      snapshotAfter: after,
    }
  },
}

const updateProjectCommand: CommandHandler<ProjectUpdateInput, ProjectCommandResult> = {
  id: 'delivery_os.projects.update',
  async prepare(rawInput, ctx) {
    const before = await loadProjectSnapshot(ctx, readProjectId(rawInput))
    return before ? { before } : {}
  },
  async execute(rawInput, ctx) {
    const scope = resolveDeliveryScope(ctx)
    const parsed = parseDeliveryInput(projectUpdateSchema, rawInput)

    const em = resolveDeliveryEm(ctx)
    const project = await em.transactional(async (tx) => {
      const locked = await lockProjectForWrite(tx, ctx, parsed.id, scope)
      if (parsed.name !== undefined) locked.name = parsed.name
      if (parsed.brief !== undefined) locked.brief = parsed.brief
      if (parsed.repositoryRef !== undefined) locked.repositoryRef = parsed.repositoryRef
      if (parsed.draftSpec !== undefined) locked.draftSpec = parsed.draftSpec
      if (parsed.limits !== undefined) locked.limits = mergeLimits(locked.limits, parsed.limits)
      return locked
    })

    await emitProjectSideEffects(ctx, 'updated', project)
    return { projectId: project.id, updatedAt: project.updatedAt.toISOString() }
  },
  captureAfter: (_input, result, ctx) => loadProjectSnapshot(ctx, result.projectId),
  buildLog: async ({ result, snapshots }) => {
    const before = (snapshots.before as ProjectSnapshot | undefined) ?? null
    const after = (snapshots.after as ProjectSnapshot | null | undefined) ?? null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('delivery_os.audit.projects.update', 'Update delivery project'),
      resourceKind: DELIVERY_PROJECT_RESOURCE_KIND,
      resourceId: result.projectId,
      tenantId: before?.tenantId ?? after?.tenantId ?? null,
      organizationId: before?.organizationId ?? after?.organizationId ?? null,
      snapshotBefore: before,
      snapshotAfter: after,
      changes: before && after ? buildChanges(before, after, changedProjectKeys(before, after)) : {},
    }
  },
}

const deleteProjectCommand: CommandHandler<ProjectDeleteInput, ProjectCommandResult> = {
  id: 'delivery_os.projects.delete',
  async prepare(input, ctx) {
    const before = await loadProjectSnapshot(ctx, readProjectId(input))
    return before ? { before } : {}
  },
  async execute(input, ctx) {
    const scope = resolveDeliveryScope(ctx)
    const id = readProjectId(input)

    const em = resolveDeliveryEm(ctx)
    const project = await em.transactional(async (tx) => {
      const locked = await lockProjectForWrite(tx, ctx, id, scope)
      const tasks = await lockScopedProjectTasks(tx, locked.id, scope)
      assertDeliveryCheck(checkProjectArchivable(tasks))
      locked.deletedAt = new Date()
      return locked
    })

    await emitProjectSideEffects(ctx, 'deleted', project)
    return { projectId: project.id, updatedAt: project.updatedAt.toISOString() }
  },
  buildLog: async ({ result, snapshots }) => {
    const before = (snapshots.before as ProjectSnapshot | undefined) ?? null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('delivery_os.audit.projects.delete', 'Archive delivery project'),
      resourceKind: DELIVERY_PROJECT_RESOURCE_KIND,
      resourceId: result.projectId,
      tenantId: before?.tenantId ?? null,
      organizationId: before?.organizationId ?? null,
      snapshotBefore: before,
    }
  },
}

registerCommand(createProjectCommand)
registerCommand(updateProjectCommand)
registerCommand(deleteProjectCommand)
