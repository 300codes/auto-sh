import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { z } from 'zod'
import { DeliveryStaffImportIntent } from '../data/entities'
import { hashCanonical } from '../lib/hash'
import { lockScopedProject, resolveDeliveryEm, type DeliveryScope } from './shared'

export const staffTaskIntentSchema = z.object({
  staffProjectId: z.string().uuid(),
  statusId: z.string().uuid(),
  title: z.string(),
  description: z.string(),
})
export const staffReplyIntentSchema = z.object({ body: z.string() })

export function staffImportKey(projectId: string, fileKey: string, threadKey: string, commentKey?: string): string {
  return `delivery:${hashCanonical([projectId, fileKey, threadKey, commentKey ?? null])}`
}

export async function prepareStaffImportIntents(
  ctx: CommandRuntimeContext,
  scope: DeliveryScope,
  projectId: string,
  intents: Array<{ key: string; payload: Record<string, unknown> }>,
): Promise<Map<string, DeliveryStaffImportIntent>> {
  return resolveDeliveryEm(ctx).transactional(async (tx) => {
    await lockScopedProject(tx, projectId, scope)
    const prepared = new Map<string, DeliveryStaffImportIntent>()
    for (const intent of intents) {
      const where = { ...scope, projectId, key: intent.key }
      let row = await findOneWithDecryption(tx, DeliveryStaffImportIntent, where, undefined, scope)
      if (!row) {
        row = tx.create(DeliveryStaffImportIntent, {
          ...where, payload: intent.payload, payloadHash: hashCanonical(intent.payload),
          resourceId: null, createdAt: new Date(), updatedAt: new Date(),
        })
        tx.persist(row)
      } else if (hashCanonical({ ...row.payload }) !== row.payloadHash) {
        throw new Error('[internal] Staff import intent hash mismatch')
      }
      prepared.set(intent.key, row)
    }
    await tx.flush()
    return prepared
  })
}

export async function reconcileStaffImportIntent(
  em: EntityManager,
  scope: DeliveryScope,
  projectId: string,
  key: string,
  resourceId: string,
): Promise<void> {
  const row = await findOneWithDecryption(em, DeliveryStaffImportIntent, { ...scope, projectId, key }, undefined, scope)
  if (!row || (row.resourceId && row.resourceId !== resourceId)) {
    throw new Error('[internal] Staff import intent resource mismatch')
  }
  row.resourceId = resourceId
  row.updatedAt = new Date()
}
