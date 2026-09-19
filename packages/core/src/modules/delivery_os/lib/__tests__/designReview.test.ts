import { DELIVERY_SCHEMA_VERSIONS, taskPackageV1Schema, type ScreenRef } from '../contracts'
import {
  applyAttachmentSnapshot,
  attachmentScopeIssue,
  attachmentUnreadableIssue,
  buildAttachmentVerificationError,
  checkAttachmentBytes,
  checkAttachmentRecord,
  checkDesignReview,
  checkRawScreenRenders,
  checkTotalAttachmentBytes,
  collectAttachmentReferences,
  detectMimeType,
  MAX_BASELINE_ATTACHMENT_BYTES,
  MAX_BASELINE_TOTAL_ATTACHMENT_BYTES,
  normalizeMimeType,
  validateDesignManifest,
  type AttachmentReference,
} from '../designReview'
import { loadBaselineContentFixture, loadDesignManifestFixture, loadTaskPackageFixture } from '../fixtures/index'

const SHA = 'a'.repeat(64)
const OTHER_SHA = 'b'.repeat(64)
const SCREEN_ID = '55555555-5555-4555-8555-555555555555'
const OTHER_SCREEN_ID = '77777777-7777-4777-8777-777777777777'
const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function screen(overrides: Partial<ScreenRef> = {}): ScreenRef {
  return { ...loadDesignManifestFixture().screens[0], ...overrides }
}

function reference(overrides: Partial<AttachmentReference> = {}): AttachmentReference {
  return { path: 'screens.0', role: 'screen', attachmentId: SCREEN_ID, declared: { sha256: SHA }, ...overrides }
}

function failure(result: { ok: boolean }): { status: number; body: { code: string; details: Array<{ path?: string; code: string }> } } {
  if (result.ok) throw new Error('[internal] expected a failed check')
  return result as never
}

describe('checkRawScreenRenders', () => {
  it('accepts screens that reference a stored attachment', () => {
    expect(checkRawScreenRenders([screen()])).toEqual({ ok: true })
    expect(checkRawScreenRenders(undefined)).toEqual({ ok: true })
  })

  it('answers 422 temporary_url_only for a screen that only carries a URL', () => {
    const { attachmentId: _attachmentId, ...withoutRender } = screen()
    const result = failure(checkRawScreenRenders([{ ...withoutRender, imageUrl: 'https://figma-alpha-api.s3.amazonaws.com/images/x' }]))
    expect(result.status).toBe(422)
    expect(result.body.code).toBe('temporary_url_only')
    expect(result.body.details).toEqual([expect.objectContaining({ path: 'screens.0', code: 'temporary_url_only' })])
  })

  it('answers 422 missing_render for a screen with neither a render nor a URL', () => {
    const { attachmentId: _attachmentId, ...withoutRender } = screen()
    const result = failure(checkRawScreenRenders([screen(), withoutRender]))
    expect(result.body.code).toBe('missing_render')
    expect(result.body.details.map((detail) => detail.path)).toEqual(['screens.1.attachmentId'])
  })
})

