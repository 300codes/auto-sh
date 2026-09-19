import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { E } from '#generated/entities.ids.generated'
import { DeliveryBaseline } from '../data/entities'
import { baselineCreateSchema, draftSpecV1Schema } from '../data/validators'
import { buildBaselineContent, nextBaselineVersion } from '../lib/baseline'
import { applyAttachmentSnapshot, checkDesignReview, checkRawScreenRenders } from '../lib/designReview'
import {
  buildDeliveryError,
  deliveryErrorFromZod,
  uuidSchema,
  type DeliveryCheckResult,
  type DeliveryErrorDetail,
} from '../lib/contracts'
import { verifyDraftAttachments } from './attachments'
import {
  assertDeliveryCheck,
  DELIVERY_BASELINE_RESOURCE_KIND,
  DELIVERY_PROJECT_RESOURCE_KIND,
  deliveryHttpError,
  lockProjectForWrite,
  parseDeliveryInput,
  requireLockHeader,
  requireScopedProject,
  resolveDeliveryEm,
  resolveDeliveryScope,
  type DeliveryScope,
} from './shared'

export type BaselineCommandResult = {
  baselineId: string
  projectId: string
  version: number
  contentHash: string
  duplicate: boolean
  openCommentIds: string[]
}

type DraftSpec = z.infer<typeof draftSpecV1Schema>

const baselineProjectSchema = z.object({ projectId: uuidSchema })

const baselineCrudIndexer: CrudIndexerConfig<DeliveryBaseline> = {
  entityType: E.delivery_os.delivery_baseline,
}

export function checkDraftFreezable(draft: DraftSpec): DeliveryCheckResult {
  const details: DeliveryErrorDetail[] = []
  if (draft.requirements.length === 0) {
    details.push({ path: 'requirements', code: 'missing_requirements', message: 'Add at least one requirement' })
  }
  if (draft.acceptanceCriteria.length === 0) {
    details.push({
      path: 'acceptanceCriteria',
      code: 'missing_acceptance_criteria',
      message: 'Add at least one acceptance criterion',
    })
  }
  const hasScopeGap = details.length > 0
  if (draft.screens.length === 0) {
    details.push({ path: 'screens', code: 'missing_render', message: 'Attach at least one stored render or snapshot' })
  }
  if (details.length === 0) return { ok: true }
  return hasScopeGap
    ? { ok: false, ...buildDeliveryError('missing_acceptance_criteria', 'A baseline needs requirements and acceptance criteria', details) }
    : { ok: false, ...buildDeliveryError('missing_render', 'A baseline needs a stored design render', details) }
}

function findProjectBaselineByHash(
  em: EntityManager,
  projectId: string,
  contentHash: string,
  scope: DeliveryScope,
): Promise<DeliveryBaseline | null> {
  return findOneWithDecryption(
    em,
    DeliveryBaseline,
    { projectId, contentHash, tenantId: scope.tenantId, organizationId: scope.organizationId },
    undefined,
    scope,
  )
}

function toResult(baseline: DeliveryBaseline, duplicate: boolean, openCommentIds: string[]): BaselineCommandResult {
  return {
    baselineId: baseline.id,
    projectId: baseline.projectId,
    version: baseline.version,
    contentHash: baseline.contentHash,
    duplicate,
    openCommentIds,
  }
}

const createBaselineCommand: CommandHandler<unknown, BaselineCommandResult> = {
  id: 'delivery_os.baselines.create',
  async execute(rawInput, ctx) {
    const scope = resolveDeliveryScope(ctx)
    const { projectId } = parseDeliveryInput(baselineProjectSchema, rawInput)
    const parsed = parseDeliveryInput(baselineCreateSchema, rawInput)
    if (parsed.source !== 'manual') {
      throw deliveryHttpError(
        buildDeliveryError('validation_failed', 'Validation failed', [{ path: 'source', code: 'unsupported_source' }]),
      )
    }
    requireLockHeader(ctx)
    const createdBy = uuidSchema.safeParse(ctx.auth?.sub)
    await requireScopedProject(resolveDeliveryEm(ctx), projectId, scope)

    const frozen = { contentHash: null as string | null, openCommentIds: [] as string[] }
    const em = resolveDeliveryEm(ctx)
    let outcome: { baseline: DeliveryBaseline; duplicate: boolean }
    try {
      outcome = await em.transactional(async (tx) => {
        const project = await lockProjectForWrite(tx, ctx, projectId, scope, { force: true })
        assertDeliveryCheck(checkRawScreenRenders((project.draftSpec as { screens?: unknown } | null)?.screens))
        const draft = draftSpecV1Schema.safeParse(project.draftSpec)
        if (!draft.success) throw deliveryHttpError(deliveryErrorFromZod(draft.error))
        assertDeliveryCheck(checkDraftFreezable(draft.data))
        assertDeliveryCheck(checkDesignReview(draft.data))
        const verified = await verifyDraftAttachments(tx, ctx, draft.data, scope)
        if (!verified.ok) throw deliveryHttpError({ status: verified.status, body: verified.body })
        const built = buildBaselineContent(applyAttachmentSnapshot(draft.data, verified.snapshots))
        if (!built.ok) throw deliveryHttpError({ status: built.status, body: built.body })
        frozen.contentHash = built.contentHash
        frozen.openCommentIds = built.openCommentIds

        const existing = await findWithDecryption(
          tx,
          DeliveryBaseline,
          { projectId: project.id, tenantId: scope.tenantId, organizationId: scope.organizationId },
          undefined,
          scope,
        )
        const identical = existing.find((baseline) => baseline.contentHash === built.contentHash)
        if (identical) return { baseline: identical, duplicate: true }

        const baseline = tx.create(DeliveryBaseline, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          projectId: project.id,
          version: nextBaselineVersion(existing.map((entry) => entry.version)),
          contentHash: built.contentHash,
          source: 'manual',
          parentBaselineId: null,
          content: built.content,
          attachmentIds: verified.attachmentIds,
          createdBy: createdBy.success ? createdBy.data : null,
        })
        tx.persist(baseline)
        return { baseline, duplicate: false }
      })
    } catch (error) {
      if (!frozen.contentHash || !isUniqueViolation(error)) throw error
      const winner = await findProjectBaselineByHash(resolveDeliveryEm(ctx), projectId, frozen.contentHash, scope)
      if (!winner) throw error
      outcome = { baseline: winner, duplicate: true }
    }

    if (!outcome.duplicate) {
      await emitCrudSideEffects({
        dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
        action: 'created',
        entity: outcome.baseline,
        identifiers: { id: outcome.baseline.id, organizationId: scope.organizationId, tenantId: scope.tenantId },
        indexer: baselineCrudIndexer,
      })
    }
    return toResult(outcome.baseline, outcome.duplicate, frozen.openCommentIds)
  },
  buildLog: async ({ result, ctx }) => {
    if (result.duplicate) return null
    const scope = resolveDeliveryScope(ctx)
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('delivery_os.audit.baselines.create', 'Create delivery baseline'),
      resourceKind: DELIVERY_BASELINE_RESOURCE_KIND,
      resourceId: result.baselineId,
      parentResourceKind: DELIVERY_PROJECT_RESOURCE_KIND,
      parentResourceId: result.projectId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      snapshotAfter: { id: result.baselineId, projectId: result.projectId, version: result.version, contentHash: result.contentHash, source: 'manual' },
    }
  },
}

registerCommand(createBaselineCommand)
