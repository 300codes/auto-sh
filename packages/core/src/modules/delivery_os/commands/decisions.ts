import { z } from 'zod'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { E } from '#generated/entities.ids.generated'
import { DeliveryDecision, type DeliveryBaseline, type DeliveryProject } from '../data/entities'
import { baselineDecisionSchema, deployDecisionSchema, type BaselineDecisionInput } from '../data/validators'
import { emitDeliveryOsEvent } from '../events'
import { resolveActiveBaseline, type BaselineDecisionRecord } from '../lib/baseline'
import {
  buildDeliveryError,
  uuidSchema,
  type DeliveryCheckResult,
  type DeliveryErrorDetail,
  type ReportGateBlocker,
} from '../lib/contracts'
import { hashCanonical } from '../lib/hash'
import type { DeliveryOsReportQueries } from './reportQueries'
import { findProjectBaseline, requireTaskProfile } from './tasks'
import {
  assertDeliveryCheck,
  DELIVERY_BASELINE_RESOURCE_KIND,
  DELIVERY_DECISION_RESOURCE_KIND,
  DELIVERY_PROJECT_RESOURCE_KIND,
  deliveryHttpError,
  findScopedBaseline,
  lockProjectForWrite,
  parseDeliveryInput,
  requireActorUserId,
  requireLockHeader,
  requireScopedBaseline,
  requireScopedProject,
  resolveDeliveryEm,
  resolveDeliveryScope,
  type DeliveryScope,
} from './shared'

export type DecisionCommandResult = {
  decisionId: string
  projectId: string
  baselineId: string
  kind: BaselineDecisionInput['kind'] | 'deploy'
  verdict: BaselineDecisionInput['verdict']
  activeBaselineId: string | null
  activeBaselineChanged: boolean
  projectUpdatedAt: string
}

const LATER_DECISION_KINDS: readonly unknown[] = ['release']

const decisionBaselineSchema = z.object({ baselineId: uuidSchema })

const deployDecisionCommandSchema = deployDecisionSchema.and(z.object({ projectId: uuidSchema, kind: z.literal('deploy') }))

const projectCrudIndexer: CrudIndexerConfig<DeliveryProject> = {
  entityType: E.delivery_os.delivery_project,
}

const decisionCrudIndexer: CrudIndexerConfig<DeliveryDecision> = {
  entityType: E.delivery_os.delivery_decision,
}

function readKind(rawInput: unknown): unknown {
  return typeof rawInput === 'object' && rawInput !== null ? (rawInput as Record<string, unknown>).kind : undefined
}

export function checkDecisionSubject(
  baseline: Pick<DeliveryBaseline, 'contentHash' | 'version'>,
  input: Pick<BaselineDecisionInput, 'subjectHash' | 'subjectVersion'>,
): DeliveryCheckResult {
  const details: DeliveryErrorDetail[] = []
  if (input.subjectHash !== baseline.contentHash) {
    details.push({ path: 'subjectHash', code: 'subject_hash_mismatch', message: 'The decision names another content hash' })
  }
  if (input.subjectVersion !== baseline.version) {
    details.push({
      path: 'subjectVersion',
      code: 'subject_version_mismatch',
      message: `The stored baseline is version ${baseline.version}`,
    })
  }
  if (details.length === 0) return { ok: true }
  return {
    ok: false,
    ...buildDeliveryError('subject_hash_mismatch', 'The decision does not match the stored baseline', details),
  }
}

function checkStoredContent(baseline: DeliveryBaseline): DeliveryCheckResult {
  let storedHash: string | null = null
  try {
    storedHash = hashCanonical(baseline.content)
  } catch {
    storedHash = null
  }
  if (storedHash === baseline.contentHash) return { ok: true }
  return {
    ok: false,
    ...buildDeliveryError('hash_mismatch', 'Stored baseline content does not match its hash', [
      { path: 'baselineId', code: 'stored_content_altered' },
    ]),
  }
}

function toDecisionRecord(decision: DeliveryDecision): BaselineDecisionRecord {
  return {
    kind: decision.kind,
    verdict: decision.verdict,
    subjectHash: decision.subjectHash,
    subjectVersion: decision.subjectVersion ?? null,
    decidedAt: decision.decidedAt,
  }
}

function nextDecidedAt(existing: readonly DeliveryDecision[], project: DeliveryProject): Date {
  const latest = [project.updatedAt, ...existing.map((decision) => decision.decidedAt)].reduce((max, value) => {
    const at = value instanceof Date ? value.getTime() : Number.NaN
    return Number.isNaN(at) ? max : Math.max(max, at)
  }, 0)
  return new Date(Math.max(Date.now(), latest + 1))
}

