import {
  DESIGN_RENDER_MIME_TYPES,
  MAX_BASELINE_ATTACHMENT_BYTES,
} from '@open-mercato/core/modules/delivery_os/lib/designReview'
import type { DesignManifestV1, ScreenRef } from '@open-mercato/core/modules/delivery_os/lib/contracts'

/**
 * The client declares the sha256 and the server verifies the stored bytes
 * against that declaration when the baseline is frozen. Every failure here is
 * therefore named: an unnamed one would let a render whose bytes never matched
 * look like a generic upload problem.
 */
export type ScreenUploadFailure =
  | { ok: false; reason: 'insecure_context' }
  | { ok: false; reason: 'unsupported_type'; mimeType: string }
  | { ok: false; reason: 'too_large'; sizeBytes: number; limit: number }
  | { ok: false; reason: 'upload_failed'; status: number }
  | { ok: false; reason: 'unreadable_response' }

export type UploadedScreenRender = {
  attachmentId: string
  sha256: string
  sizeBytes: number
  mimeType: string
}

export type ScreenUploadResult = { ok: true; render: UploadedScreenRender } | ScreenUploadFailure

export type HashFileResult = { ok: true; sha256: string } | { ok: false; reason: 'insecure_context' }

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * `crypto.subtle` only exists in a secure context. Under plain http on a host
 * other than localhost it is `undefined`, and treating that as a failed digest
 * would report a broken file instead of a browser that cannot hash at all.
 */
export function isHashingAvailable(): boolean {
  return typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.subtle !== 'undefined'
}

export async function hashBytes(bytes: ArrayBuffer): Promise<HashFileResult> {
  if (!isHashingAvailable()) return { ok: false, reason: 'insecure_context' }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return { ok: true, sha256: toHex(digest) }
}

export async function hashFile(file: Blob): Promise<HashFileResult> {
  if (!isHashingAvailable()) return { ok: false, reason: 'insecure_context' }
  return hashBytes(await file.arrayBuffer())
}

/**
 * The same thresholds the server applies when it freezes the baseline, checked
 * before the bytes travel — an operator should not wait out a 10 MB upload to
 * be told the type was never acceptable.
 */
export function checkRenderFile(file: { type: string; size: number }): ScreenUploadFailure | null {
  const mimeType = file.type.toLowerCase().split(';')[0].trim()
  if (!DESIGN_RENDER_MIME_TYPES.includes(mimeType)) return { ok: false, reason: 'unsupported_type', mimeType: file.type }
  if (file.size > MAX_BASELINE_ATTACHMENT_BYTES) {
    return { ok: false, reason: 'too_large', sizeBytes: file.size, limit: MAX_BASELINE_ATTACHMENT_BYTES }
  }
  return null
}

export type AttachmentUploader = (form: FormData) => Promise<{ ok: boolean; status: number; result: unknown }>

function readAttachmentId(result: unknown): string | null {
  if (result === null || typeof result !== 'object') return null
  const item = (result as { item?: unknown }).item
  if (item === null || typeof item !== 'object') return null
  const id = (item as { id?: unknown }).id
  return typeof id === 'string' && id.length > 0 ? id : null
}

export const DELIVERY_PROJECT_ATTACHMENT_ENTITY_ID = 'delivery_os:project'

export async function uploadScreenRender(
  file: File,
  projectId: string,
  upload: AttachmentUploader,
): Promise<ScreenUploadResult> {
  const rejected = checkRenderFile(file)
  if (rejected) return rejected
  const hashed = await hashFile(file)
  if (!hashed.ok) return { ok: false, reason: 'insecure_context' }
  const form = new FormData()
  form.set('entityId', DELIVERY_PROJECT_ATTACHMENT_ENTITY_ID)
  form.set('recordId', projectId)
  form.set('file', file)
  const response = await upload(form)
  if (!response.ok) return { ok: false, reason: 'upload_failed', status: response.status }
  const attachmentId = readAttachmentId(response.result)
  if (attachmentId === null) return { ok: false, reason: 'unreadable_response' }
  return {
    ok: true,
    render: {
      attachmentId,
      sha256: hashed.sha256,
      sizeBytes: file.size,
      mimeType: file.type.toLowerCase().split(';')[0].trim(),
    },
  }
}

export type ScreenMetadataInput = {
  name: string
  fileKey: string | null
  nodeId: string | null
  viewportWidth: number
  viewportHeight: number
  figmaVersion: string | null
}

export function buildScreenRef(
  metadata: ScreenMetadataInput,
  render: UploadedScreenRender,
  capturedAt: string,
): ScreenRef {
  return {
    name: metadata.name,
    fileKey: metadata.fileKey,
    nodeId: metadata.nodeId,
    viewport: { width: metadata.viewportWidth, height: metadata.viewportHeight },
    attachmentId: render.attachmentId,
    sha256: render.sha256,
    capturedAt,
    sizeBytes: render.sizeBytes,
    mimeType: render.mimeType,
    ...(metadata.figmaVersion ? { figmaVersion: metadata.figmaVersion } : {}),
  }
}

export type ManifestScreenMapping =
  | { ok: true; metadata: ScreenMetadataInput[] }
  | { ok: false; reason: 'missing_file'; nodeIds: string[] }

/**
 * A pasted `DesignManifest v1` fills in the metadata of every screen it lists,
 * but the renders still come from disk. A manifest entry with no file is an
 * explicit error: silently dropping it would freeze a baseline missing a screen
 * the operator believed they had added.
 */
export function mapManifestScreens(
  manifest: DesignManifestV1,
  filesByNodeId: ReadonlyMap<string, File>,
): ManifestScreenMapping {
  const missing = manifest.screens.filter((screen) => !filesByNodeId.has(screen.nodeId)).map((screen) => screen.nodeId)
  if (missing.length > 0) return { ok: false, reason: 'missing_file', nodeIds: missing }
  return {
    ok: true,
    metadata: manifest.screens.map((screen) => ({
      name: screen.name,
      fileKey: screen.fileKey,
      nodeId: screen.nodeId,
      viewportWidth: screen.viewport.width,
      viewportHeight: screen.viewport.height,
      figmaVersion: screen.figmaVersion ?? null,
    })),
  }
}