describe('checkDesignReview', () => {
  it('accepts unique screens, anchored comments on known screens and plain tokens', () => {
    const result = checkDesignReview({
      screens: [screen(), screen({ attachmentId: OTHER_SCREEN_ID, viewport: { width: 390, height: 844 } })],
      comments: [
        { id: 'C-1', screenAttachmentId: SCREEN_ID, anchor: { x: 0, y: 1 } },
        { id: 'C-2', screenAttachmentId: null, anchor: null },
      ],
      tokens: { 'color.primary': '#1f6feb', 'space.md': 16, dark: true, font: { body: { family: 'Inter', sizes: [12, 14] } } },
    })
    expect(result).toEqual({ ok: true })
  })

  it('rejects two screens sharing one render or one file, node and viewport', () => {
    const sameRender = failure(checkDesignReview({ screens: [screen(), screen({ nodeId: '99:1' })] }))
    expect(sameRender.body.code).toBe('duplicate_stable_id')
    expect(sameRender.body.details.map((detail) => detail.code)).toEqual(['duplicate_screen_attachment'])

    const sameNode = failure(checkDesignReview({ screens: [screen(), screen({ attachmentId: OTHER_SCREEN_ID })] }))
    expect(sameNode.body.details.map((detail) => detail.code)).toEqual(['duplicate_screen'])

    const snapshots = [screen({ fileKey: null, nodeId: null }), screen({ fileKey: null, nodeId: null, attachmentId: OTHER_SCREEN_ID })]
    expect(checkDesignReview({ screens: snapshots })).toEqual({ ok: true })
  })

  it('rejects a comment on an unknown screen', () => {
    const result = failure(
      checkDesignReview({ screens: [screen()], comments: [{ id: 'C-1', screenAttachmentId: OTHER_SCREEN_ID, anchor: null }] }),
    )
    expect(result.status).toBe(422)
    expect(result.body.code).toBe('foreign_reference')
    expect(result.body.details).toEqual([expect.objectContaining({ path: 'comments.0.screenAttachmentId', code: 'unknown_screen' })])
  })

  it('rejects anchors outside 0-1 and anchors without a screen', () => {
    const outside = failure(
      checkDesignReview({ screens: [screen()], comments: [{ id: 'C-1', screenAttachmentId: SCREEN_ID, anchor: { x: 1.2, y: 0.5 } }] }),
    )
    expect(outside.body.code).toBe('invalid_comment_anchor')

    const floating = failure(
      checkDesignReview({ screens: [screen()], comments: [{ id: 'C-1', screenAttachmentId: null, anchor: { x: 0.5, y: 0.5 } }] }),
    )
    expect(floating.body.details.map((detail) => detail.code)).toEqual(['anchor_without_screen'])
  })

  it('rejects token values that are not a snapshot of plain values', () => {
    const tooDeep = { a: { b: { c: { d: { e: 1 } } } } }
    const result = failure(checkDesignReview({ screens: [screen()], tokens: { 'color.primary': null, deep: tooDeep, ok: 'x' } }))
    expect(result.status).toBe(400)
    expect(result.body.code).toBe('validation_failed')
    expect(result.body.details.map((detail) => detail.path)).toEqual(['tokens.color.primary', 'tokens.deep'])
  })

  it('reports every problem in one body with a fixed top code', () => {
    const result = failure(
      checkDesignReview({
        screens: [screen(), screen()],
        comments: [{ id: 'C-1', screenAttachmentId: OTHER_SCREEN_ID, anchor: { x: 2, y: 0 } }],
      }),
    )
    expect(result.body.code).toBe('duplicate_stable_id')
    expect(result.body.details.map((detail) => detail.code)).toEqual([
      'duplicate_screen_attachment',
      'duplicate_screen',
      'unknown_screen',
      'invalid_comment_anchor',
    ])
  })
})

describe('validateDesignManifest', () => {
  it('accepts the frozen fixture', () => {
    const result = validateDesignManifest(loadDesignManifestFixture())
    expect(result.ok).toBe(true)
  })

  it('answers unsupported_schema_version before anything else', () => {
    const result = failure(validateDesignManifest({ ...loadDesignManifestFixture(), schemaVersion: 'delivery.design-manifest/v2' }))
    expect(result.body.code).toBe('unsupported_schema_version')
    expect(failure(validateDesignManifest(null)).body.code).toBe('unsupported_schema_version')
  })

  it('names the temporary URL instead of a generic shape error', () => {
    const manifest = loadDesignManifestFixture()
    const { attachmentId: _attachmentId, ...withoutRender } = manifest.screens[0]
    const result = failure(validateDesignManifest({ ...manifest, screens: [{ ...withoutRender, url: 'https://example.test/render.png' }] }))
    expect(result.body.code).toBe('temporary_url_only')
  })

  it('rejects a manifest without screens and one with duplicate screens', () => {
    const manifest = loadDesignManifestFixture()
    expect(failure(validateDesignManifest({ ...manifest, screens: [] })).body.code).toBe('validation_failed')
    expect(failure(validateDesignManifest({ ...manifest, screens: [manifest.screens[0], manifest.screens[0]] })).body.code).toBe(
      'duplicate_stable_id',
    )
  })
})

