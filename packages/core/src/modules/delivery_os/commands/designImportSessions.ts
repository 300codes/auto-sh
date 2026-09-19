import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { DeliveryDesignImportSession, type DeliveryProject } from '../data/entities'
import { buildDeliveryError } from '../lib/contracts'
import { designImportSessionSchema, DESIGN_IMPORT_SCHEMA_VERSION, type DesignImportSession } from '../lib/designImportContracts'
import { deliveryHttpError, type DeliveryScope } from './shared'

export function serializeDesignImport(row: DeliveryDesignImportSession): DesignImportSession {
  return designImportSessionSchema.parse({
    schemaVersion: DESIGN_IMPORT_SCHEMA_VERSION,
    id: row.id,
    projectId: row.projectId,
    manifestHash: row.manifestHash,
    manifest: row.manifest,
    progress: row.progress,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  })
}
export async function assertDraftImportComplete(tx: EntityManager, project: DeliveryProject, scope: DeliveryScope): Promise<void> {
  const draft = project.draftSpec
  if (!draft || (!draft.designImportSessionId && !draft.manifestHash)) return
  const session = typeof draft.designImportSessionId === 'string'
    ? await findOneWithDecryption(tx, DeliveryDesignImportSession, { id: draft.designImportSessionId, projectId: project.id, ...scope }, undefined, scope)
    : null
  if (!session || session.status !== 'complete' || session.manifestHash !== draft.manifestHash) {
    throw deliveryHttpError(buildDeliveryError('missing_render', 'Complete the design import before freezing this draft', [{ path: 'draftSpec.designImportSessionId', code: 'design_import_incomplete' }]))
  }
}
