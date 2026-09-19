import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { DeliveryDesignImportSession, DeliveryProject } from '../data/entities'
import { DESIGN_IMPORT_SCHEMA_VERSION } from '../lib/designImportContracts'
import { buildDeliveryError } from '../lib/contracts'
import { serializeDesignImport } from './designImportSessions'
import { deliveryHttpError, type DeliveryScope } from './shared'

export function createDeliveryOsDesignImportQueries(rootEm: EntityManager) {
  async function scopedEm(scope: DeliveryScope, projectId: string) {
    if (!scope.tenantId || !scope.organizationId) throw new Error('[internal] Design imports require scope')
    const em = rootEm.fork()
    const project = await findOneWithDecryption(em, DeliveryProject, { id: projectId, ...scope }, undefined, scope)
    if (!project) throw deliveryHttpError(buildDeliveryError('not_found', 'Project not found', []))
    return em
  }
  return {
    async list(scope: DeliveryScope, projectId: string, offset = 0) {
      const em = await scopedEm(scope, projectId)
      const rows = await findWithDecryption(em, DeliveryDesignImportSession, { projectId, ...scope }, { orderBy: { createdAt: 'DESC', id: 'DESC' }, limit: 20, offset }, scope)
      return { schemaVersion: DESIGN_IMPORT_SCHEMA_VERSION, items: rows.map(serializeDesignImport) }
    },
    async read(scope: DeliveryScope, projectId: string, sessionId: string) {
      const em = await scopedEm(scope, projectId)
      const row = await findOneWithDecryption(em, DeliveryDesignImportSession, { id: sessionId, projectId, ...scope }, undefined, scope)
      if (!row) throw deliveryHttpError(buildDeliveryError('not_found', 'Design import not found', []))
      return serializeDesignImport(row)
    },
  }
}
export type DeliveryOsDesignImportQueries = ReturnType<typeof createDeliveryOsDesignImportQueries>