export function reportBlockersToDetails(blocking: readonly ReportGateBlocker[]): DeliveryErrorDetail[] {
  return blocking.map((blocker) => ({
    path: `${blocker.kind}:${blocker.id}`,
    code: blocker.status,
    message: `${blocker.kind} ${blocker.id} is ${blocker.status}`,
  }))
}

function invalidRevisionKind(message: string) {
  return deliveryHttpError(
    buildDeliveryError('invalid_revision', message, [{ path: 'sourceRevision', code: 'revision_kind_mismatch' }]),
  )
}

type CommandContext = Parameters<CommandHandler<unknown, DecisionCommandResult>['execute']>[1]

async function recordDeployDecision(rawInput: unknown, ctx: CommandContext): Promise<DecisionCommandResult> {
  const scope = resolveDeliveryScope(ctx)
  const parsed = parseDeliveryInput(deployDecisionCommandSchema, rawInput)
  requireLockHeader(ctx)
  const actorUserId = requireActorUserId(ctx)
  const readEm = resolveDeliveryEm(ctx)
  await requireScopedProject(readEm, parsed.projectId, scope)
  const reportQueries = ctx.container.resolve('deliveryOsReportQueries') as DeliveryOsReportQueries

  const em = resolveDeliveryEm(ctx)
  const outcome = await em.transactional(async (tx) => {
    const project = await lockProjectForWrite(tx, ctx, parsed.projectId, scope, { force: true })
    const profile = requireTaskProfile(project.targetProfileId, project.targetProfileVersion)
    if (parsed.sourceRevision.kind !== profile.revisionKind) {
      throw invalidRevisionKind(`Profile ${profile.id}@${profile.version} requires a ${profile.revisionKind} revision`)
    }
    const baseline =
      project.activeBaselineId === parsed.baselineId ? await findProjectBaseline(tx, parsed.baselineId, project.id, scope) : null
    if (!baseline) {
      throw deliveryHttpError(
        buildDeliveryError('baseline_not_active', 'Publish consent applies only to the active baseline', [
          { path: 'baselineId', code: 'baseline_not_active' },
        ]),
      )
    }
    if (parsed.verdict === 'approved') {
      const report = await reportQueries.buildReport(scope, project.id, {
        baselineId: baseline.id,
        revision: parsed.sourceRevision,
      })
      if (!report.gates.publishable.ok) {
        throw deliveryHttpError(
          buildDeliveryError(
            'report_not_green',
            'The delivery report is not publishable on this revision',
            reportBlockersToDetails(report.gates.publishable.blocking),
          ),
        )
      }
    }
    const existing = await findWithDecryption(
      tx,
      DeliveryDecision,
      { projectId: project.id, kind: 'deploy', tenantId: scope.tenantId, organizationId: scope.organizationId },
      undefined,
      scope,
    )
    const decidedAt = nextDecidedAt(existing, project)
    const decision = tx.create(DeliveryDecision, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      projectId: project.id,
      kind: 'deploy',
      subjectType: 'baseline',
      subjectId: baseline.id,
      subjectHash: baseline.contentHash,
      subjectVersion: baseline.version,
      sourceRevision: parsed.sourceRevision,
      verdict: parsed.verdict,
      reason: parsed.reason?.trim() || null,
      actorUserId,
      decidedAt,
    })
    project.updatedAt = decidedAt
    tx.persist(decision)
    return { decision, project, baseline }
  })

  await emitDecisionSideEffects(ctx, scope, outcome.decision, outcome.project)
  return {
    decisionId: outcome.decision.id,
    projectId: outcome.project.id,
    baselineId: outcome.baseline.id,
    kind: 'deploy',
    verdict: parsed.verdict,
    activeBaselineId: outcome.project.activeBaselineId ?? null,
    activeBaselineChanged: false,
    projectUpdatedAt: outcome.project.updatedAt.toISOString(),
  }
}

async function emitDecisionSideEffects(
  ctx: CommandContext,
  scope: DeliveryScope,
  decision: DeliveryDecision,
  project: DeliveryProject,
): Promise<void> {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  await emitCrudSideEffects({
    dataEngine,
    action: 'created',
    entity: decision,
    identifiers: { id: decision.id, organizationId: scope.organizationId, tenantId: scope.tenantId },
    indexer: decisionCrudIndexer,
  })
  await emitCrudSideEffects({
    dataEngine,
    action: 'updated',
    entity: project,
    identifiers: { id: project.id, organizationId: scope.organizationId, tenantId: scope.tenantId },
    indexer: projectCrudIndexer,
  })
}

