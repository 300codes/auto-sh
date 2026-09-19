import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { DeliveryEvidence } from '../data/entities'
import { buildDeliveryError, sha256Schema, uuidSchema } from '../lib/contracts'
import { evidenceDetailResponseSchema, evidenceListResponseSchema, evidenceReadItemSchema, evidenceSafePayloadSchema, evidenceAttachmentUrl, type EvidenceListQuery } from '../lib/evidenceReadContracts'
import { deliveryHttpError, requireScopedProject, type DeliveryScope } from './shared'
import { findProjectBaseline } from './tasks'
import { parseRevisionRef } from './reportQueries'

function notFound() { return deliveryHttpError(buildDeliveryError('not_found', 'Not found', [])) }
export async function requireScopedEvidence(em: EntityManager, scope: DeliveryScope, projectId: string, evidenceId: string) {
  await requireScopedProject(em, projectId, scope)
  const row = await findOneWithDecryption(em, DeliveryEvidence, { id: evidenceId, projectId, ...scope }, undefined, scope)
  if (!row) throw notFound()
  return row
}
function item(row: DeliveryEvidence) {
  return evidenceReadItemSchema.parse({ ...row, taskId: row.taskId ?? null, attemptId: row.attemptId ?? null,
    sourceRevision: row.sourceRevision ?? null, rawReportHash: row.rawReportHash ?? null, createdAt: row.createdAt.toISOString() })
}
export function safeEvidencePayload(row: Pick<DeliveryEvidence, 'kind' | 'payload'>) {
  const payload = row.payload
  const candidate: Record<string, unknown> = {}
  const keys = row.kind === 'review' ? ['verdict'] : row.kind === 'scan' ? ['status', 'summary'] : row.kind === 'deployment' ? ['uploadStatus', 'verificationStatus'] : row.kind === 'screenshot' ? ['viewport', 'capturedAt', 'sha256'] : []
  for (const key of keys) if (payload[key] !== undefined) candidate[key] = payload[key]
  const result = typeof payload.result === 'object' && payload.result !== null ? payload.result as Record<string, unknown> : payload
  const checks = row.kind === 'test' ? payload.checks : row.kind === 'result_manifest' ? result.checks : null
  if (Array.isArray(checks)) candidate.checks = checks.slice(0, 1000).map((value: unknown) => {
    const check = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
    return { status: check.status, rawReportHash: sha256Schema.safeParse(check.rawReportHash).success ? check.rawReportHash : null }
  })
  const safe: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(candidate)) {
    const parsed = evidenceSafePayloadSchema.safeParse({ [key]: value })
    if (parsed.success) Object.assign(safe, parsed.data)
  }
  return evidenceSafePayloadSchema.parse(safe)
}
export function createDeliveryOsEvidenceQueries(rootEm: EntityManager) {
  return {
    async list(scope: DeliveryScope, projectId: string, query: EvidenceListQuery) {
      const em = rootEm.fork()
      await requireScopedProject(em, projectId, scope)
      if (!await findProjectBaseline(em, query.baselineId, projectId, scope)) throw notFound()
      const revision = query.group === 'revision' ? parseRevisionRef(query.revision ?? '') : null
      if (query.group === 'revision' && !revision) throw deliveryHttpError(buildDeliveryError('invalid_revision', 'Invalid revision', []))
      const rows = await findWithDecryption(em, DeliveryEvidence, { ...scope, projectId, baselineId: query.baselineId, sourceRevision: revision }, { orderBy: { createdAt: 'asc', id: 'asc' }, limit: query.limit + 1, offset: query.offset }, scope)
      return evidenceListResponseSchema.parse({ schemaVersion: 'delivery-evidence-read.v1', group: query.group, items: rows.slice(0, query.limit).map(item), nextOffset: rows.length > query.limit ? query.offset + query.limit : null })
    },
    async detail(scope: DeliveryScope, projectId: string, evidenceId: string) {
      const row = await requireScopedEvidence(rootEm.fork(), scope, projectId, evidenceId)
      const attachmentIds = [...new Set(row.attachmentIds)].filter((id) => uuidSchema.safeParse(id).success)
      return evidenceDetailResponseSchema.parse({ ...item(row), schemaVersion: 'delivery-evidence-read.v1', payload: safeEvidencePayload(row),
        attachments: attachmentIds.slice(0, 100).map((id) => { const url = evidenceAttachmentUrl(projectId, evidenceId, id); return { id, downloadUrl: `${url}?download=1`, previewUrl: row.kind === 'screenshot' && row.payload.attachmentId === id ? url : null } }), attachmentsTruncated: attachmentIds.length > 100 })
    },
  }
}
export type DeliveryOsEvidenceQueries = ReturnType<typeof createDeliveryOsEvidenceQueries>
