import type { EntityManager } from '@mikro-orm/postgresql'
import { createDeliveryOsEvidenceQueries, safeEvidencePayload } from '../evidenceQueries'
import { evidenceListQuerySchema } from '../../lib/evidenceReadContracts'
import { DeliveryProject, DeliveryEvidence } from '../../data/entities'
const mockFindOne = jest.fn()
const mockFind = jest.fn()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: (...args: unknown[]) => mockFindOne(...args), findWithDecryption: (...args: unknown[]) => mockFind(...args) }))
const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const projectId = '33333333-3333-4333-8333-333333333333'
const baselineId = '44444444-4444-4444-8444-444444444444'
const revision = { kind: 'git' as const, commitSha: 'a'.repeat(40) }
const em = { fork: () => em } as unknown as EntityManager
const queries = createDeliveryOsEvidenceQueries(em)
const row = { id: '55555555-5555-4555-8555-555555555555', ...scope, projectId, baselineId, kind: 'screenshot', source: 'manual', sourceRevision: revision, payload: {}, attachmentIds: [], createdAt: new Date() }
beforeEach(() => { jest.clearAllMocks(); mockFindOne.mockImplementation(async (_em, entity) => entity === DeliveryProject ? { id: projectId } : { id: baselineId, projectId }); mockFind.mockResolvedValue([]) })
it('caps pages and disallows ambiguous baseline filters', () => {
  expect(evidenceListQuerySchema.safeParse({ baselineId, revision: 'git:x', limit: 101 }).success).toBe(false)
  expect(evidenceListQuerySchema.safeParse({ baselineId, revision: 'git:x', group: 'baseline' }).success).toBe(false)
  expect(evidenceListQuerySchema.safeParse({ baselineId }).success).toBe(false)
})
it('uses an exact scoped revision filter, deterministic bounded lookahead and nextOffset', async () => {
  mockFind.mockResolvedValue([row, row])
  const page = await queries.list(scope, projectId, evidenceListQuerySchema.parse({ baselineId, revision: `git:${revision.commitSha}`, limit: 1 }))
  expect(page.items).toHaveLength(1); expect(page.nextOffset).toBe(1)
  expect(mockFind).toHaveBeenCalledWith(em, DeliveryEvidence, { ...scope, projectId, baselineId, sourceRevision: revision }, { orderBy: { createdAt: 'asc', id: 'asc' }, limit: 2, offset: 0 }, scope)
})
it('keeps baseline revisionless evidence separate and returns an empty page distinctly', async () => {
  const page = await queries.list(scope, projectId, evidenceListQuerySchema.parse({ baselineId, group: 'baseline' }))
  expect(page).toMatchObject({ group: 'baseline', items: [], nextOffset: null })
  expect(mockFind.mock.calls[0][2].sourceRevision).toBeNull()
})
it.each(['tenantId', 'organizationId'])('does not materialize a project from another %s', async (key) => {
  mockFindOne.mockResolvedValue(null)
  await expect(queries.detail({ ...scope, [key]: '99999999-9999-4999-8999-999999999999' }, projectId, row.id)).rejects.toMatchObject({ status: 404 })
  expect(mockFind).not.toHaveBeenCalled()
})
it('does not read evidence from a different project', async () => {
  mockFindOne.mockImplementation(async (_em, entity) => entity === DeliveryProject ? { id: projectId } : null)
  await expect(queries.detail(scope, projectId, row.id)).rejects.toMatchObject({ status: 404 })
  expect(mockFindOne.mock.calls[1][2]).toEqual({ ...scope, projectId, id: row.id })
})
it('projects typed results without author, free text, credentials, URLs or server paths', () => {
  expect(safeEvidencePayload({ kind: 'review', payload: { verdict: 'approved', summary: '/private/token', reviewer: { ref: 'pii@email' }, secret: 'token' } })).toEqual({ verdict: 'approved' })
  expect(safeEvidencePayload({ kind: 'test', payload: { checks: [{ status: 'passed', rawReportHash: 'b'.repeat(64), token: 'secret', command: '/private/path' }] } })).toEqual({ checks: [{ status: 'passed', rawReportHash: 'b'.repeat(64) }] })
})
it('bounds detail attachments and builds only authorized local URLs', async () => {
  mockFindOne.mockImplementation(async (_em, entity) => entity === DeliveryProject ? { id: projectId } : { ...row, attachmentIds: ['66666666-6666-4666-8666-666666666666'], payload: { attachmentId: '66666666-6666-4666-8666-666666666666', secret: 'secret' } })
  const detail = await queries.detail(scope, projectId, row.id)
  expect(detail.payload).toEqual({})
  expect(detail.attachments[0].previewUrl).toBe(`/api/delivery_os/projects/${projectId}/evidence/${row.id}/attachments/66666666-6666-4666-8666-666666666666`)
  expect(detail).not.toHaveProperty('tenantId')
})
