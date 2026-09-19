import type { EntityManager } from '@mikro-orm/postgresql'
import { asValue, type AwilixContainer } from 'awilix'
import { z } from 'zod'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { DeliveryOsFlowQueries } from '@open-mercato/core/modules/delivery_os/commands/flowQueries'
import type { SendSignalOptions } from '@open-mercato/core/modules/workflows/lib/signal-handler'
import type * as SignalHandler from '@open-mercato/core/modules/workflows/lib/signal-handler'
import { WorkflowInstance } from '@open-mercato/core/modules/workflows/data/entities'
import { DeliveryWorkflowProjectBinding } from '../data/entities'

const signalSchema = z.string().regex(/^delivery\.stage\.(scope|ux|key_visual|design_system_ui)\.approved$/)
export function createDeliveryStageSignals(container: AwilixContainer) {
  async function approved(options: SendSignalOptions) {
    const scope = { tenantId: options.tenantId, organizationId: options.organizationId }
    const em = container.resolve<EntityManager>('em')
    const binding = await findOneWithDecryption(em, DeliveryWorkflowProjectBinding, { ...scope, workflowInstanceId: options.instanceId }, undefined, scope)
    if (!binding || !signalSchema.safeParse(options.signalName).success) throw new CrudHttpError(409, { error: '[internal] Unbound Delivery signal' })
    const status = await container.resolve<DeliveryOsFlowQueries>('deliveryOsFlowQueries').flowStatus(binding.projectId, scope)
    const stage = status.stages.find((candidate) => options.signalName === `delivery.stage.${candidate.stageId}.approved`)
    if (!stage || stage.currency !== 'approved' || stage.latestDecision?.verdict !== 'approved' || stage.pendingApproval || stage.blockers.length) {
      throw new CrudHttpError(409, { error: '[internal] Delivery stage approval is not current' })
    }
    return stage
  }
  return {
    async validate(options: SendSignalOptions) {
      await approved(options)
      if (options.payload && Object.keys(options.payload).length) throw new CrudHttpError(409, { error: '[internal] Delivery signals cannot overwrite workflow context' })
    },
    async resume(scope: { tenantId: string; organizationId: string }, projectId: string, _stageId: string) {
      const em = container.resolve<EntityManager>('em')
      const binding = await findOneWithDecryption(em, DeliveryWorkflowProjectBinding, { ...scope, projectId }, undefined, scope)
      if (!binding?.workflowInstanceId) return
      await em.transactional(async (tx) => {
        await tx.getConnection().execute('select pg_advisory_xact_lock(hashtextextended(?, 0))', [`delivery-resume:${scope.tenantId}:${scope.organizationId}:${projectId}`])
        const transactionContainer = container.createScope()
        transactionContainer.register('em', asValue(tx))
        const guard = createDeliveryStageSignals(transactionContainer)
        for (let remaining = 4; remaining > 0; remaining -= 1) {
          const instance = await findOneWithDecryption(tx, WorkflowInstance, { ...scope, id: binding.workflowInstanceId }, { refresh: true }, scope)
          if (!instance || instance.status !== 'PAUSED') return
          const options = { ...scope, instanceId: instance.id, signalName: `delivery.stage.${instance.currentStepId}.approved` }
          try { await guard.validate(options) } catch (error) {
            if (isCrudHttpError(error) && error.status === 409) return
            throw error
          }
          await transactionContainer.resolve<typeof SignalHandler>('signalHandler').sendSignal(tx, transactionContainer, options)
        }
      })
    },
  }
}
