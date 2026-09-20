import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { E } from '#generated/entities.ids.generated'
import { DeliveryBaseline, DeliveryProject, DeliveryTask } from '../data/entities'
import { rebindFlowBaseline } from './flowBaseline'
import { taskCreateSchema } from '../data/validators'
import {
  BASELINE_DECISION_KINDS,
  latestBaselineDecisions,
  nextBaselineVersion,
  resolveActiveBaseline,
  tryHashBaseline,
} from '../lib/baseline'
import { buildDeliveryError, uuidSchema, type DeliveryErrorDetail, type PlanProposalV1 } from '../lib/contracts'
import { taskGraphCheck, type TaskGraphNode } from '../lib/dag'
import { parsePlanProposal, planTaskKeysInOrder, validatePlanProposal } from '../lib/proposals'
import { emitBaselineCreated, findImportedManifest, listProjectBaselines } from './baselines'
import {
  assertDeliveryCheck,
  DELIVERY_BASELINE_RESOURCE_KIND,
  DELIVERY_PROJECT_RESOURCE_KIND,
  deliveryHttpError,
  lockProjectForWrite,
  lockScopedProject,
  lockScopedProjectTasks,
  parseDeliveryInput,
  requireLockHeader,
  requireScopedProject,
  resolveDeliveryEm,
  resolveDeliveryScope,
  type DeliveryScope,
} from './shared'
import {
  emitTaskSideEffects,
  emitTaskUpdated,
  foreignBaselineError,
  loadBaselineDecisionRecords,
  readBaselineContent,
  requireTaskProfile,
  unreadableBaselineError,
} from './tasks'

export type PlanImportTaskResult = { id: string; proposalTaskKey: string; updatedAt: string }

export type PlanImportCommandResult = {
  baselineId: string
  projectId: string
  version: number
  contentHash: string
  parentBaselineId: string | null
  duplicate: boolean
  manifestId: string
  manifestHash: string
  tasks: PlanImportTaskResult[]
  projectUpdatedAt: string
}

type ImportOutcome = { baseline: DeliveryBaseline; tasks: DeliveryTask[]; duplicate: boolean; project: DeliveryProject }

const planProjectSchema = z.object({ projectId: uuidSchema })

