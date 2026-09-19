import {
  DELIVERY_SCHEMA_VERSIONS,
  buildDeliveryError,
  designManifestV1Schema,
  parseVersioned,
  type AttachmentRef,
  type DeliveryCheckResult,
  type DeliveryErrorCode,
  type DeliveryErrorDetail,
  type DeliveryErrorResult,
  type DesignManifestV1,
  type ScreenRef,
} from './contracts'

export const DESIGN_RENDER_MIME_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp']

export const BASELINE_ATTACHMENT_MIME_TYPES: readonly string[] = [
  ...DESIGN_RENDER_MIME_TYPES,
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/json',
]

export const MAX_BASELINE_ATTACHMENT_BYTES = 10 * 1024 * 1024

export const MAX_BASELINE_TOTAL_ATTACHMENT_BYTES = 64 * 1024 * 1024

export const MAX_DESIGN_TOKEN_DEPTH = 4

export type AttachmentRole = 'screen' | 'attachment'

export type DeclaredAttachment = { sha256: string; sizeBytes?: number; mimeType?: string }

export type AttachmentReference = {
  path: string
  role: AttachmentRole
  attachmentId: string
  declared: DeclaredAttachment
}

export type AttachmentRecordFacts = { mimeType: string; sizeBytes: number }

export type AttachmentByteFacts = { sha256: string; sizeBytes: number; detectedMimeType: string | null }

export type AttachmentSnapshot = { sizeBytes: number; mimeType: string }

export type AttachmentIssue = { code: DeliveryErrorCode; detail: DeliveryErrorDetail }

export type DesignReviewComment = {
  id: string
  screenAttachmentId: string | null
  anchor: { x: number; y: number } | null
}

export type DesignReviewInput = {
  screens: readonly ScreenRef[]
  comments?: readonly DesignReviewComment[]
  tokens?: Record<string, unknown>
}

export type DesignManifestValidation =
  | { ok: true; manifest: DesignManifestV1 }
  | ({ ok: false } & DeliveryErrorResult)

const TEMPORARY_URL_KEYS = ['url', 'imageUrl', 'renderUrl', 'screenshotUrl', 'thumbnailUrl']

const ATTACHMENT_ERROR_PRIORITY: readonly DeliveryErrorCode[] = [
  'attachment_scope_mismatch',
  'missing_render',
  'attachment_hash_mismatch',
]

const ATTACHMENT_ERROR_MESSAGES: Partial<Record<DeliveryErrorCode, string>> = {
  attachment_scope_mismatch: 'Attachment is not available in this organization',
  missing_render: 'A screen needs a stored image render',
  attachment_hash_mismatch: 'Stored attachment does not match the declared file',
}

const DESIGN_REVIEW_PRIORITY: readonly DeliveryErrorCode[] = [
  'duplicate_stable_id',
  'foreign_reference',
  'invalid_comment_anchor',
  'validation_failed',
]

const DESIGN_REVIEW_MESSAGES: Partial<Record<DeliveryErrorCode, string>> = {
  duplicate_stable_id: 'Screens must be unique',
  foreign_reference: 'A comment points at an unknown screen',
  invalid_comment_anchor: 'A comment anchor is not valid',
  validation_failed: 'Validation failed',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isHttpUrl(value: unknown): boolean {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim())
}

function carriesTemporaryUrl(screen: Record<string, unknown>): boolean {
  return TEMPORARY_URL_KEYS.some((key) => typeof screen[key] === 'string') || Object.values(screen).some(isHttpUrl)
}

function failWithPriority(
  issues: readonly AttachmentIssue[],
  priority: readonly DeliveryErrorCode[],
  messages: Partial<Record<DeliveryErrorCode, string>>,
): DeliveryCheckResult {
  if (issues.length === 0) return { ok: true }
  const top = priority.find((code) => issues.some((issue) => issue.code === code)) ?? issues[0].code
  return { ok: false, ...buildDeliveryError(top, messages[top] ?? 'Validation failed', issues.map((issue) => issue.detail)) }
}

export function normalizeMimeType(value: string): string {
  return value.split(';')[0].trim().toLowerCase()
}