describe('stored attachment checks', () => {
  const record = { mimeType: 'image/png', sizeBytes: 2048 }
  const bytes = { sha256: SHA, sizeBytes: 2048, detectedMimeType: 'image/png' }

  it('passes a png render whose bytes match', () => {
    expect(checkAttachmentRecord(reference(), record)).toEqual([])
    expect(checkAttachmentBytes(reference(), record, bytes)).toEqual([])
    expect(checkAttachmentRecord(reference({ declared: { sha256: SHA, mimeType: 'IMAGE/PNG; charset=binary' } }), record)).toEqual([])
    expect(buildAttachmentVerificationError([])).toEqual({ ok: true })
  })

  it('treats a screen that is not a raster image as a missing render', () => {
    for (const mimeType of ['image/svg+xml', 'application/pdf', '']) {
      const issues = checkAttachmentRecord(reference(), { ...record, mimeType })
      expect(issues.map((issue) => [issue.code, issue.detail.code])).toEqual([['missing_render', 'unsupported_mime_type']])
    }
    expect(checkAttachmentRecord(reference({ role: 'attachment', path: 'attachments.0' }), { ...record, mimeType: 'application/pdf' })).toEqual([])
    const zip = checkAttachmentRecord(reference({ role: 'attachment', path: 'attachments.0' }), { ...record, mimeType: 'application/zip' })
    expect(zip.map((issue) => [issue.code, issue.detail.code])).toEqual([['attachment_hash_mismatch', 'unsupported_mime_type']])
  })

  it('rejects files above the limit and accepts one at the limit', () => {
    expect(checkAttachmentRecord(reference(), { ...record, sizeBytes: MAX_BASELINE_ATTACHMENT_BYTES })).toEqual([])
    const issues = checkAttachmentRecord(reference(), { ...record, sizeBytes: MAX_BASELINE_ATTACHMENT_BYTES + 1 })
    expect(issues.map((issue) => [issue.code, issue.detail.code])).toEqual([['missing_render', 'attachment_too_large']])
    const lying = checkAttachmentBytes(reference(), record, { ...bytes, sizeBytes: MAX_BASELINE_ATTACHMENT_BYTES + 1 })
    expect(lying.map((issue) => issue.detail.code)).toEqual(['attachment_too_large'])
  })

  it('rejects bytes that do not match the declaration', () => {
    const wrongHash = checkAttachmentBytes(reference(), record, { ...bytes, sha256: OTHER_SHA })
    expect(wrongHash.map((issue) => [issue.code, issue.detail.path, issue.detail.code])).toEqual([
      ['attachment_hash_mismatch', 'screens.0.sha256', 'sha256_mismatch'],
    ])
    const wrongSize = checkAttachmentBytes(reference({ declared: { sha256: SHA, sizeBytes: 1 } }), record, bytes)
    expect(wrongSize.map((issue) => issue.detail.code)).toEqual(['size_mismatch'])
    const wrongType = checkAttachmentRecord(reference({ declared: { sha256: SHA, mimeType: 'image/jpeg' } }), record)
    expect(wrongType.map((issue) => issue.detail.code)).toEqual(['mime_type_mismatch'])
  })

  it('rejects a text file stored under an image type and an empty file', () => {
    const spoofed = checkAttachmentBytes(reference(), record, { ...bytes, detectedMimeType: null })
    expect(spoofed.map((issue) => [issue.code, issue.detail.code])).toEqual([['missing_render', 'render_bytes_not_image']])
    const empty = checkAttachmentBytes(reference(), record, { ...bytes, sizeBytes: 0, detectedMimeType: null })
    expect(empty.map((issue) => issue.detail.code)).toEqual(['empty_attachment'])
  })

  it('checks the claimed type of other attachments only when the bytes are recognisable', () => {
    const notes = reference({ role: 'attachment', path: 'attachments.0' })
    const textRecord = { mimeType: 'text/plain', sizeBytes: 2048 }
    expect(checkAttachmentBytes(notes, textRecord, { ...bytes, detectedMimeType: null })).toEqual([])
    const disguised = checkAttachmentBytes(notes, textRecord, { ...bytes, detectedMimeType: 'application/pdf' })
    expect(disguised.map((issue) => [issue.code, issue.detail.code])).toEqual([['attachment_hash_mismatch', 'content_type_mismatch']])
  })

  it('caps the bytes of all referenced files together with 413', () => {
    expect(checkTotalAttachmentBytes([MAX_BASELINE_TOTAL_ATTACHMENT_BYTES])).toEqual({ ok: true })
    const result = failure(checkTotalAttachmentBytes([MAX_BASELINE_TOTAL_ATTACHMENT_BYTES, 1]))
    expect(result.status).toBe(413)
    expect(result.body.code).toBe('payload_too_large')
  })

  it('picks the top code scope > render > hash and keeps every detail', () => {
    const issues = [
      ...checkAttachmentBytes(reference(), record, { ...bytes, sha256: OTHER_SHA }),
      ...checkAttachmentRecord(reference({ path: 'screens.1' }), { ...record, mimeType: 'text/plain' }),
    ]
    const render = failure(buildAttachmentVerificationError(issues))
    expect(render.status).toBe(422)
    expect(render.body.code).toBe('missing_render')
    expect(render.body.details).toHaveLength(2)

    const scope = failure(buildAttachmentVerificationError([...issues, attachmentScopeIssue(reference({ path: 'attachments.0' }))]))
    expect(scope.body.code).toBe('attachment_scope_mismatch')
    const unreadable = failure(buildAttachmentVerificationError([attachmentUnreadableIssue(reference())]))
    expect(unreadable.body.code).toBe('attachment_hash_mismatch')
  })
})