const projectCrudIndexer: CrudIndexerConfig<DeliveryProject> = {
  entityType: E.delivery_os.delivery_project,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pickDraftAcEntries(acTestMap: Record<string, string[]>, draft: Record<string, unknown>): Record<string, string[]> {
  const criteria = Array.isArray(draft.acceptanceCriteria) ? draft.acceptanceCriteria : []
  const draftAcIds = new Set(criteria.flatMap((criterion) => (isRecord(criterion) && typeof criterion.id === 'string' ? [criterion.id] : [])))
  return Object.fromEntries(Object.entries(acTestMap).filter(([acId]) => draftAcIds.has(acId)))
}

function readDraftAcTestMap(draft: Record<string, unknown>): Record<string, string[]> {
  if (!isRecord(draft.acTestMap)) return {}
  return Object.fromEntries(
    Object.entries(draft.acTestMap).flatMap(([acId, testIds]) =>
      Array.isArray(testIds) ? [[acId, testIds.filter((testId): testId is string => typeof testId === 'string')]] : [],
    ),
  )
}

function concurrentImportError() {
  return deliveryHttpError(
    buildDeliveryError('idempotency_conflict', 'A concurrent import created a conflicting baseline; retry with the current state', [
      { path: 'manifest', code: 'concurrent_import', message: 'Another import committed a conflicting baseline for this project' },
    ]),
  )
}

function notApprovedError(details: DeliveryErrorDetail[]) {
  return deliveryHttpError(buildDeliveryError('baseline_not_approved', 'The plan needs the active approved baseline', details))
}

async function requireApprovedActiveBaseline(
  tx: EntityManager,
  project: DeliveryProject,
  baseline: DeliveryBaseline,
  scope: DeliveryScope,
): Promise<void> {
  if (baseline.id !== project.activeBaselineId) {
    throw notApprovedError([
      { path: 'baselineId', code: 'baseline_not_active', message: `Active baseline is ${project.activeBaselineId ?? 'not set'}` },
    ])
  }
  const decisions = await loadBaselineDecisionRecords(tx, baseline, scope)
  if (resolveActiveBaseline(decisions, baseline)) return
  const latest = latestBaselineDecisions(decisions, baseline)
  const unapproved = BASELINE_DECISION_KINDS.filter((kind) => {
    const decided = latest[kind]
    return !decided || decided.verdict !== 'approved' || Number.isNaN(new Date(decided.decidedAt).getTime())
  })
  const details = unapproved.map((kind): DeliveryErrorDetail => {
    const decided = latest[kind]
    const code = !decided ? `${kind}_decision_missing` : decided.verdict === 'rejected' ? `${kind}_rejected` : `${kind}_decision_invalid`
    return {
      path: `decisions.${kind}`,
      code,
      message: `No valid approved ${kind} decision for baseline v${baseline.version} (${baseline.contentHash.slice(0, 12)})`,
    }
  })
  throw notApprovedError(details)
}

async function listImportedTasks(
  em: EntityManager,
  baseline: DeliveryBaseline,
  manifest: PlanProposalV1,
  scope: DeliveryScope,
): Promise<DeliveryTask[]> {
  const live = await findWithDecryption(
    em,
    DeliveryTask,
    {
      projectId: baseline.projectId,
      baselineId: baseline.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    undefined,
    scope,
  )
  const byKey = new Map(live.map((task) => [task.proposalTaskKey ?? null, task]))
  return planTaskKeysInOrder(manifest).flatMap((key) => byKey.get(key) ?? [])
}

async function findReplay(
  em: EntityManager,
  project: DeliveryProject,
  baselines: readonly DeliveryBaseline[],
  identity: { manifest: PlanProposalV1; manifestId: string; manifestHash: string },
  scope: DeliveryScope,
): Promise<ImportOutcome | null> {
  const replay = findImportedManifest(baselines, identity.manifestId)
  if (!replay) return null
  if (replay.manifestHash !== identity.manifestHash) {
    throw deliveryHttpError(
      buildDeliveryError('idempotency_conflict', 'This manifestId was already imported with different content', [
        { path: 'manifest.manifestId', code: 'idempotency_conflict', message: `Imported as baseline v${replay.baseline.version}` },
      ]),
    )
  }
  const tasks = await listImportedTasks(em, replay.baseline, identity.manifest, scope)
  return { baseline: replay.baseline, tasks, duplicate: true, project }
}

const importPlanCommand: CommandHandler<unknown, PlanImportCommandResult> = {
  id: 'delivery_os.tasks.import_plan',
  async execute(rawInput, ctx) {
    const scope = resolveDeliveryScope(ctx)
    const { projectId } = parseDeliveryInput(planProjectSchema, rawInput)
    const source = isRecord(rawInput) ? rawInput : {}
    const { projectId: _projectId, ...body } = source
    const parsed = parseDeliveryInput(taskCreateSchema, body)
    if (parsed.source !== 'plan_proposal') {
      throw deliveryHttpError(
        buildDeliveryError('validation_failed', 'Validation failed', [
          { path: 'source', code: 'unsupported_source', message: 'This command imports plan proposals only' },
        ]),
      )
    }
    const createdBy = uuidSchema.safeParse(ctx.auth?.sub)
    await requireScopedProject(resolveDeliveryEm(ctx), projectId, scope)
    const identity = parsePlanProposal(parsed.manifest, projectId)
    if (!identity.ok) throw deliveryHttpError({ status: identity.status, body: identity.body })

    const em = resolveDeliveryEm(ctx)
    let outcome: ImportOutcome
    try {
      outcome = await em.transactional(async (tx) => {
        const locked = await lockScopedProject(tx, projectId, scope)
        const baselines = await listProjectBaselines(tx, locked.id, scope)
        const replay = await findReplay(tx, locked, baselines, identity, scope)
        if (replay) return replay

        requireLockHeader(ctx)
        const project = await lockProjectForWrite(tx, ctx, projectId, scope, { force: true })
        const parent = baselines.find((baseline) => baseline.id === identity.manifest.baselineId)
        if (!parent) throw deliveryHttpError(foreignBaselineError())
        const parentContent = readBaselineContent(parent)
        if (!parentContent) throw deliveryHttpError(unreadableBaselineError())
        if (tryHashBaseline(parentContent) !== parent.contentHash) {
          throw deliveryHttpError(
            buildDeliveryError('hash_mismatch', 'Stored baseline content does not match its hash', [
              { path: 'contentHash', code: 'hash_mismatch', message: 'The stored baseline content was altered' },
            ]),
          )
        }
        await requireApprovedActiveBaseline(tx, project, parent, scope)

        const profile = requireTaskProfile(project.targetProfileId, project.targetProfileVersion)
        const plan = validatePlanProposal(parsed.manifest, {
          project: { id: project.id, targetProfileId: project.targetProfileId, targetProfileVersion: project.targetProfileVersion },
          baseline: { id: parent.id, projectId: parent.projectId, contentHash: parent.contentHash, content: parentContent },
          profile,
        })
        if (!plan.ok) throw deliveryHttpError({ status: plan.status, body: plan.body })

        const projectTasks = await lockScopedProjectTasks(tx, project.id, scope)
        const mergedBaselineId = randomUUID()
        const taskIdByKey = new Map(plan.tasks.map((task) => [task.proposalTaskKey, randomUUID()]))
        const nodes: TaskGraphNode[] = plan.tasks.map((task) => ({
          id: taskIdByKey.get(task.proposalTaskKey) ?? '',
          projectId: project.id,
          baselineId: mergedBaselineId,
          dependsOnTaskIds: task.dependsOn.map((key) => taskIdByKey.get(key) ?? ''),
        }))
        const existingNodes: TaskGraphNode[] = projectTasks.map((task) => ({
          id: task.id,
          projectId: task.projectId,
          baselineId: task.baselineId,
          dependsOnTaskIds: task.dependsOnTaskIds,
        }))
        assertDeliveryCheck(taskGraphCheck([...existingNodes, ...nodes], project.id))

        const baseline = tx.create(DeliveryBaseline, {
          id: mergedBaselineId,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          projectId: project.id,
          version: nextBaselineVersion(baselines.map((entry) => entry.version)),
          contentHash: plan.contentHash,
          source: 'plan_proposal',
          parentBaselineId: parent.id,
          content: plan.baselineContent,
          attachmentIds: [...parent.attachmentIds],
          createdBy: createdBy.success ? createdBy.data : null,
        })
        tx.persist(baseline)
        const tasks = plan.tasks.map((task, index) => {
          const created = tx.create(DeliveryTask, {
            id: nodes[index].id,
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            projectId: project.id,
            baselineId: mergedBaselineId,
            title: task.title,
            description: task.description,
            acIds: task.acIds,
            dependsOnTaskIds: [...nodes[index].dependsOnTaskIds],
            allowedPaths: task.allowedPaths,
            targetProfileId: profile.id,
            targetProfileVersion: profile.version,
            status: 'draft',
            statusReason: null,
            proposalTaskKey: task.proposalTaskKey,
          })
          tx.persist(created)
          return created
        })
        const draft = isRecord(project.draftSpec) ? project.draftSpec : {}
        project.draftSpec = {
          ...draft,
          architectureSummary: plan.baselineContent.architectureSummary,
          planSummary: plan.baselineContent.planSummary,
          acTestMap: {
            ...pickDraftAcEntries(readDraftAcTestMap(draft), draft),
            ...pickDraftAcEntries(plan.baselineContent.acTestMap, draft),
          },
          declaredTests: plan.baselineContent.declaredTests,
        }
        await rebindFlowBaseline(tx, project, baseline, scope, createdBy.success ? createdBy.data : null)
        project.updatedAt = new Date()
        await tx.flush()
        return { baseline, tasks, duplicate: false, project }
      })
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      const recoveryEm = resolveDeliveryEm(ctx)
      const project = await requireScopedProject(recoveryEm, projectId, scope)
      const winner = await findReplay(recoveryEm, project, await listProjectBaselines(recoveryEm, projectId, scope), identity, scope)
      if (!winner) throw concurrentImportError()
      outcome = winner
    }

    if (!outcome.duplicate) {
      await emitBaselineCreated(ctx, scope, outcome.baseline)
      await emitCrudSideEffects({
        dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
        action: 'updated',
        entity: outcome.project,
        identifiers: { id: outcome.project.id, organizationId: scope.organizationId, tenantId: scope.tenantId },
        indexer: projectCrudIndexer,
      })
      for (const task of outcome.tasks) {
        await emitTaskSideEffects(ctx, 'created', task)
        await emitTaskUpdated(task)
      }
    }
    return {
      baselineId: outcome.baseline.id,
      projectId: outcome.baseline.projectId,
      version: outcome.baseline.version,
      contentHash: outcome.baseline.contentHash,
      parentBaselineId: outcome.baseline.parentBaselineId ?? null,
      duplicate: outcome.duplicate,
      manifestId: identity.manifestId,
      manifestHash: identity.manifestHash,
      tasks: outcome.tasks.map((task) => ({
        id: task.id,
        proposalTaskKey: task.proposalTaskKey ?? '',
        updatedAt: (task.updatedAt ?? new Date()).toISOString(),
      })),
      projectUpdatedAt: outcome.project.updatedAt.toISOString(),
    }
  },
  buildLog: async ({ result, ctx }) => {
    if (result.duplicate) return null
    const scope = resolveDeliveryScope(ctx)
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('delivery_os.audit.tasks.import_plan', 'Import plan proposal'),
      resourceKind: DELIVERY_BASELINE_RESOURCE_KIND,
      resourceId: result.baselineId,
      parentResourceKind: DELIVERY_PROJECT_RESOURCE_KIND,
      parentResourceId: result.projectId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      snapshotAfter: {
        id: result.baselineId,
        projectId: result.projectId,
        version: result.version,
        contentHash: result.contentHash,
        source: 'plan_proposal',
        parentBaselineId: result.parentBaselineId,
        manifestId: result.manifestId,
        manifestHash: result.manifestHash,
        taskIds: result.tasks.map((task) => task.id),
      },
    }
  },
}

registerCommand(importPlanCommand)
