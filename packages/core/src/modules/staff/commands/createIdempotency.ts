import { createHash } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { StaffCommandIdempotency } from '../data/entities'

type CreateIdentity = {
  tenantId: string
  organizationId: string
  operation: string
  key: string
  payloadHash: string
}

export function staffCreateIdentity(
  operation: string,
  input: { tenantId: string; organizationId: string; idempotencyKey?: string },
  payload: Record<string, unknown>,
): CreateIdentity | null {
  if (!input.idempotencyKey) return null
  const serialized = JSON.stringify(payload, Object.keys(payload).sort((left, right) => left < right ? -1 : left > right ? 1 : 0))
  return {
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    operation,
    key: input.idempotencyKey,
    payloadHash: createHash('sha256').update(serialized).digest('hex'),
  }
}

export async function readStaffCreateReplay(em: EntityManager, identity: CreateIdentity | null): Promise<string | null> {
  if (!identity) return null
  if (!em.isInTransaction()) throw new Error('[internal] Staff idempotency requires an active transaction')
  const { payloadHash, ...where } = identity
  await em.getConnection().execute(
    'select pg_advisory_xact_lock(hashtextextended(?, 0))',
    [JSON.stringify([where.tenantId, where.organizationId, where.operation, where.key])],
    'all',
    em.getTransactionContext(),
  )
  const entry = await findOneWithDecryption(em, StaffCommandIdempotency, where, undefined, where)
  if (!entry) return null
  if (entry.payloadHash !== payloadHash) {
    throw new CrudHttpError(409, { code: 'idempotency_conflict', error: '[internal] Staff idempotency payload conflict' })
  }
  return entry.resourceId
}

export function recordStaffCreate(em: EntityManager, identity: CreateIdentity | null, resourceId: string): void {
  if (!identity) return
  em.persist(em.create(StaffCommandIdempotency, { ...identity, resourceId, createdAt: new Date() }))
}
