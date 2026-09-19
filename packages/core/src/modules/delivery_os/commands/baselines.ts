import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { E } from '#generated/entities.ids.generated'
import { DeliveryBaseline, DeliveryProject } from '../data/entities'
import { baselineCreateSchema, draftSpecV1Schema } from '../data/validators'
import { buildBaselineContent, nextBaselineVersion, type BaselineBuildExtras } from '../lib/baseline'
import { applyAttachmentSnapshot, checkDesignReview, checkRawScreenRenders } from '../lib/designReview'
import {
  buildDeliveryError,
  deliveryErrorFromZod,
  importedManifestSchema,
  uuidSchema,
  type DeliveryCheckResult,
  type DeliveryErrorDetail,
} from '../lib/contracts'
import { parseRequirementsProposal, validateRequirementsProposal } from '../lib/proposals'
import { verifyDraftAttachments } from './attachments'
import {
  assertDeliveryCheck,
  DELIVERY_BASELINE_RESOURCE_KIND,
  DELIVERY_PROJECT_RESOURCE_KIND,
  deliveryHttpError,
  lockProjectForWrite,
  lockScopedProject,
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
  projectUpdatedAt: string
}

export type BaselineImportCommandResult = BaselineCommandResult & {
  manifestId: string
  manifestHash: string
  prunedAcIds: string[]
}

type DraftSpec = z.infer<typeof draftSpecV1Schema>

const baselineProjectSchema = z.object({ projectId: uuidSchema })

const baselineCrudIndexer: CrudIndexerConfig<DeliveryBaseline> = {
  entityType: E.delivery_os.delivery_baseline,
}

const projectCrudIndexer: CrudIndexerConfig<DeliveryProject> = {
  entityType: E.delivery_os.delivery_project,
}

const importedManifestsSchema = z.object({ importedManifests: z.array(importedManifestSchema) })

type FreezeOptions = { requireRender: boolean; extras?: BaselineBuildExtras }

type FrozenDraft = { content: DeliveryBaseline['content']; contentHash: string; openCommentIds: string[]; attachmentIds: string[] }

