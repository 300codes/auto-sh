import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { asValue, type AwilixContainer } from 'awilix'
import { z } from 'zod'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { validateCrudMutationGuard, runCrudMutationGuardAfterSuccess } from '@open-mercato/shared/lib/crud/mutation-guard'
import { reportError } from '@open-mercato/telemetry'
import { WorkflowDefinition, WorkflowInstance } from '../data/entities'
import type * as WorkflowExecutor from './workflow-executor'
import { updateWorkflowDefinitionInputCheckedSchema, workflowIoContractSchema } from '../data/validators'
import { findSubWorkflowCallers } from './caller-graph'
import { authorizeWorkflowGrantChange, normalizeGrantedFeatures, syncWorkflowDefinitionPrincipal } from './definition-grant'
import { invalidateTriggerCache } from './event-trigger-service'

export const publishDefinitionInputSchema = z.object({
  acknowledgeBreakingChanges: z.boolean().optional(),
  draft: updateWorkflowDefinitionInputCheckedSchema.optional(),
})

export type PublishedDefinitionScope = { tenantId: string; organizationId: string }
export type PublishDefinitionRequest = PublishedDefinitionScope & {
  definitionId: string; userId: string; input: unknown; requestHeaders?: Headers
}

export function createPublishedDefinitionService(container: AwilixContainer) {
  return {
    async ensureInstance(scope: PublishedDefinitionScope, input: {
      workflowId: string; version: number; definitionId: string; correlationKey: string;
      initialContext: Record<string, unknown>; userId: string
    }, manager?: EntityManager) {
      if (!scope.tenantId || !scope.organizationId || !input.userId) throw new CrudHttpError(401, { error: '[internal] Authenticated scope required' })
      const em = manager ?? container.resolve<EntityManager>('em')
      return em.transactional(async (tx) => {
        await tx.getConnection().execute('select pg_advisory_xact_lock(hashtextextended(?, 0))', [`workflow-start:${scope.tenantId}:${scope.organizationId}:${input.correlationKey}`])
        const definition = await findOneWithDecryption(tx, WorkflowDefinition, { ...scope, id: input.definitionId, workflowId: input.workflowId, version: input.version, lifecycle: 'published', deletedAt: null }, undefined, scope)
        if (!definition) throw new CrudHttpError(404, { error: '[internal] Pinned definition not found' })
        const existing = await findOneWithDecryption(tx, WorkflowInstance, { ...scope, correlationKey: input.correlationKey, deletedAt: null }, undefined, scope)
        if (existing) {
          if (existing.definitionId !== definition.id || existing.version !== input.version) throw new CrudHttpError(409, { error: '[internal] Workflow instance binding changed' })
          return { instanceId: existing.id, definitionId: existing.definitionId, created: false }
        }
        const executor = container.resolve<typeof WorkflowExecutor>('workflowExecutor')
        const instance = await executor.startWorkflow(tx, { ...scope, workflowId: input.workflowId, version: input.version,
          correlationKey: input.correlationKey, initialContext: input.initialContext, metadata: { initiatedBy: input.userId } })
        const transactionContainer = container.createScope()
        transactionContainer.register('em', asValue(tx))
        await executor.executeWorkflow(tx, transactionContainer, instance.id, { userId: input.userId })
        return { instanceId: instance.id, definitionId: instance.definitionId, created: true }
      })
    },
    async getExactPublished(scope: PublishedDefinitionScope, workflowId: string, version: number) {
      if (!scope.tenantId || !scope.organizationId || !Number.isSafeInteger(version) || version < 1) return null
      const em = container.resolve<EntityManager>('em')
      return findOneWithDecryption(em, WorkflowDefinition, {
        ...scope, workflowId, version, lifecycle: 'published', deletedAt: null,
      }, undefined, scope)
    },
    async publish(request: PublishDefinitionRequest) {
      const { tenantId, organizationId, userId, definitionId } = request
      if (!userId || !tenantId || !organizationId) throw new CrudHttpError(401, { error: '[internal] Authenticated scope required' })
      const parsed = publishDefinitionInputSchema.safeParse(request.input)
      if (!parsed.success) throw new CrudHttpError(400, { error: '[internal] Invalid publication input', details: parsed.error.issues })
      const rbac = container.resolve<Parameters<typeof authorizeWorkflowGrantChange>[0]>('rbacService')
      const features = ['workflows.definitions.publish', ...(parsed.data.draft ? ['workflows.definitions.edit'] : [])]
      if (!await rbac.userHasAllFeatures(userId, features, { tenantId, organizationId })) throw new CrudHttpError(403, { error: '[internal] Publication denied' })
      const guardInput = { tenantId, organizationId, userId, resourceKind: 'workflows.definition', resourceId: definitionId,
        operation: 'custom' as const, requestMethod: 'POST', requestHeaders: request.requestHeaders ?? new Headers() }
      const guard = await validateCrudMutationGuard(container, guardInput)
      if (guard && !guard.ok) throw new CrudHttpError(guard.status, guard.body)
      const em = container.resolve<EntityManager>('em')
      const result = await em.transactional(async (tx) => {
        const probe = await findOneWithDecryption(tx, WorkflowDefinition, { id: definitionId, tenantId, organizationId, deletedAt: null }, undefined, { tenantId, organizationId })
        if (!probe) throw new CrudHttpError(404, { error: '[internal] Definition not found' })
        await tx.getConnection().execute('select pg_advisory_xact_lock(hashtextextended(?, 0))', [`workflow-publish:${tenantId}:${probe.workflowId}`])
        const source = await findOneWithDecryption(tx, WorkflowDefinition, { id: definitionId, tenantId, organizationId, deletedAt: null }, { refresh: true }, { tenantId, organizationId })
        if (!source) throw new CrudHttpError(404, { error: '[internal] Definition not found' })
        const draft = parsed.data.draft
        const definition = draft?.definition ?? source.definition
        const metadata = draft?.metadata === undefined ? source.metadata : draft.metadata
        if (source.metadata?.immutablePolicy === 'delivery' && metadata?.immutablePolicy !== 'delivery') throw new CrudHttpError(409, { error: '[internal] Delivery immutable policy cannot be removed' })
        const validation = updateWorkflowDefinitionInputCheckedSchema.safeParse({ definition, kind: source.kind, metadata })
        if (!validation.success) throw new CrudHttpError(400, { error: '[internal] Invalid definition', details: validation.error.issues })
        const ports = workflowIoContractSchema.parse(definition.io ?? {})
        const breakingChanges = await findSubWorkflowCallers(tx, { subWorkflowId: source.workflowId, tenantId, organizationId, ports })
        if (breakingChanges.length && !parsed.data.acknowledgeBreakingChanges) throw new CrudHttpError(409, { error: '[internal] Publishing would break existing mappings', breakingChanges })
        const grant = normalizeGrantedFeatures(draft?.grantedFeatures === undefined ? source.grantedFeatures : draft.grantedFeatures)
        const failure = await authorizeWorkflowGrantChange(rbac, { userId, scope: { tenantId, organizationId }, requested: grant, current: [] })
        if (failure) throw new CrudHttpError(failure.status, failure.body)
        const latest = await findOneWithDecryption(tx, WorkflowDefinition, { workflowId: source.workflowId, tenantId }, { orderBy: { version: 'DESC' } }, { tenantId, organizationId })
        const published = tx.create(WorkflowDefinition, {
          id: randomUUID(), workflowId: source.workflowId, codeWorkflowId: source.codeWorkflowId ?? null,
          workflowName: draft?.workflowName ?? source.workflowName,
          description: draft?.description === undefined ? source.description : draft.description,
          version: (latest?.version ?? source.version) + 1,
          definition: structuredClone(definition), metadata: structuredClone(metadata ?? null),
          enabled: true, kind: source.kind, lifecycle: 'published', grantedFeatures: grant.length ? grant : null,
          tenantId, organizationId, createdBy: userId, updatedBy: userId, createdAt: new Date(), updatedAt: new Date(),
        })
        const transactionContainer = container.createScope()
        transactionContainer.register('em', asValue(tx))
        await syncWorkflowDefinitionPrincipal(transactionContainer, published)
        tx.persist(published)
        await tx.flush()
        return { published, breakingChanges }
      })
      invalidateTriggerCache(tenantId, organizationId)
      if (guard?.shouldRunAfterSuccess) await runCrudMutationGuardAfterSuccess(container, { ...guardInput, resourceId: result.published.id, metadata: guard.metadata })
      try {
        const eventBus = container.resolve<{ emitEvent(event: string, payload: unknown, options: unknown): Promise<void> }>('eventBus')
        await eventBus.emitEvent('workflows.definition.published', {
          id: result.published.id, workflowId: result.published.workflowId, version: result.published.version,
          tenantId, organizationId, userId,
        }, { tenantId, organizationId, persistent: true })
      } catch (error) { reportError(error, { module: 'workflows', code: 'workflows.publication_event_failed' }) }
      return result
    },
  }
}

export type PublishedDefinitionService = ReturnType<typeof createPublishedDefinitionService>
