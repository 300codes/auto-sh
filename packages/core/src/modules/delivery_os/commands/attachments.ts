import { createHash } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import {
  buildDeliveryError,
  type AttachmentRef,
  type DeliveryCheckResult,
  type DeliveryErrorResult,
  type ResultManifestV1,
  type ScreenRef,
} from '../lib/contracts'
import {
  MAX_BASELINE_TOTAL_ATTACHMENT_BYTES,
  attachmentScopeIssue,
  attachmentUnreadableIssue,
  buildAttachmentVerificationError,
  checkAttachmentBytes,
  checkAttachmentRecord,
  checkTotalAttachmentBytes,
  collectAttachmentReferences,
  detectMimeType,
  normalizeMimeType,
  type AttachmentByteFacts,
  type AttachmentIssue,
  type AttachmentReference,
  type AttachmentSnapshot,
} from '../lib/designReview'
import { collectArtifactReferences } from '../lib/resultAcceptance'
import type { DeliveryScope } from './shared'

const logger = createLogger('delivery_os')

export const DELIVERY_ATTACHMENT_INSPECTOR_KEY = 'deliveryOsAttachmentInspector'

export type StoredAttachmentLocation = { id: string; partitionCode: string; storagePath: string }

export type DeliveryAttachmentInspector = (
  attachment: StoredAttachmentLocation,
  scope: DeliveryScope,
) => Promise<AttachmentByteFacts>

type StorageDriverLike = { read(partitionCode: string, storagePath: string): Promise<{ buffer: Uint8Array }> }

export type StorageDriverFactoryLike = {
  resolveForPartition(partitionCode: string, scope?: { tenantId: string; organizationId: string }): Promise<StorageDriverLike>
}

export type DraftAttachmentVerification =
  | { ok: true; attachmentIds: string[]; snapshots: Map<string, AttachmentSnapshot> }
  | ({ ok: false } & DeliveryErrorResult)

export type ResultArtifactVerification = { ok: true; attachmentIds: string[] } | ({ ok: false } & DeliveryErrorResult)

export function createDeliveryAttachmentInspector(resolveFactory: () => StorageDriverFactoryLike): DeliveryAttachmentInspector {
  return async (attachment, scope) => {
    const driver = await resolveFactory().resolveForPartition(attachment.partitionCode, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    const { buffer } = await driver.read(attachment.partitionCode, attachment.storagePath)
    return {
      sha256: createHash('sha256').update(buffer).digest('hex'),
      sizeBytes: buffer.byteLength,
      detectedMimeType: detectMimeType(buffer),
    }
  }
}

async function inspectOrNull(
  inspect: DeliveryAttachmentInspector,
  attachment: StoredAttachmentLocation,
  scope: DeliveryScope,
): Promise<AttachmentByteFacts | null> {
  try {
    return await inspect(attachment, scope)
  } catch (error) {
    logger.warn('Stored attachment could not be read for verification', { attachmentId: attachment.id, err: error })
    getTelemetryRuntime()?.reportError(error, { module: 'delivery_os', code: 'delivery_os.attachment_unreadable' })
    return null
  }
}

export async function verifyAttachmentReferences(
  tx: EntityManager,
  ctx: CommandRuntimeContext,
  references: readonly AttachmentReference[],
  scope: DeliveryScope,
): Promise<DraftAttachmentVerification> {
  const attachmentIds = [...new Set(references.map((reference) => reference.attachmentId))]
  if (attachmentIds.length === 0) return { ok: true, attachmentIds, snapshots: new Map() }

  const found = await findWithDecryption(
    tx,
    Attachment,
    { id: { $in: attachmentIds }, tenantId: scope.tenantId, organizationId: scope.organizationId },
    undefined,
    scope,
  )
  const recordsById = new Map(found.map((attachment) => [attachment.id, attachment]))
  const totalCheck = checkTotalAttachmentBytes(found.map((attachment) => attachment.fileSize ?? 0))
  if (!totalCheck.ok) return totalCheck
  const inspect = ctx.container.resolve(DELIVERY_ATTACHMENT_INSPECTOR_KEY) as DeliveryAttachmentInspector
  const inspections = new Map<string, AttachmentByteFacts | null>()
  const snapshots = new Map<string, AttachmentSnapshot>()
  const issues: AttachmentIssue[] = []

  for (const reference of references) {
    const record = recordsById.get(reference.attachmentId)
    if (!record) {
      issues.push(attachmentScopeIssue(reference))
      continue
    }
    const recordFacts = { mimeType: record.mimeType ?? '', sizeBytes: record.fileSize ?? 0 }
    const recordIssues = checkAttachmentRecord(reference, recordFacts)
    issues.push(...recordIssues)
    if (recordIssues.length > 0) continue
    if (!inspections.has(record.id)) inspections.set(record.id, await inspectOrNull(inspect, record, scope))
    const bytes = inspections.get(record.id) ?? null
    if (bytes === null) {
      issues.push(attachmentUnreadableIssue(reference))
      continue
    }
    issues.push(...checkAttachmentBytes(reference, recordFacts, bytes))
    snapshots.set(record.id, { sizeBytes: bytes.sizeBytes, mimeType: normalizeMimeType(recordFacts.mimeType) })
  }

  const verdict: DeliveryCheckResult = buildAttachmentVerificationError(issues)
  if (!verdict.ok) return verdict
  return { ok: true, attachmentIds, snapshots }
}

export function verifyDraftAttachments(
  tx: EntityManager,
  ctx: CommandRuntimeContext,
  draft: { screens: readonly ScreenRef[]; attachments: readonly AttachmentRef[] },
  scope: DeliveryScope,
): Promise<DraftAttachmentVerification> {
  return verifyAttachmentReferences(tx, ctx, collectAttachmentReferences(draft), scope)
}

export async function verifyResultArtifacts(
  tx: EntityManager,
  ctx: CommandRuntimeContext,
  artifacts: ResultManifestV1['artifacts'],
  scope: DeliveryScope,
): Promise<ResultArtifactVerification> {
  const verified = await verifyAttachmentReferences(tx, ctx, collectArtifactReferences(artifacts), scope)
  if (verified.ok) return { ok: true, attachmentIds: verified.attachmentIds }
  if (verified.body.code === 'payload_too_large') {
    return {
      ok: false,
      ...buildDeliveryError('payload_too_large', 'The stored artifacts are too large together', [
        { path: 'artifacts', code: 'artifacts_total_too_large', message: `All stored artifacts together may have at most ${MAX_BASELINE_TOTAL_ATTACHMENT_BYTES} bytes` },
      ]),
    }
  }
  if (verified.body.code !== 'attachment_scope_mismatch') return verified
  return {
    ok: false,
    ...buildDeliveryError('foreign_reference', 'An artifact points at a file that is not available in this organization', verified.body.details),
  }
}