export function checkDraftFreezable(draft: DraftSpec, options: { requireRender: boolean } = { requireRender: true }): DeliveryCheckResult {
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
  if (options.requireRender && draft.screens.length === 0) {
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

async function freezeDraft(
  tx: EntityManager,
  ctx: CommandRuntimeContext,
  scope: DeliveryScope,
  draft: DraftSpec,
  options: FreezeOptions,
): Promise<FrozenDraft> {
  assertDeliveryCheck(checkDraftFreezable(draft, options))
  assertDeliveryCheck(checkDesignReview(draft))
  const verified = await verifyDraftAttachments(tx, ctx, draft, scope)
  if (!verified.ok) throw deliveryHttpError({ status: verified.status, body: verified.body })
  const built = buildBaselineContent(applyAttachmentSnapshot(draft, verified.snapshots), options.extras)
  if (!built.ok) throw deliveryHttpError({ status: built.status, body: built.body })
  return {
    content: built.content,
    contentHash: built.contentHash,
    openCommentIds: built.openCommentIds,
    attachmentIds: verified.attachmentIds,
  }
}

function parseProjectDraft(project: DeliveryProject): DraftSpec {
  assertDeliveryCheck(checkRawScreenRenders((project.draftSpec as { screens?: unknown } | null)?.screens))
  const draft = draftSpecV1Schema.safeParse(project.draftSpec)
  if (!draft.success) throw deliveryHttpError(deliveryErrorFromZod(draft.error))
  return draft.data
}

export function listProjectBaselines(tx: EntityManager, projectId: string, scope: DeliveryScope): Promise<DeliveryBaseline[]> {
  return findWithDecryption(
    tx,
    DeliveryBaseline,
    { projectId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    undefined,
    scope,
  )
}

export function findImportedManifest(
  baselines: readonly DeliveryBaseline[],
  manifestId: string,
): { baseline: DeliveryBaseline; manifestHash: string } | null {
  const ordered = [...baselines].sort((left, right) => left.version - right.version)
  for (const baseline of ordered) {
    const parsed = importedManifestsSchema.safeParse(baseline.content)
    const entry = parsed.success ? parsed.data.importedManifests.find((candidate) => candidate.manifestId === manifestId) : undefined
    if (entry) return { baseline, manifestHash: entry.manifestHash }
  }
  return null
}

function toResult(
  baseline: DeliveryBaseline,
  duplicate: boolean,
  openCommentIds: string[],
  project: DeliveryProject,
): BaselineCommandResult {
  return {
    projectUpdatedAt: project.updatedAt.toISOString(),
    baselineId: baseline.id,
    projectId: baseline.projectId,
    version: baseline.version,
    contentHash: baseline.contentHash,
    duplicate,
    openCommentIds,
  }
}

export async function emitBaselineCreated(ctx: CommandRuntimeContext, scope: DeliveryScope, baseline: DeliveryBaseline): Promise<void> {
  await emitCrudSideEffects({
    dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
    action: 'created',
    entity: baseline,
    identifiers: { id: baseline.id, organizationId: scope.organizationId, tenantId: scope.tenantId },
    indexer: baselineCrudIndexer,
  })
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
    let outcome: { baseline: DeliveryBaseline; duplicate: boolean; project: DeliveryProject }
    try {
      outcome = await em.transactional(async (tx) => {
        const project = await lockProjectForWrite(tx, ctx, projectId, scope, { force: true })
        const built = await freezeDraft(tx, ctx, scope, parseProjectDraft(project), { requireRender: true })
        frozen.contentHash = built.contentHash
        frozen.openCommentIds = built.openCommentIds

        const existing = await listProjectBaselines(tx, project.id, scope)
        const identical = existing.find((baseline) => baseline.contentHash === built.contentHash)
        if (identical) return { baseline: identical, duplicate: true, project }

        const baseline = tx.create(DeliveryBaseline, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          projectId: project.id,
          version: nextBaselineVersion(existing.map((entry) => entry.version)),
          contentHash: built.contentHash,
          source: 'manual',
          parentBaselineId: null,
          content: built.content,
          attachmentIds: built.attachmentIds,
          createdBy: createdBy.success ? createdBy.data : null,
        })
        tx.persist(baseline)
        return { baseline, duplicate: false, project }
      })
    } catch (error) {
      if (!frozen.contentHash || !isUniqueViolation(error)) throw error
      const winner = await findProjectBaselineByHash(resolveDeliveryEm(ctx), projectId, frozen.contentHash, scope)
      if (!winner) throw error
      outcome = { baseline: winner, duplicate: true, project: await requireScopedProject(resolveDeliveryEm(ctx), projectId, scope) }
    }

    if (!outcome.duplicate) await emitBaselineCreated(ctx, scope, outcome.baseline)
    return toResult(outcome.baseline, outcome.duplicate, frozen.openCommentIds, outcome.project)
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

const importRequirementsCommand: CommandHandler<unknown, BaselineImportCommandResult> = {
  id: 'delivery_os.baselines.import_requirements',
  async execute(rawInput, ctx) {
    const scope = resolveDeliveryScope(ctx)
    const { projectId } = parseDeliveryInput(baselineProjectSchema, rawInput)
    const parsed = parseDeliveryInput(baselineCreateSchema, rawInput)
    if (parsed.source !== 'requirements_proposal') {
      throw deliveryHttpError(
        buildDeliveryError('validation_failed', 'Validation failed', [{ path: 'source', code: 'unsupported_source' }]),
      )
    }
    const { manifest } = parsed
    const createdBy = uuidSchema.safeParse(ctx.auth?.sub)
    await requireScopedProject(resolveDeliveryEm(ctx), projectId, scope)
    const identity = parseRequirementsProposal(manifest, projectId)
    if (!identity.ok) throw deliveryHttpError({ status: identity.status, body: identity.body })
    const { manifestId, manifestHash } = identity

    const frozen = { contentHash: null as string | null, openCommentIds: [] as string[], prunedAcIds: [] as string[] }
    const em = resolveDeliveryEm(ctx)
    let outcome: { baseline: DeliveryBaseline; duplicate: boolean; project: DeliveryProject }
    try {
      outcome = await em.transactional(async (tx) => {
        const locked = await lockScopedProject(tx, projectId, scope)
        const existing = await listProjectBaselines(tx, locked.id, scope)
        const replay = findImportedManifest(existing, manifestId)
        if (replay && replay.manifestHash === manifestHash) return { baseline: replay.baseline, duplicate: true, project: locked }
        if (replay) {
          throw deliveryHttpError(
            buildDeliveryError('idempotency_conflict', 'This manifestId was already imported with different content', [
              { path: 'manifest.manifestId', code: 'idempotency_conflict', message: `Imported as baseline v${replay.baseline.version}` },
            ]),
          )
        }

        requireLockHeader(ctx)
        const project = await lockProjectForWrite(tx, ctx, projectId, scope, { force: true })
        const merged = validateRequirementsProposal(manifest, { projectId, draftSpec: parseProjectDraft(project) })
        if (!merged.ok) throw deliveryHttpError({ status: merged.status, body: merged.body })
        const built = await freezeDraft(tx, ctx, scope, merged.draftSpec, {
          requireRender: false,
          extras: { importedManifestHashes: [manifestHash], importedManifests: [{ manifestId, manifestHash }] },
        })
        frozen.contentHash = built.contentHash
        frozen.openCommentIds = built.openCommentIds
        frozen.prunedAcIds = merged.prunedAcIds
        const identical = existing.find((baseline) => baseline.contentHash === built.contentHash)
        if (identical) return { baseline: identical, duplicate: true, project }

        project.draftSpec = merged.draftSpec
        project.updatedAt = new Date()
        const baseline = tx.create(DeliveryBaseline, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          projectId: project.id,
          version: nextBaselineVersion(existing.map((entry) => entry.version)),
          contentHash: built.contentHash,
          source: 'requirements_proposal',
          parentBaselineId: null,
          content: built.content,
          attachmentIds: built.attachmentIds,
          createdBy: createdBy.success ? createdBy.data : null,
        })
        tx.persist(baseline)
        return { baseline, duplicate: false, project }
      })
    } catch (error) {
      if (!frozen.contentHash || !isUniqueViolation(error)) throw error
      const winner = await findProjectBaselineByHash(resolveDeliveryEm(ctx), projectId, frozen.contentHash, scope)
      if (!winner) throw error
      outcome = { baseline: winner, duplicate: true, project: await requireScopedProject(resolveDeliveryEm(ctx), projectId, scope) }
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
    }
    const openCommentIds = outcome.duplicate ? [] : frozen.openCommentIds
    const prunedAcIds = outcome.duplicate ? [] : frozen.prunedAcIds
    return { ...toResult(outcome.baseline, outcome.duplicate, openCommentIds, outcome.project), manifestId, manifestHash, prunedAcIds }
  },
  buildLog: async ({ result, ctx }) => {
    if (result.duplicate) return null
    const scope = resolveDeliveryScope(ctx)
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('delivery_os.audit.baselines.import_requirements', 'Import requirements proposal'),
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
        source: 'requirements_proposal',
        manifestId: result.manifestId,
        manifestHash: result.manifestHash,
        prunedAcIds: result.prunedAcIds,
      },
    }
  },
}

registerCommand(createBaselineCommand)
registerCommand(importRequirementsCommand)
