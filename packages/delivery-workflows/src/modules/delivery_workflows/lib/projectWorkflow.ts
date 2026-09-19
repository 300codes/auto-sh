import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { PublishedDefinitionScope, PublishedDefinitionService } from '@open-mercato/core/modules/workflows/lib/published-definition-service'
import { DeliveryWorkflowSettings, DeliveryWorkflowProjectBinding } from '../data/entities'
import { mapDeliveryWorkflow } from './templateMapper'

export function createDeliveryProjectWorkflowService(container: AwilixContainer) {
  return {
    async initialize(scope: PublishedDefinitionScope, projectId: string, userId: string, em: EntityManager, selection?: { workflowId: string; version: number }) {
      return em.transactional(async (tx) => {
        await tx.getConnection().execute('select pg_advisory_xact_lock(hashtextextended(?, 0))', [`delivery-project-workflow:${scope.tenantId}:${scope.organizationId}:${projectId}`])
        const existing = await findOneWithDecryption(tx, DeliveryWorkflowProjectBinding, { ...scope, projectId }, undefined, scope)
        if (existing && selection && (existing.workflowId !== selection.workflowId || existing.version !== selection.version)) throw new CrudHttpError(409, { error: '[internal] Project workflow binding cannot be changed' })
        const service = container.resolve<PublishedDefinitionService>('workflowPublishedDefinitionService')
        const selected = selection && !existing ? await service.getExactPublished(scope, selection.workflowId, selection.version) : null
        if (selection && !existing && !selected) return null
        const mappedSelection = selected ? mapDeliveryWorkflow(selected) : null
        const setting = existing ?? (selected && mappedSelection ? {
          workflowId: selected.workflowId, version: selected.version, definitionId: selected.id,
          definitionHash: mappedSelection.definitionHash, templateHash: mappedSelection.hash,
        } : await findOneWithDecryption(tx, DeliveryWorkflowSettings, scope, undefined, scope))
        if (!setting) return null
        const definition = await service.getExactPublished(scope, setting.workflowId, setting.version)
        if (!definition) throw new CrudHttpError(409, { error: '[internal] Pinned workflow version unavailable' })
        const mapped = mapDeliveryWorkflow(definition)
        if (mapped.definitionId !== setting.definitionId || mapped.definitionHash !== setting.definitionHash || mapped.hash !== setting.templateHash) throw new CrudHttpError(409, { error: '[internal] Pinned workflow semantics changed' })
        const binding = existing ?? tx.create(DeliveryWorkflowProjectBinding, { ...scope, projectId, workflowId: definition.workflowId,
          version: definition.version, definitionId: definition.id, definitionHash: mapped.definitionHash, templateHash: mapped.hash })
        const instance = await service.ensureInstance(scope, { workflowId: definition.workflowId, version: definition.version, definitionId: definition.id,
          correlationKey: `delivery-project:${projectId}`, initialContext: { deliveryProjectId: projectId, deliveryDefinitionHash: mapped.definitionHash }, userId }, tx)
        if (binding.workflowInstanceId && binding.workflowInstanceId !== instance.instanceId) throw new CrudHttpError(409, { error: '[internal] Project instance changed' })
        binding.workflowInstanceId = instance.instanceId
        tx.persist(binding)
        await tx.flush()
        return { template: mapped.template, hash: mapped.hash, definitionId: definition.id, workflowInstanceId: instance.instanceId }
      })
    },
  }
}
