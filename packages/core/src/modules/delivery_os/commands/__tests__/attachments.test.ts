import { createHash } from 'node:crypto'
import { createDeliveryAttachmentInspector } from '../attachments'

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const location = { id: '55555555-5555-4555-8555-555555555555', partitionCode: 'privateAttachments', storagePath: 'delivery/render.png' }
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03])

function makeFactory(buffer: Buffer) {
  const read = jest.fn(async () => ({ buffer }))
  const resolveForPartition = jest.fn(async () => ({ read }))
  return { factory: { resolveForPartition }, read, resolveForPartition }
}

describe('createDeliveryAttachmentInspector', () => {
  it('hashes the stored bytes and reports their real size and type', async () => {
    const { factory, read, resolveForPartition } = makeFactory(PNG)
    const facts = await createDeliveryAttachmentInspector(() => factory)(location, scope)

    expect(facts).toEqual({
      sha256: createHash('sha256').update(PNG).digest('hex'),
      sizeBytes: PNG.byteLength,
      detectedMimeType: 'image/png',
    })
    expect(resolveForPartition).toHaveBeenCalledWith('privateAttachments', scope)
    expect(read).toHaveBeenCalledWith('privateAttachments', 'delivery/render.png')
  })

  it('knows the sha256 of abc and does not take text for an image', async () => {
    const { factory } = makeFactory(Buffer.from('abc'))
    const facts = await createDeliveryAttachmentInspector(() => factory)(location, scope)
    expect(facts.sha256).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(facts.detectedMimeType).toBeNull()
  })

  it('resolves the storage factory only when a file is inspected and lets a read failure surface', async () => {
    const resolveFactory = jest.fn(() => ({
      resolveForPartition: async () => ({
        read: async () => {
          throw new Error('[internal] storage offline')
        },
      }),
    }))
    const inspect = createDeliveryAttachmentInspector(resolveFactory)
    expect(resolveFactory).not.toHaveBeenCalled()
    await expect(inspect(location, scope)).rejects.toThrow('storage offline')
    expect(resolveFactory).toHaveBeenCalledTimes(1)
  })
})
