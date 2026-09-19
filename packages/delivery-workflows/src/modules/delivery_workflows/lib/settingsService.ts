import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import type { PublishedDefinitionScope, PublishedDefinitionService } from '@open-mercato/core/modules/workflows/lib/published-definition-service'
import { DeliveryWorkflowSettings } from '../data/entities'
import { settingsInputSchema } from '../data/validators'
import { mapDeliveryWorkflow } from './templateMapper'

export function createDeliveryWorkflowSettingsService(container: AwilixContainer) {
  const em = () => container.resolve<EntityManager>('em')
  return {
    async get(scope: PublishedDefinitionScope) {
      return findOneWithDecryption(em(), DeliveryWorkflowSettings, scope, undefined, scope)
    },
    async save(scope: PublishedDefinitionScope, value: unknown, request: Request, userId: string) {
      const parsed = settingsInputSchema.safeParse(value)
      if (!parsed.success) throw new CrudHttpError(400, { error: '[internal] Invalid process settings' })
      const rbac = container.resolve<{ userHasAllFeatures(user: string, features: string[], scope: PublishedDefinitionScope): Promise<boolean> }>('rbacService')
      if (!await rbac.userHasAllFeatures(userId, ['delivery_workflows.settings.manage'], scope)) throw new CrudHttpError(403, { error: '[internal] Process settings denied' })
      const service = container.resolve<PublishedDefinitionService>('workflowPublishedDefinitionService')
      const definition = await service.getExactPublished(scope, parsed.data.workflowId, parsed.data.version)
      if (!definition || !definition.enabled) throw new CrudHttpError(422, { error: '[internal] Published enabled process required' })
      const mapped = mapDeliveryWorkflow(definition)
      return em().transactional(async (tx) => {
        await tx.getConnection().execute('select pg_advisory_xact_lock(hashtextextended(?, 0))', [`delivery-settings:${scope.tenantId}:${scope.organizationId}`])
        const existing = await findOneWithDecryption(tx, DeliveryWorkflowSettings, scope, { refresh: true }, scope)
        if (existing) await enforceCommandOptimisticLockWithGuards(container, {
          resourceKind: 'delivery_workflows.settings', resourceId: existing.id, current: existing.updatedAt, request,
        })
        const row = existing ?? tx.create(DeliveryWorkflowSettings, { ...scope, workflowId: definition.workflowId, version: definition.version,
          definitionId: definition.id, definitionHash: mapped.definitionHash, templateHash: mapped.hash })
        Object.assign(row, { workflowId: definition.workflowId, version: definition.version, definitionId: definition.id,
          definitionHash: mapped.definitionHash, templateHash: mapped.hash, updatedAt: new Date() })
        tx.persist(row)
        await tx.flush()
        return row
      })
    },
  }
}

export function serializeSettings(row: DeliveryWorkflowSettings | null) {
  return { setting: row ? { id: row.id, workflowId: row.workflowId, version: row.version, definitionId: row.definitionId,
    definitionHash: row.definitionHash, templateHash: row.templateHash, updatedAt: row.updatedAt.toISOString(),
    studioHref: `/backend/definitions/visual-editor?id=${encodeURIComponent(row.definitionId)}` } : null }
}