const recordDecisionCommand: CommandHandler<unknown, DecisionCommandResult> = {
  id: 'delivery_os.decisions.record',
  async execute(rawInput, ctx) {
    if (readKind(rawInput) === 'deploy') return recordDeployDecision(rawInput, ctx)
    const scope = resolveDeliveryScope(ctx)
    if (LATER_DECISION_KINDS.includes(readKind(rawInput))) {
      throw deliveryHttpError(
        buildDeliveryError('unsupported_evidence_kind', 'Release decisions are not supported yet', [
          { path: 'kind', code: 'decision_kind_not_supported' },
        ]),
      )
    }
    const { baselineId } = parseDeliveryInput(decisionBaselineSchema, rawInput)
    const parsed = parseDeliveryInput(baselineDecisionSchema, rawInput)
    requireLockHeader(ctx)
    const actorUserId = requireActorUserId(ctx)

    const readEm = resolveDeliveryEm(ctx)
    const baseline = await requireScopedBaseline(readEm, baselineId, scope)
    await requireScopedProject(readEm, baseline.projectId, scope)

    const em = resolveDeliveryEm(ctx)
    const outcome = await em.transactional(async (tx) => {
      const project = await lockProjectForWrite(tx, ctx, baseline.projectId, scope, { force: true })
      assertDeliveryCheck(checkDecisionSubject(baseline, parsed))
      if (parsed.verdict === 'approved') assertDeliveryCheck(checkStoredContent(baseline))
      const existing = await findWithDecryption(
        tx,
        DeliveryDecision,
        {
          projectId: project.id,
          subjectType: 'baseline',
          subjectId: baseline.id,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        },
        undefined,
        scope,
      )

      const previousActiveId = project.activeBaselineId ?? null
      const activeBaseline =
        previousActiveId && previousActiveId !== baseline.id ? await findScopedBaseline(tx, previousActiveId, scope) : null
      const isSuperseded = activeBaseline !== null && activeBaseline.version > baseline.version

      const decidedAt = nextDecidedAt(existing, project)
      const records: BaselineDecisionRecord[] = [
        ...existing.map(toDecisionRecord),
        {
          kind: parsed.kind,
          verdict: parsed.verdict,
          subjectHash: baseline.contentHash,
          subjectVersion: baseline.version,
          decidedAt,
        },
      ]
      const approved = resolveActiveBaseline(records, { contentHash: baseline.contentHash, version: baseline.version })
      const retainedActiveId = previousActiveId === baseline.id ? null : previousActiveId
      const nextActiveId = approved && !isSuperseded ? baseline.id : retainedActiveId

      const decision = tx.create(DeliveryDecision, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        projectId: project.id,
        kind: parsed.kind,
        subjectType: 'baseline',
        subjectId: baseline.id,
        subjectHash: baseline.contentHash,
        subjectVersion: baseline.version,
        sourceRevision: null,
        verdict: parsed.verdict,
        reason: parsed.reason?.trim() || null,
        actorUserId,
        decidedAt,
      })
      project.activeBaselineId = nextActiveId
      project.updatedAt = decidedAt
      tx.persist(decision)
      return { decision, project, previousActiveId, nextActiveId }
    })

    const activeBaselineChanged = outcome.nextActiveId !== outcome.previousActiveId
    if (activeBaselineChanged && outcome.nextActiveId) {
      await emitDeliveryOsEvent(
        'delivery_os.baseline.approved',
        {
          projectId: outcome.project.id,
          baselineId: baseline.id,
          version: baseline.version,
          contentHash: baseline.contentHash,
          activeBaselineId: outcome.nextActiveId,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        },
        { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId },
      )
    }

    await emitDecisionSideEffects(ctx, scope, outcome.decision, outcome.project)

    return {
      decisionId: outcome.decision.id,
      projectId: outcome.project.id,
      baselineId: baseline.id,
      kind: parsed.kind,
      verdict: parsed.verdict,
      activeBaselineId: outcome.nextActiveId,
      activeBaselineChanged,
      projectUpdatedAt: outcome.project.updatedAt.toISOString(),
    }
  },
  buildLog: async ({ result, ctx }) => {
    const scope = resolveDeliveryScope(ctx)
    const { translate } = await resolveTranslations()
    const isDeploy = result.kind === 'deploy'
    return {
      actionLabel: isDeploy
        ? translate('delivery_os.audit.decisions.deploy', 'Record deploy decision')
        : translate('delivery_os.audit.decisions.record', 'Record baseline decision'),
      resourceKind: DELIVERY_DECISION_RESOURCE_KIND,
      resourceId: result.decisionId,
      parentResourceKind: isDeploy ? DELIVERY_PROJECT_RESOURCE_KIND : DELIVERY_BASELINE_RESOURCE_KIND,
      parentResourceId: isDeploy ? result.projectId : result.baselineId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      snapshotAfter: result,
    }
  },
}

registerCommand(recordDecisionCommand)
