/** @jest-environment jsdom */
import { webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TextEncoder as NodeTextEncoder } from 'node:util'
import { designManifestV1Schema } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import {
  DELIVERY_PROJECT_ATTACHMENT_ENTITY_ID,
  buildScreenRef,
  checkRenderFile,
  hashBytes,
  isHashingAvailable,
  mapManifestScreens,
  uploadScreenRender,
} from '../screenUpload'

const projectId = '11111111-1111-4111-8111-111111111111'
const attachmentId = '55555555-5555-4555-8555-555555555555'

// sha256("abc") — a value taken from outside the implementation, so the
// assertion fails if the digest is ever computed over the wrong thing.
const SHA256_OF_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

function withSubtle<T>(subtle: unknown, run: () => T): T {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  Object.defineProperty(globalThis, 'crypto', { value: subtle, configurable: true, writable: true })
  try {
    return run()
  } finally {
    if (original) Object.defineProperty(globalThis, 'crypto', original)
    else Reflect.deleteProperty(globalThis as object, 'crypto')
  }
}

// jsdom in this Jest version ships neither `TextEncoder` nor `Blob.prototype.arrayBuffer`;
// both exist in every browser the app runs in, so they are supplied here rather
// than worked around in production code.
beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true, writable: true })
  if (typeof globalThis.TextEncoder === 'undefined') {
    Object.defineProperty(globalThis, 'TextEncoder', { value: NodeTextEncoder, configurable: true, writable: true })
  }
  if (typeof Blob.prototype.arrayBuffer !== 'function') {
    Object.defineProperty(Blob.prototype, 'arrayBuffer', {
      configurable: true,
      writable: true,
      value(this: Blob): Promise<ArrayBuffer> {
        return new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as ArrayBuffer)
          reader.onerror = () => reject(reader.error)
          reader.readAsArrayBuffer(this)
        })
      },
    })
  }
})

describe('hashBytes', () => {
  it('produces the sha256 the server will recompute from the same bytes', async () => {
    const bytes = new TextEncoder().encode('abc')
    const result = await hashBytes(bytes.buffer as ArrayBuffer)
    expect(result).toEqual({ ok: true, sha256: SHA256_OF_ABC })
  })

  it('names a missing crypto.subtle as an insecure context instead of failing silently', async () => {
    const result = await withSubtle({}, () => {
      expect(isHashingAvailable()).toBe(false)
      return hashBytes(new TextEncoder().encode('abc').buffer as ArrayBuffer)
    })
    expect(await result).toEqual({ ok: false, reason: 'insecure_context' })
  })
})

describe('checkRenderFile', () => {
  it('accepts the three render types the server accepts', () => {
    expect(checkRenderFile({ type: 'image/png', size: 100 })).toBeNull()
    expect(checkRenderFile({ type: 'image/jpeg', size: 100 })).toBeNull()
    expect(checkRenderFile({ type: 'image/webp', size: 100 })).toBeNull()
  })

  it('refuses a type outside the render list before any byte is uploaded', () => {
    expect(checkRenderFile({ type: 'application/pdf', size: 100 }))
      .toEqual({ ok: false, reason: 'unsupported_type', mimeType: 'application/pdf' })
  })

  it('refuses a file over the per-attachment limit', () => {
    const oversized = checkRenderFile({ type: 'image/png', size: 10 * 1024 * 1024 + 1 })
    expect(oversized).toEqual({ ok: false, reason: 'too_large', sizeBytes: 10 * 1024 * 1024 + 1, limit: 10 * 1024 * 1024 })
  })
})

describe('uploadScreenRender', () => {
  function pngFile(bytes = 'abc'): File {
    return new File([bytes], 'screen.png', { type: 'image/png' })
  }

  it('sends the project scope with the file and returns the declared render facts', async () => {
    const upload = jest.fn(async () => ({ ok: true, status: 201, result: { ok: true, item: { id: attachmentId } } }))
    const result = await uploadScreenRender(pngFile(), projectId, upload)
    expect(result).toEqual({
      ok: true,
      render: { attachmentId, sha256: SHA256_OF_ABC, sizeBytes: 3, mimeType: 'image/png' },
    })
    const form = upload.mock.calls[0][0] as FormData
    expect(form.get('entityId')).toBe(DELIVERY_PROJECT_ATTACHMENT_ENTITY_ID)
    expect(form.get('recordId')).toBe(projectId)
  })

  it('does not upload a file the server would reject anyway', async () => {
    const upload = jest.fn()
    const result = await uploadScreenRender(
      new File(['abc'], 'screen.pdf', { type: 'application/pdf' }),
      projectId,
      upload,
    )
    expect(result).toEqual({ ok: false, reason: 'unsupported_type', mimeType: 'application/pdf' })
    expect(upload).not.toHaveBeenCalled()
  })

  it('names a response carrying no attachment id rather than inventing one', async () => {
    const upload = jest.fn(async () => ({ ok: true, status: 201, result: { ok: true } }))
    expect(await uploadScreenRender(pngFile(), projectId, upload)).toEqual({ ok: false, reason: 'unreadable_response' })
  })
})

describe('buildScreenRef', () => {
  it('omits figmaVersion entirely when it was not supplied, instead of writing an empty string', () => {
    const screen = buildScreenRef(
      { name: 'List', fileKey: 'file', nodeId: '3:2', viewportWidth: 1440, viewportHeight: 1024, figmaVersion: null },
      { attachmentId, sha256: SHA256_OF_ABC, sizeBytes: 3, mimeType: 'image/png' },
      '2026-09-19T10:00:00.000Z',
    )
    expect('figmaVersion' in screen).toBe(false)
    expect(screen.sha256).toBe(SHA256_OF_ABC)
  })
})

describe('mapManifestScreens', () => {
  const manifest = designManifestV1Schema.parse(JSON.parse(readFileSync(
    join(__dirname, '../../../../../../../../hackathon/delivery-demo/fixtures/design-manifest.v1.json'),
    'utf8',
  )))

  it('maps the metadata of every manifest screen when a file is supplied for each', () => {
    const files = new Map([['3:2', new File(['abc'], 'screen.png', { type: 'image/png' })]])
    const mapped = mapManifestScreens(manifest, files)
    expect(mapped.ok).toBe(true)
    if (!mapped.ok) return
    expect(mapped.metadata).toEqual([{
      name: 'UI-01 / Lista usług',
      fileKey: '5wOkFtN959W4MFmgRuaU8S',
      nodeId: '3:2',
      viewportWidth: 1440,
      viewportHeight: 1024,
      figmaVersion: 'ui-01-update',
    }])
  })

  it('reports a manifest entry with no file as an error rather than dropping the screen', () => {
    expect(mapManifestScreens(manifest, new Map())).toEqual({ ok: false, reason: 'missing_file', nodeIds: ['3:2'] })
  })
})
