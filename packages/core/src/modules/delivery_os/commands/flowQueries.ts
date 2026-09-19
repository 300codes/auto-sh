import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { DeliveryIntake, DeliveryProject, DeliveryTask } from '../data/entities'
import {
  buildDeliveryError,
  FLOW_APPROVAL_STAGE_ORDER,
  type ExecutionAttempt,
  type FlowBlocker,
  type FlowStatusV1,
  type FlowTemplateRef,
} from '../lib/contracts'
import { parseAttemptRegister } from '../lib/attempts'
import { computeStageCurrency } from '../lib/flowRules'
import { buildFlowStatus, countBlockingThreadsByStage, type FlowStatusProject } from '../lib/flowStatus'
import type { CommentThreadRecord } from '../lib/stageDecisions'
import {
  isFlowPinned,
  loadStageArtifactRows,
  loadStageDecisionRows,
  readPinnedTemplate,
  readPinnedTemplateRef,
  toStageArtifactRecord,
  toStageDecisionRecord,
} from './flowGate'
import { deliveryHttpError, type DeliveryScope } from './shared'
import { loadStageCommentThreads } from './stages'

const logger = createLogger('delivery_os')

export type DeliveryOsFlowQueries = {
  flowStatus(projectId: string, scope: DeliveryScope): Promise<FlowStatusV1>
}

function assertQueryScope(scope: DeliveryScope | null | undefined): DeliveryScope {
  if (scope && typeof scope.tenantId === 'string' && scope.tenantId && typeof scope.organizationId === 'string' && scope.organizationId) {
    return { tenantId: scope.tenantId, organizationId: scope.organizationId }
  }
  throw new Error('[internal] deliveryOsFlowQueries requires tenantId and organizationId')
}

function collectAttempts(tasks: readonly DeliveryTask[]): ExecutionAttempt[] {
  return tasks.flatMap((task) => {
    const register = parseAttemptRegister(task.executionAttempts)
    return register.ok ? register.register : []
  })
}

async function loadThreads(em: EntityManager, projectId: string, scope: DeliveryScope): Promise<CommentThreadRecord[]> {
  const perStage = await Promise.all(FLOW_APPROVAL_STAGE_ORDER.map((stageId) => loadStageCommentThreads(em, projectId, stageId, scope)))
  return perStage.flat()
}

/** A pinned snapshot that no longer parses never opens a gate: every approval stage counts as missing. */
function unreadableSnapshotStatus(base: FlowStatusV1, templateRef: FlowTemplateRef | null): FlowStatusV1 {
  const blocking: FlowBlocker[] = FLOW_APPROVAL_STAGE_ORDER.map((stageId) => ({ kind: 'artifact_missing', stageId, ref: null }))
  return {
    ...base,
    template: templateRef,
    blockers: [...blocking, ...base.blockers.filter((blocker) => blocker.kind === 'attempt_active')],
    gates: { dispatchable: { ok: false, blocking }, publishable: { ok: false, blocking } },
    nextAction: { kind: 'none', stageId: null },
  }
}

/**
 * F6 read model shared by `GET /projects/:id/flow` and the enterprise/workflow steps (DI `deliveryOsFlowQueries`).
 * Read-only: archived projects stay readable, nothing is locked or written.
 */
export function createDeliveryOsFlowQueries(rootEm: EntityManager): DeliveryOsFlowQueries {
  return {
    async flowStatus(projectId, rawScope) {
      const scope = assertQueryScope(rawScope)
      const em = rootEm.fork()
      const scoped = { tenantId: scope.tenantId, organizationId: scope.organizationId }
      const project = await findOneWithDecryption(em, DeliveryProject, { id: projectId, ...scoped }, undefined, scope)
      if (!project) throw deliveryHttpError(buildDeliveryError('not_found', 'Not found', [{ path: 'projectId', code: 'not_found' }]))

      const intake = await findOneWithDecryption(em, DeliveryIntake, { projectId: project.id, ...scoped }, undefined, scope)
      const tasks = await findWithDecryption(em, DeliveryTask, { projectId: project.id, ...scoped, deletedAt: null }, undefined, scope)
      const pinned = isFlowPinned(project)
      const template = pinned ? readPinnedTemplate(project) : null
      const templateRef = pinned ? readPinnedTemplateRef(project) : null
      const artifactRows = pinned ? await loadStageArtifactRows(em, project.id, scope) : []
      const decisionRows = pinned ? await loadStageDecisionRows(em, project.id, scope) : []
      const artifacts = artifactRows.map((row) => ({ ...toStageArtifactRecord(row), createdAt: row.createdAt.toISOString() }))
      const decisions = decisionRows.map(toStageDecisionRecord)
      const threads = template ? await loadThreads(em, project.id, scope) : []
      const openThreadsByStage =
        template && threads.length > 0 ? countBlockingThreadsByStage(threads, computeStageCurrency(template, artifacts, decisions)) : {}

      const statusProject: FlowStatusProject = {
        projectId: project.id,
        template,
        templateRef: template ? templateRef : null,
        workflowInstanceId: project.flowWorkflowInstanceId ?? null,
        updatedAt: project.updatedAt.toISOString(),
      }
      const status = buildFlowStatus({
        project: statusProject,
        intakeStep: intake?.step ?? null,
        artifacts,
        decisions,
        openThreadsByStage,
        attempts: collectAttempts(tasks),
      })
      if (!pinned || template) return status
      logger.warn('pinned flow template snapshot is unreadable; flow status fails closed', { projectId: project.id, templateId: project.flowTemplateId })
      return unreadableSnapshotStatus(status, templateRef)
    },
  }
}
