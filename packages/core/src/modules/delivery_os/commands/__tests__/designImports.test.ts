jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ translate: (key: string) => key }) }))
const mockFind = jest.fn()
const mockFindOne = jest.fn()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findWithDecryption: (...args: unknown[]) => mockFind(...args), findOneWithDecryption: (...args: unknown[]) => mockFindOne(...args) }))
import '../designImports'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { designImportScreenKey, type DesignImportSession } from '../../lib/designImportContracts'
import { loadDesignManifestFixture } from '../../lib/fixtures'
import { assertDraftImportComplete } from '../designImportSessions'
import { createDeliveryOsDesignImportQueries } from '../designImportQueries'
import { draftAttachmentRows, emptyStore, getHandler, makeHarness, makeProject, matches, ORG_ID, PROJECT_ID, rowsFor, TENANT_ID, UPDATED_AT, type Store, type Row, FOREIGN_ORG_ID } from './baselineTestKit'
import type { EntityManager } from '@mikro-orm/postgresql'

let store: Store
const create = getHandler<DesignImportSession>('delivery_os.design_imports.create')
const update = getHandler<DesignImportSession>('delivery_os.design_imports.update')
const scope = { tenantId: TENANT_ID, organizationId: ORG_ID }
function harness(version: string = UPDATED_AT.toISOString(), orgId = ORG_ID) { return makeHarness(store, { headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: version }, orgId }) }
function manifest() {
  const value = loadDesignManifestFixture()
  value.screens = value.screens.slice(0, 1).map((screen) => ({ ...screen, sizeBytes: 2048, mimeType: 'image/png' }))
  return value
}
function seedAttachments(screens: ReturnType<typeof manifest>['screens']) {
  store.attachments = draftAttachmentRows({ screens, attachments: [] }).map((row) => ({ ...row, entityId: 'delivery_os:project', recordId: PROJECT_ID }))
}
async function start(value = manifest()) {
  seedAttachments(value.screens)
  return create.execute({ projectId: PROJECT_ID, manifest: value }, harness().ctx)
}
async function save(session: DesignImportSession, payload: Row) { return update.execute({ projectId: PROJECT_ID, sessionId: session.id, ...payload }, harness(session.updatedAt).ctx) }
beforeEach(() => {
  store = { ...emptyStore(), projects: [makeProject({ draftSpec: {} })] }
  mockFind.mockImplementation(async (_em: unknown, entity: unknown, where: Row) => rowsFor(store, entity).filter((row) => matches(row, where)))
  mockFindOne.mockImplementation(async (_em: unknown, entity: unknown, where: Row) => rowsFor(store, entity).find((row) => matches(row, where)) ?? null)
})

test('identical manifest resumes one durable session, and a partial import blocks freeze after reload', async () => {
  const session = await start()
  const duplicate = await create.execute({ projectId: PROJECT_ID, manifest: manifest() }, harness().ctx)
  expect(duplicate.id).toBe(session.id)
  expect(store.designImportSessions).toHaveLength(1)
  const em = harness().em as unknown as EntityManager
  const reloaded = await createDeliveryOsDesignImportQueries(em).read(scope, PROJECT_ID, session.id)
  expect(reloaded.progress.screens[0].screen).toBeNull()
  await expect(assertDraftImportComplete(em, store.projects[0], scope)).rejects.toMatchObject({ status: 422 })
  await expect(createDeliveryOsDesignImportQueries(em).read({ ...scope, organizationId: FOREIGN_ORG_ID }, PROJECT_ID, session.id)).rejects.toMatchObject({ status: 404 })
})

test('bad bytes persist a per-screen failure and cannot complete; retry replaces that failure with verified bytes', async () => {
  let session = await start()
  const screen = manifest().screens[0]
  const key = designImportScreenKey(screen)
  store.attachments[0].storedSha256 = 'f'.repeat(64)
  session = await save(session, { renders: [{ key, attachmentId: screen.attachmentId }], selectedKeys: [key], action: 'complete' })
  expect(session.status).toBe('partial')
  expect(session.progress.screens[0]).toMatchObject({ screen: null, errorCode: 'attachment_hash_mismatch' })
  store.attachments[0].storedSha256 = screen.sha256
  session = await save(session, { renders: [{ key, attachmentId: screen.attachmentId }] })
  expect(session.progress.screens[0].screen).toMatchObject({ sha256: screen.sha256, sizeBytes: 2048 })
  session = await save(session, { action: 'complete' })
  expect(session.status).toBe('complete')
  expect(store.projects[0].draftSpec?.screens).toHaveLength(1)
  await expect(assertDraftImportComplete(harness().em as unknown as EntityManager, store.projects[0], scope)).resolves.toBeUndefined()
  expect((await save({ ...session, updatedAt: UPDATED_AT.toISOString() }, { action: 'complete' })).id).toBe(session.id)
})