describe('helpers', () => {
  it('detects the image types by their magic bytes', () => {
    expect(detectMimeType(Uint8Array.from([...PNG_HEADER, 0, 0]))).toBe('image/png')
    expect(detectMimeType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(detectMimeType(new TextEncoder().encode('RIFF\u0000\u0000\u0000\u0000WEBPVP8 '))).toBe('image/webp')
    expect(detectMimeType(new TextEncoder().encode('%PDF-1.7'))).toBe('application/pdf')
    expect(detectMimeType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull()
    expect(detectMimeType(new Uint8Array())).toBeNull()
    expect(normalizeMimeType(' Image/PNG ; q=1')).toBe('image/png')
  })

  it('collects one reference per screen and attachment and applies the verified snapshot', () => {
    const content = loadBaselineContentFixture()
    const references = collectAttachmentReferences(content)
    expect(references.map((entry) => [entry.path, entry.role])).toEqual([
      ['screens.0', 'screen'],
      ['attachments.0', 'attachment'],
    ])
    const snapshot = applyAttachmentSnapshot(content, new Map([[SCREEN_ID, { sizeBytes: 2048, mimeType: 'image/png' }]]))
    expect(snapshot.screens[0]).toMatchObject({ attachmentId: SCREEN_ID, sizeBytes: 2048, mimeType: 'image/png' })
    expect(snapshot.attachments[0]).toMatchObject({ sizeBytes: 2048, mimeType: 'image/png' })
    expect(content.screens[0]).not.toHaveProperty('sizeBytes')
  })

  it('keeps the snapshot fields readable in an exported task package', () => {
    const taskPackage = loadTaskPackageFixture()
    const designArtifactRefs = taskPackage.designArtifactRefs.map((entry) => ({ ...entry, sizeBytes: 2048, mimeType: 'image/png' }))
    const parsed = taskPackageV1Schema.parse({ ...taskPackage, designArtifactRefs })
    expect(parsed.schemaVersion).toBe(DELIVERY_SCHEMA_VERSIONS.taskPackage)
    expect(parsed.designArtifactRefs[0]).toMatchObject({ sizeBytes: 2048, mimeType: 'image/png' })
  })
})
