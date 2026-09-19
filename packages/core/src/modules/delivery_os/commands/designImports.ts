import { randomUUID } from 'node:crypto'
import { LockMode } from '@mikro-orm/core'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import { DeliveryDesignImportSession } from '../data/entities'
import { designImportCreateCommandSchema, designImportUpdateCommandSchema, draftSpecV1Schema } from '../data/validators'
import { buildDeliveryError } from '../lib/contracts'
import { designImportScreenKey, designImportScreenIdentity, type DesignImportSession } from '../lib/designImportContracts'
import { checkDesignReview } from '../lib/designReview'
import { hashCanonical } from '../lib/hash'
import { verifyAttachmentReferences } from './attachments'
import { serializeDesignImport } from './designImportSessions'
import { assertDeliveryCheck, deliveryHttpError, lockProjectForWrite, lockScopedProject, parseDeliveryInput, requireLockHeader, resolveDeliveryEm, resolveDeliveryScope } from './shared'

export const DESIGN_IMPORT_RESOURCE_KIND = 'delivery_os.design_import_session'
function invalidImport(path: string, code: string): never {
  throw deliveryHttpError(buildDeliveryError('validation_failed', 'Invalid design import', [{ path, code }]))
}
const create: CommandHandler<unknown, DesignImportSession> = {
  id: 'delivery_os.design_imports.create',
  async execute(input, ctx) {
    const parsed = parseDeliveryInput(designImportCreateCommandSchema, input)
    const scope = resolveDeliveryScope(ctx)
    const manifestHash = hashCanonical(parsed.manifest)
    requireLockHeader(ctx)
    return resolveDeliveryEm(ctx).transactional(async (tx) => {
      const project = await lockScopedProject(tx, parsed.projectId, scope)
      const existing = await findOneWithDecryption(tx, DeliveryDesignImportSession, { projectId: project.id, manifestHash, ...scope }, undefined, scope)
      if (existing) return serializeDesignImport(existing)
      await lockProjectForWrite(tx, ctx, project.id, scope)
      const now = new Date(Math.max(Date.now(), project.updatedAt.getTime() + 1))
      const row = tx.create(DeliveryDesignImportSession, {
        id: randomUUID(), ...scope, projectId: project.id, manifestHash, manifest: parsed.manifest,
        progress: { screens: parsed.manifest.screens.map((screen) => ({ key: designImportScreenKey(screen), screen: null, errorCode: null })), selectedKeys: [] },
        status: 'partial', createdAt: now, updatedAt: now,
      })
      tx.persist(row)
      project.draftSpec = { ...project.draftSpec, designImportSessionId: row.id, manifestHash }
      project.updatedAt = now
      return serializeDesignImport(row)
    })
  },
  buildLog: async ({ result, ctx }) => ({
    actionLabel: (await resolveTranslations()).translate('delivery_os.audit.designImport.create', 'Start design import'),
    resourceKind: DESIGN_IMPORT_RESOURCE_KIND, resourceId: result.id, ...resolveDeliveryScope(ctx),
    snapshotAfter: { projectId: result.projectId, manifestHash: result.manifestHash, status: result.status },
  }),
}
const update: CommandHandler<unknown, DesignImportSession> = {
  id: 'delivery_os.design_imports.update',
  async execute(input, ctx) {
    const parsed = parseDeliveryInput(designImportUpdateCommandSchema, input)
    const scope = resolveDeliveryScope(ctx)
    requireLockHeader(ctx)
    return resolveDeliveryEm(ctx).transactional(async (tx) => {
      const project = await lockScopedProject(tx, parsed.projectId, scope)
      const row = await findOneWithDecryption(tx, DeliveryDesignImportSession, { id: parsed.sessionId, projectId: project.id, ...scope }, { lockMode: LockMode.PESSIMISTIC_WRITE }, scope)
      if (!row) throw deliveryHttpError(buildDeliveryError('not_found', 'Design import not found', []))
      const stored = serializeDesignImport(row)
      if (row.status === 'complete' && parsed.action === 'complete' && parsed.renders.length === 0) return stored
      await enforceCommandOptimisticLockWithGuards(ctx.container, { resourceKind: DESIGN_IMPORT_RESOURCE_KIND, resourceId: row.id, current: row.updatedAt, request: ctx.request ?? null })
      if (row.status !== 'partial') invalidImport('status', 'design_import_closed')
      if (project.draftSpec?.designImportSessionId !== row.id || project.draftSpec?.manifestHash !== row.manifestHash) invalidImport('sessionId', 'design_import_superseded')
      const expected = new Map(stored.manifest.screens.map((screen) => [designImportScreenKey(screen), screen]))
      if (new Set(parsed.renders.map((render) => render.key)).size !== parsed.renders.length) invalidImport('renders', 'duplicate_screen')
      const progress = stored.progress
      for (const render of parsed.renders) {
        const screen = expected.get(render.key)
        const entry = progress.screens.find((item) => item.key === render.key)
        if (!screen || !entry) invalidImport('renders', 'unknown_screen')
        const attachment = await findOneWithDecryption(tx, Attachment, { id: render.attachmentId, ...scope, entityId: 'delivery_os:project', recordId: project.id }, undefined, scope)
        if (!attachment) {
          entry.errorCode = 'attachment_scope_mismatch'
          continue
        }
        const verified = await verifyAttachmentReferences(tx, ctx, [{ path: 'renders', role: 'screen', attachmentId: render.attachmentId, declared: { sha256: screen.sha256, sizeBytes: screen.sizeBytes, mimeType: screen.mimeType } }], scope)
        if (!verified.ok) {
          entry.errorCode = verified.body.code
          continue
        }
        entry.screen = { ...screen, attachmentId: render.attachmentId, ...verified.snapshots.get(render.attachmentId) }
        entry.errorCode = null
      }
      if (parsed.selectedKeys) {
        if (new Set(parsed.selectedKeys).size !== parsed.selectedKeys.length || parsed.selectedKeys.some((key) => !expected.has(key))) invalidImport('selectedKeys', 'invalid_screen_selection')
        progress.selectedKeys = parsed.selectedKeys
      }
      if (parsed.action === 'cancel') row.status = 'cancelled'
      if (parsed.action === 'complete') {
        if (progress.screens.some((entry) => entry.screen === null || entry.errorCode !== null)) {
          row.progress = progress
          row.updatedAt = new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1))
          return serializeDesignImport(row)
        }
        const selected = progress.screens.filter((entry) => progress.selectedKeys.includes(entry.key)).map((entry) => entry.screen!)
        const identities = new Set(stored.manifest.screens.map(designImportScreenIdentity))
        if (selected.length !== identities.size || new Set(selected.map(designImportScreenIdentity)).size !== identities.size) invalidImport('selectedKeys', 'select_one_version_per_screen')
        const attachmentIds = selected.map((screen) => screen.attachmentId)
        const attached = await findWithDecryption(tx, Attachment, { id: { $in: attachmentIds }, ...scope, entityId: 'delivery_os:project', recordId: project.id }, undefined, scope)
        if (new Set(attached.map((item) => item.id)).size !== new Set(attachmentIds).size) invalidImport('renders', 'attachment_scope_mismatch')
        assertDeliveryCheck(await verifyAttachmentReferences(tx, ctx, selected.map((screen) => ({ path: 'renders', role: 'screen', attachmentId: screen.attachmentId, declared: screen })), scope))
        const draft = draftSpecV1Schema.parse(project.draftSpec ?? {})
        draft.screens = [...draft.screens.filter((screen) => screen.fileKey === null || screen.nodeId === null || !identities.has(designImportScreenIdentity({ ...screen, fileKey: screen.fileKey, nodeId: screen.nodeId }))), ...selected]
        draft.tokens = { ...draft.tokens, ...stored.manifest.tokens }
        assertDeliveryCheck(checkDesignReview(draft))
        project.draftSpec = draft
        project.updatedAt = new Date(Math.max(Date.now(), project.updatedAt.getTime() + 1))
        row.status = 'complete'
      }
      row.progress = progress
      row.updatedAt = new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1))
      return serializeDesignImport(row)
    })
  },
  buildLog: async ({ result, ctx }) => ({
    actionLabel: (await resolveTranslations()).translate('delivery_os.audit.designImport.update', 'Update design import'),
    resourceKind: DESIGN_IMPORT_RESOURCE_KIND, resourceId: result.id, ...resolveDeliveryScope(ctx),
    snapshotAfter: { projectId: result.projectId, manifestHash: result.manifestHash, status: result.status, completedScreens: result.progress.screens.filter((screen) => screen.screen !== null && screen.errorCode === null).length },
  }),
}
registerCommand(create)
registerCommand(update)