export function detectMimeType(bytes: Uint8Array): string | null {
  const startsWith = (signature: readonly number[], offset = 0) =>
    bytes.length >= offset + signature.length && signature.every((byte, index) => bytes[offset + index] === byte)
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith([0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp'
  if (startsWith([0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'
  return null
}

export function checkRawScreenRenders(rawScreens: unknown): DeliveryCheckResult {
  if (!Array.isArray(rawScreens)) return { ok: true }
  const details: DeliveryErrorDetail[] = []
  rawScreens.forEach((screen, index) => {
    if (!isRecord(screen)) return
    if (typeof screen.attachmentId === 'string' && screen.attachmentId.length > 0) return
    details.push(
      carriesTemporaryUrl(screen)
        ? { path: `screens.${index}`, code: 'temporary_url_only', message: 'A temporary URL is not a stored render; upload the image and reference its attachment' }
        : { path: `screens.${index}.attachmentId`, code: 'missing_render', message: 'The screen has no stored render attachment' },
    )
  })
  if (details.length === 0) return { ok: true }
  const hasTemporaryUrl = details.some((detail) => detail.code === 'temporary_url_only')
  return hasTemporaryUrl
    ? { ok: false, ...buildDeliveryError('temporary_url_only', 'A screen only has a temporary URL', details) }
    : { ok: false, ...buildDeliveryError('missing_render', 'A screen has no stored render', details) }
}

function screenIdentity(screen: ScreenRef): string | null {
  if (screen.fileKey === null || screen.nodeId === null) return null
  return JSON.stringify([screen.fileKey, screen.nodeId, screen.viewport.width, screen.viewport.height])
}

function collectScreenIssues(screens: readonly ScreenRef[]): AttachmentIssue[] {
  const issues: AttachmentIssue[] = []
  const seenAttachments = new Set<string>()
  const seenIdentities = new Set<string>()
  screens.forEach((screen, index) => {
    if (seenAttachments.has(screen.attachmentId)) {
      issues.push({
        code: 'duplicate_stable_id',
        detail: { path: `screens.${index}.attachmentId`, code: 'duplicate_screen_attachment', message: 'Two screens share one render attachment' },
      })
    }
    seenAttachments.add(screen.attachmentId)
    const identity = screenIdentity(screen)
    if (identity === null) return
    if (seenIdentities.has(identity)) {
      issues.push({
        code: 'duplicate_stable_id',
        detail: { path: `screens.${index}.nodeId`, code: 'duplicate_screen', message: 'The same file, node and viewport is listed twice' },
      })
    }
    seenIdentities.add(identity)
  })
  return issues
}

function isInsideUnit(coordinate: unknown): boolean {
  return typeof coordinate === 'number' && Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 1
}

function collectCommentIssues(comments: readonly DesignReviewComment[], screens: readonly ScreenRef[]): AttachmentIssue[] {
  const issues: AttachmentIssue[] = []
  const screenIds = new Set(screens.map((screen) => screen.attachmentId))
  comments.forEach((comment, index) => {
    if (comment.screenAttachmentId !== null && !screenIds.has(comment.screenAttachmentId)) {
      issues.push({
        code: 'foreign_reference',
        detail: { path: `comments.${index}.screenAttachmentId`, code: 'unknown_screen', message: `Comment ${comment.id} points at a screen that is not part of the draft` },
      })
    }
    if (comment.anchor === null) return
    if (comment.screenAttachmentId === null) {
      issues.push({
        code: 'invalid_comment_anchor',
        detail: { path: `comments.${index}.anchor`, code: 'anchor_without_screen', message: 'An anchored comment needs a screen' },
      })
    }
    if (!isInsideUnit(comment.anchor.x) || !isInsideUnit(comment.anchor.y)) {
      issues.push({
        code: 'invalid_comment_anchor',
        detail: { path: `comments.${index}.anchor`, code: 'invalid_comment_anchor', message: 'Anchor coordinates must be between 0 and 1' },
      })
    }
  })
  return issues
}

function isTokenValue(value: unknown, depth: number): boolean {
  if (typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (depth >= MAX_DESIGN_TOKEN_DEPTH) return false
  if (Array.isArray(value)) return value.every((entry) => isTokenValue(entry, depth + 1))
  if (isRecord(value)) return Object.values(value).every((entry) => isTokenValue(entry, depth + 1))
  return false
}

function collectTokenIssues(tokens: Record<string, unknown>): AttachmentIssue[] {
  return Object.entries(tokens)
    .filter(([key, value]) => key.trim().length === 0 || !isTokenValue(value, 0))
    .map(([key]) => ({
      code: 'validation_failed' as const,
      detail: {
        path: `tokens.${key}`,
        code: 'invalid_token_value',
        message: `A token is a text, number or boolean, or a group of those nested at most ${MAX_DESIGN_TOKEN_DEPTH} levels`,
      },
    }))
}

export function checkDesignReview(input: DesignReviewInput): DeliveryCheckResult {
  const issues = [
    ...collectScreenIssues(input.screens),
    ...collectCommentIssues(input.comments ?? [], input.screens),
    ...collectTokenIssues(input.tokens ?? {}),
  ]
  return failWithPriority(issues, DESIGN_REVIEW_PRIORITY, DESIGN_REVIEW_MESSAGES)
}

export function validateDesignManifest(raw: unknown): DesignManifestValidation {
  const schemaMap = { [DELIVERY_SCHEMA_VERSIONS.designManifest]: designManifestV1Schema }
  const versionProbe = parseVersioned(schemaMap, isRecord(raw) ? { schemaVersion: raw.schemaVersion } : raw)
  if (!versionProbe.ok && versionProbe.body.code === 'unsupported_schema_version') return versionProbe
  const renders = checkRawScreenRenders(isRecord(raw) ? raw.screens : undefined)
  if (!renders.ok) return renders
  const parsed = parseVersioned(schemaMap, raw)
  if (!parsed.ok) return parsed
  const manifest = parsed.data as DesignManifestV1
  const review = checkDesignReview({ screens: manifest.screens, tokens: manifest.tokens })
  if (!review.ok) return review
  return { ok: true, manifest }
}

export function collectAttachmentReferences(draft: {
  screens: readonly ScreenRef[]
  attachments: readonly AttachmentRef[]
}): AttachmentReference[] {
  const toDeclared = (entry: DeclaredAttachment): DeclaredAttachment => ({
    sha256: entry.sha256,
    sizeBytes: entry.sizeBytes,
    mimeType: entry.mimeType,
  })
  return [
    ...draft.screens.map((screen, index) => ({
      path: `screens.${index}`,
      role: 'screen' as const,
      attachmentId: screen.attachmentId,
      declared: toDeclared(screen),
    })),
    ...draft.attachments.map((attachment, index) => ({
      path: `attachments.${index}`,
      role: 'attachment' as const,
      attachmentId: attachment.attachmentId,
      declared: toDeclared(attachment),
    })),
  ]
}

function attachmentIssue(reference: AttachmentReference, field: string, code: string, message: string, isRenderRule = false): AttachmentIssue {
  return {
    code: isRenderRule && reference.role === 'screen' ? 'missing_render' : 'attachment_hash_mismatch',
    detail: { path: `${reference.path}.${field}`, code, message },
  }
}

export function attachmentScopeIssue(reference: AttachmentReference): AttachmentIssue {
  return { code: 'attachment_scope_mismatch', detail: { path: `${reference.path}.attachmentId`, code: 'attachment_scope_mismatch' } }
}

export function attachmentUnreadableIssue(reference: AttachmentReference): AttachmentIssue {
  return attachmentIssue(reference, 'attachmentId', 'attachment_unreadable', 'The stored file could not be read')
}

function tooLargeIssue(reference: AttachmentReference): AttachmentIssue {
  return attachmentIssue(reference, 'attachmentId', 'attachment_too_large', `The stored file is larger than ${MAX_BASELINE_ATTACHMENT_BYTES} bytes`, true)
}

export function checkAttachmentRecord(reference: AttachmentReference, record: AttachmentRecordFacts): AttachmentIssue[] {
  const issues: AttachmentIssue[] = []
  const storedType = normalizeMimeType(record.mimeType)
  const allowedTypes = reference.role === 'screen' ? DESIGN_RENDER_MIME_TYPES : BASELINE_ATTACHMENT_MIME_TYPES
  if (!allowedTypes.includes(storedType)) {
    issues.push(attachmentIssue(reference, 'attachmentId', 'unsupported_mime_type', `Stored type ${storedType || 'unknown'} is not allowed here; allowed: ${allowedTypes.join(', ')}`, true))
  }
  if (record.sizeBytes > MAX_BASELINE_ATTACHMENT_BYTES) issues.push(tooLargeIssue(reference))
  const declaredType = reference.declared.mimeType
  if (declaredType !== undefined && normalizeMimeType(declaredType) !== storedType) {
    issues.push(attachmentIssue(reference, 'mimeType', 'mime_type_mismatch', `Declared ${normalizeMimeType(declaredType)}, stored ${storedType || 'unknown'}`))
  }
  return issues
}

export function checkAttachmentBytes(
  reference: AttachmentReference,
  record: AttachmentRecordFacts,
  bytes: AttachmentByteFacts,
): AttachmentIssue[] {
  const issues: AttachmentIssue[] = []
  if (bytes.sizeBytes === 0) issues.push(attachmentIssue(reference, 'attachmentId', 'empty_attachment', 'The stored file is empty', true))
  if (bytes.sizeBytes > MAX_BASELINE_ATTACHMENT_BYTES) issues.push(tooLargeIssue(reference))
  const storedType = normalizeMimeType(record.mimeType)
  if (reference.role === 'screen' && bytes.sizeBytes > 0 && bytes.detectedMimeType !== storedType) {
    issues.push(attachmentIssue(reference, 'attachmentId', 'render_bytes_not_image', 'The stored bytes are not the image type the file claims to be', true))
  }
  if (reference.role === 'attachment' && bytes.detectedMimeType !== null && bytes.detectedMimeType !== storedType) {
    issues.push(attachmentIssue(reference, 'attachmentId', 'content_type_mismatch', 'The stored bytes are not the type the file claims to be'))
  }
  if (bytes.sha256.toLowerCase() !== reference.declared.sha256.toLowerCase()) {
    issues.push(attachmentIssue(reference, 'sha256', 'sha256_mismatch', 'The stored bytes do not hash to the declared sha256'))
  }
  if (reference.declared.sizeBytes !== undefined && reference.declared.sizeBytes !== bytes.sizeBytes) {
    issues.push(attachmentIssue(reference, 'sizeBytes', 'size_mismatch', `Declared ${reference.declared.sizeBytes} bytes, stored ${bytes.sizeBytes}`))
  }
  return issues
}

export function checkTotalAttachmentBytes(sizes: readonly number[]): DeliveryCheckResult {
  const total = sizes.reduce((sum, size) => sum + size, 0)
  if (total <= MAX_BASELINE_TOTAL_ATTACHMENT_BYTES) return { ok: true }
  return {
    ok: false,
    ...buildDeliveryError('payload_too_large', 'The baseline attachments are too large together', [
      { path: 'attachments', code: 'attachments_total_too_large', message: `All referenced files together may have at most ${MAX_BASELINE_TOTAL_ATTACHMENT_BYTES} bytes` },
    ]),
  }
}

export function buildAttachmentVerificationError(issues: readonly AttachmentIssue[]): DeliveryCheckResult {
  return failWithPriority(issues, ATTACHMENT_ERROR_PRIORITY, ATTACHMENT_ERROR_MESSAGES)
}

export function applyAttachmentSnapshot<TDraft extends { screens: ScreenRef[]; attachments: AttachmentRef[] }>(
  draft: TDraft,
  snapshots: ReadonlyMap<string, AttachmentSnapshot>,
): TDraft {
  const withSnapshot = <TEntry extends { attachmentId: string }>(entry: TEntry): TEntry => {
    const snapshot = snapshots.get(entry.attachmentId)
    return snapshot ? { ...entry, sizeBytes: snapshot.sizeBytes, mimeType: snapshot.mimeType } : entry
  }
  return { ...draft, screens: draft.screens.map(withSnapshot), attachments: draft.attachments.map(withSnapshot) }
}
