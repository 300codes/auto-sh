import type { EntityManager } from '@mikro-orm/postgresql'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { Attachment, AttachmentPartition } from '../../data/entities'
import { DefaultAttachmentService } from '../attachment-service'
import type { StorageDriverFactory } from '../drivers'
const mockFind = jest.fn()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: (...args: unknown[]) => mockFind(...args) }))
const auth = { sub: 'user', tenantId: 'tenant', orgId: 'org', roles: [] } as NonNullable<AuthContext>
const record = { id: 'file', tenantId: 'tenant', organizationId: 'org', entityId: 'owner', recordId: 'record', partitionCode: 'private', fileName: 'screen.png', mimeType: 'image/png', fileSize: 3, storagePath: '/secret/server/path' }
const mockRead = jest.fn(async () => ({ buffer: Buffer.from('png') }))
const mockDriver = jest.fn(async () => ({ read: mockRead }))
const service = new DefaultAttachmentService({} as EntityManager, { resolveForPartition: mockDriver } as unknown as StorageDriverFactory, () => null)
beforeEach(() => { jest.clearAllMocks(); mockFind.mockImplementation(async (_em, entity, where) => entity === Attachment ? Object.entries(where).every(([key, value]) => record[key as keyof typeof record] === value) ? record : null : entity === AttachmentPartition ? { code: 'private', isPublic: false, tenantId: null, organizationId: null } : null) })
it('exposes safe scoped metadata without bytes or storage location', async () => {
  const description = await service.describeScoped({ attachmentId: 'file', auth })
  expect(description).toEqual({ id: 'file', entityId: 'owner', recordId: 'record', fileName: 'screen.png', mimeType: 'image/png', fileSize: 3 })
  expect(mockDriver).not.toHaveBeenCalled()
})
it.each([{ tenantId: 'other' }, { orgId: 'other' }])('rejects a different scope %s for both metadata and bytes', async (change) => {
  const scoped = { ...auth, ...change }
  await expect(service.describeScoped({ attachmentId: 'file', auth: scoped })).rejects.toMatchObject({ status: 404 })
  await expect(service.readScoped({ attachmentId: 'file', auth: scoped, expectedOwner: { entityId: 'owner', recordId: 'record' } })).rejects.toMatchObject({ status: 404 })
  expect(mockDriver).not.toHaveBeenCalled()
})
it('does not weaken the existing owner check', async () => {
  await expect(service.readScoped({ attachmentId: 'file', auth, expectedOwner: { entityId: 'owner', recordId: 'other' } })).rejects.toMatchObject({ status: 404 })
  expect(mockDriver).not.toHaveBeenCalled()
})
it('checks the partition scope before revealing metadata', async () => {
  mockFind.mockImplementation(async (_em, entity) => entity === Attachment ? record : { code: 'private', isPublic: false, tenantId: 'other', organizationId: 'org' })
  await expect(service.describeScoped({ attachmentId: 'file', auth })).rejects.toMatchObject({ status: 403 })
})
