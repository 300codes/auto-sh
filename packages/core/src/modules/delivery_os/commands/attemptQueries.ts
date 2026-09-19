import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { DeliveryTask, type DeliveryProject } from '../data/entities'
import { findAttempt, parseAttemptRegister } from '../lib/attempts'
import { buildDeliveryError, type ExecutionAttempt, type TaskPackageV1 } from '../lib/contracts'
import { getTargetProfile } from '../lib/targetProfiles'
import { buildTaskPackageV1, type TaskPackageOptions, type TaskPackageResult } from '../lib/taskPackage'
import { deliveryHttpError, requireScopedProject, requireScopedTask, type DeliveryScope } from './shared'
import { findProjectBaseline } from './tasks'

export type PendingDelivery = {
  taskId: string
  attemptId: string
  evidenceId: string
  workflowRef: string
  workflowStepId: string | null
}

export type PendingDeliveryOptions = { limit?: number }

export type DeliveryOsAttemptQueries = {
  getAttempt(scope: DeliveryScope, taskId: string, attemptId: string): Promise<ExecutionAttempt | null>
  buildTaskPackage(scope: DeliveryScope, taskId: string, attemptId: string): Promise<TaskPackageV1>
  listPendingDeliveries(scope: DeliveryScope, options?: PendingDeliveryOptions): Promise<PendingDelivery[]>
}

type TaskPackageSubject = {
  task: DeliveryTask
  project: DeliveryProject
  attempt: ExecutionAttempt | undefined
  scope: DeliveryScope
}

const DEFAULT_PENDING_LIMIT = 50
const MAX_PENDING_LIMIT = 100
const PENDING_SCAN_PAGE_SIZE = 200

function assertQueryScope(scope: DeliveryScope | null | undefined): DeliveryScope {
  if (scope && typeof scope.tenantId === 'string' && scope.tenantId && typeof scope.organizationId === 'string' && scope.organizationId) {
    return { tenantId: scope.tenantId, organizationId: scope.organizationId }
  }
  throw new Error('[internal] deliveryOsAttemptQueries requires tenantId and organizationId')
}

function readRegister(task: DeliveryTask): ExecutionAttempt[] {
  const register = parseAttemptRegister(task.executionAttempts)
  if (register.ok) return register.register
  throw deliveryHttpError(
    buildDeliveryError('reconciliation_required', 'Reconcile the unknown attempt before continuing', [
      { path: 'executionAttempts', code: 'unreadable_attempt_register' },
    ]),
  )
}

function clampPendingLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1) return DEFAULT_PENDING_LIMIT
  return Math.min(limit, MAX_PENDING_LIMIT)
}

export async function loadTaskPackage(
  em: EntityManager,
  subject: TaskPackageSubject,
  options: TaskPackageOptions = {},
): Promise<TaskPackageResult> {
  const { task, project, attempt, scope } = subject
  const baseline = await findProjectBaseline(em, task.baselineId, project.id, scope)
  if (!baseline) {
    return {
      ok: false,
      ...buildDeliveryError('foreign_reference', 'Baseline does not belong to this project', [
        { path: 'baselineId', code: 'foreign_baseline' },
      ]),
    }
  }
  const profile = getTargetProfile(task.targetProfileId, task.targetProfileVersion)
  if (!profile) {
    return {
      ok: false,
      ...buildDeliveryError('unknown_target_profile', 'Unknown target profile', [
        { path: 'targetProfileId', code: 'unknown_target_profile' },
      ]),
    }
  }
  return buildTaskPackageV1(
    {
      project: { id: project.id, repositoryRef: project.repositoryRef ?? null, limits: project.limits },
      task,
      baseline,
      attempt,
      profile,
    },
    options,
  )
}

export function createDeliveryOsAttemptQueries(rootEm: EntityManager): DeliveryOsAttemptQueries {
  return {
    async getAttempt(rawScope, taskId, attemptId) {
      const scope = assertQueryScope(rawScope)
      const task = await findOneWithDecryption(
        rootEm.fork(),
        DeliveryTask,
        { id: taskId, tenantId: scope.tenantId, organizationId: scope.organizationId },
        undefined,
        scope,
      )
      if (!task) return null
      return findAttempt(readRegister(task), attemptId) ?? null
    },

    async buildTaskPackage(rawScope, taskId, attemptId) {
      const scope = assertQueryScope(rawScope)
      const em = rootEm.fork()
      const task = await requireScopedTask(em, taskId, scope)
      const project = await requireScopedProject(em, task.projectId, scope)
      const attempt = findAttempt(readRegister(task), attemptId)
      const result = await loadTaskPackage(em, { task, project, attempt, scope })
      if (!result.ok) throw deliveryHttpError(result)
      return result.taskPackage
    },

    async listPendingDeliveries(rawScope, options = {}) {
      const scope = assertQueryScope(rawScope)
      const limit = clampPendingLimit(options.limit)
      const em = rootEm.fork()
      const pending: PendingDelivery[] = []
      let lastId: string | null = null
      for (;;) {
        const where: FilterQuery<DeliveryTask> = {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          attemptNumber: { $gt: 0 },
          ...(lastId ? { id: { $gt: lastId } } : {}),
        }
        const tasks: DeliveryTask[] = await findWithDecryption(
          em,
          DeliveryTask,
          where,
          { orderBy: { id: 'asc' }, limit: PENDING_SCAN_PAGE_SIZE },
          scope,
        )
        for (const task of tasks) {
          const register = parseAttemptRegister(task.executionAttempts)
          if (!register.ok) continue
          for (const attempt of register.register) {
            if (attempt.completionDelivery !== 'pending' || !attempt.workflowRef || !attempt.resultEvidenceId) continue
            pending.push({
              taskId: task.id,
              attemptId: attempt.attemptId,
              evidenceId: attempt.resultEvidenceId,
              workflowRef: attempt.workflowRef,
              workflowStepId: attempt.workflowStepId,
            })
            if (pending.length >= limit) return pending
          }
        }
        if (tasks.length < PENDING_SCAN_PAGE_SIZE) break
        lastId = tasks[tasks.length - 1].id
      }
      return pending
    },
  }
}