test('attachments from another project or organization never count as a render', async () => {
  let session = await start()
  const screen = manifest().screens[0]
  store.attachments[0].recordId = '99999999-9999-4999-8999-999999999999'
  session = await save(session, { renders: [{ key: designImportScreenKey(screen), attachmentId: screen.attachmentId }] })
  expect(session.progress.screens[0].errorCode).toBe('attachment_scope_mismatch')
  store.attachments[0].recordId = PROJECT_ID
  store.attachments[0].organizationId = FOREIGN_ORG_ID
  session = await save(session, { renders: [{ key: designImportScreenKey(screen), attachmentId: screen.attachmentId }] })
  expect(session.progress.screens[0].screen).toBeNull()
})

test('history keeps two versions, different viewports and node IDs in different files; draft selects exactly one version', async () => {
  const value = manifest()
  const base = value.screens[0]
  value.screens = [base, { ...base, figmaVersion: 'revision-2', attachmentId: 'a0000000-0000-4000-8000-000000000001' }, { ...base, fileKey: 'other-file', attachmentId: 'a0000000-0000-4000-8000-000000000002' }, { ...base, viewport: { width: 390, height: 844 }, attachmentId: 'a0000000-0000-4000-8000-000000000003' }]
  let session = await start(value)
  session = await save(session, { renders: value.screens.map((screen) => ({ key: designImportScreenKey(screen), attachmentId: screen.attachmentId })) })
  await expect(save(session, { action: 'complete', selectedKeys: value.screens.map(designImportScreenKey) })).rejects.toMatchObject({ status: 400 })
  session = await save(session, { action: 'complete', selectedKeys: value.screens.slice(1).map(designImportScreenKey) })
  expect(session.progress.screens).toHaveLength(4)
  expect(store.projects[0].draftSpec?.screens).toHaveLength(3)
  expect(store.projects[0].draftSpec?.screens).toEqual(expect.arrayContaining([expect.objectContaining({ figmaVersion: 'revision-2' })]))
})

test('stale session tokens reject edits and a new session supersedes older partial progress', async () => {
  const first = await start()
  await expect(save({ ...first, updatedAt: '2020-01-01T00:00:00.000Z' }, { action: 'cancel' })).rejects.toMatchObject({ status: 409 })
  const different = manifest()
  different.screens[0].name = 'Changed design'
  await create.execute({ projectId: PROJECT_ID, manifest: different }, harness(store.projects[0].updatedAt.toISOString()).ctx)
  await expect(save(first, { action: 'complete' })).rejects.toMatchObject({ status: 400 })
})

test('a failed replacement preserves the successful upload across reload and blocks completion until retry succeeds', async () => {
  let session = await start()
  const screen = manifest().screens[0]
  const key = designImportScreenKey(screen)
  session = await save(session, { renders: [{ key, attachmentId: screen.attachmentId }], selectedKeys: [key] })
  const replacementId = 'b0000000-0000-4000-8000-000000000001'
  store.attachments.push({ ...store.attachments[0], id: replacementId, storedSha256: 'f'.repeat(64) })
  session = await save(session, { renders: [{ key, attachmentId: replacementId }], action: 'complete' })
  expect(session.status).toBe('partial')
  const restored = await createDeliveryOsDesignImportQueries(harness().em as unknown as EntityManager).read(scope, PROJECT_ID, session.id)
  expect(restored.progress.screens[0]).toMatchObject({ screen: { attachmentId: screen.attachmentId, sha256: screen.sha256 }, errorCode: 'attachment_hash_mismatch' })
  await expect(assertDraftImportComplete(harness().em as unknown as EntityManager, store.projects[0], scope)).rejects.toMatchObject({ status: 422 })
  session = await save(restored, { renders: [{ key, attachmentId: screen.attachmentId }], action: 'complete' })
  expect(session.status).toBe('complete')
  expect(session.progress.screens[0].errorCode).toBeNull()
})
