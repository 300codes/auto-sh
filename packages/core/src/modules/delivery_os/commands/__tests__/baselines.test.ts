jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

const mockFindWithDecryption = jest.fn()
const mockFindOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

const mockEmitDeliveryOsEvent = jest.fn(async (..._args: unknown[]) => undefined)

jest.mock('../../events', () => ({
  emitDeliveryOsEvent: (...args: unknown[]) => mockEmitDeliveryOsEvent(...args),
}))

import '@open-mercato/core/modules/delivery_os/commands'
import { LockMode } from '@mikro-orm/core'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { DeliveryBaseline, DeliveryProject } from '../../data/entities'
import { baselineContentV1Schema } from '../../lib/contracts'
import { MAX_BASELINE_ATTACHMENT_BYTES } from '../../lib/designReview'
import { hashCanonical } from '../../lib/hash'
import type { BaselineCommandResult } from '../baselines'
import {
  catchHttpError,
  detailCodes,
  draftAttachmentRows,
  emptyStore,
  expectFrozenBody,
  FOREIGN_ORG_ID,
  getHandler,
  makeDraft,
  makeHarness,
  makeProject,
  matches,
  PROJECT_ID,
  rowsFor,
  STALE_UPDATED_AT,
  STORED_FILE_SIZE,
  UPDATED_AT,
  type Row,
  type Store,
} from './baselineTestKit'

let store: Store

const create = getHandler<BaselineCommandResult>('delivery_os.baselines.create')
const currentHeaders = { [OPTIMISTIC_LOCK_HEADER_NAME]: UPDATED_AT.toISOString() }
const input = { projectId: PROJECT_ID, source: 'manual' }

function seedProject(draftOverrides: Row = {}): void {
  const draftSpec = makeDraft(draftOverrides)
  store = { ...emptyStore(), projects: [makeProject({ draftSpec })], attachments: draftAttachmentRows(draftSpec) }
}

beforeEach(() => {
  mockEmitDeliveryOsEvent.mockClear()
  mockFindOneWithDecryption.mockReset()
  mockFindWithDecryption.mockReset()
  mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Row) =>
    rowsFor(store, entity).find((row) => matches(row, where)) ?? null,
  )
  mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Row) =>
    rowsFor(store, entity).filter((row) => matches(row, where)),
  )
  seedProject()
})

describe('delivery_os.baselines.create', () => {
  it('freezes the draft into version 1 with a canonical hash under the project lock', async () => {
    const { ctx, em } = makeHarness(store, { headers: currentHeaders })
    const result = await create.execute(input, ctx)

    expect(result).toMatchObject({ projectId: PROJECT_ID, version: 1, duplicate: false, openCommentIds: [] })
    expect(store.baselines).toHaveLength(1)
    const [row] = store.baselines
    expect(baselineContentV1Schema.safeParse(row.content).success).toBe(true)
    expect(row.contentHash).toBe(hashCanonical(row.content))
    expect(result.contentHash).toBe(row.contentHash)
    expect(row.source).toBe('manual')
    expect(row.attachmentIds).toEqual(store.attachments.map((attachment) => attachment.id))
    const lockedLoad = mockFindOneWithDecryption.mock.calls.find(
      ([, entity, , options]) => entity === DeliveryProject && options !== undefined,
    )
    expect(lockedLoad?.[3]).toEqual({ lockMode: LockMode.PESSIMISTIC_WRITE })
    expect(em.transactional).toHaveBeenCalledTimes(1)
    expect(mockEmitDeliveryOsEvent).not.toHaveBeenCalled()
    expect(store.projects[0].updatedAt).toBe(UPDATED_AT)
  })

  it('runs no query after the row is persisted', async () => {
    const { ctx, em } = makeHarness(store, { headers: currentHeaders })
    await create.execute(input, ctx)
    const persistOrder = em.persist.mock.invocationCallOrder[0]
    const lastQuery = Math.max(
      ...mockFindWithDecryption.mock.invocationCallOrder,
      ...mockFindOneWithDecryption.mock.invocationCallOrder,
    )
    expect(lastQuery).toBeLessThan(persistOrder)
  })

  it('returns the existing baseline for an identical draft and writes nothing', async () => {
    const first = await create.execute(input, makeHarness(store, { headers: currentHeaders }).ctx)
    const second = makeHarness(store, { headers: currentHeaders })
    const replay = await create.execute(input, second.ctx)

    expect(replay).toMatchObject({ baselineId: first.baselineId, version: 1, duplicate: true })
    expect(store.baselines).toHaveLength(1)
    expect(second.em.persist).not.toHaveBeenCalled()
    const log = await create.buildLog?.({ input, result: replay, ctx: second.ctx, snapshots: {} })
    expect(log).toBeNull()
  })

  it('increments the version when the draft changed', async () => {
    await create.execute(input, makeHarness(store, { headers: currentHeaders }).ctx)
    store.projects[0].draftSpec = makeDraft({ planSummary: 'Three tasks now' })
    const result = await create.execute(input, makeHarness(store, { headers: currentHeaders }).ctx)

    expect(result).toMatchObject({ version: 2, duplicate: false })
    expect(store.baselines.map((baseline) => baseline.version)).toEqual([1, 2])
  })

  it('excludes open comments from the content and reports their ids', async () => {
    seedProject({
      comments: [
        { id: 'C-open', screenAttachmentId: null, anchor: null, body: 'Is the price gross?', status: 'open' },
        { id: 'C-done', screenAttachmentId: null, anchor: null, body: 'Align right', status: 'resolved', resolution: 'Done' },
      ],
    })
    const result = await create.execute(input, makeHarness(store, { headers: currentHeaders }).ctx)
    const content = baselineContentV1Schema.parse(store.baselines[0].content)

    expect(result.openCommentIds).toEqual(['C-open'])
    expect(content.resolvedComments.map((comment) => comment.id)).toEqual(['C-done'])
  })

  it('recovers a unique violation by returning the winning baseline', async () => {
    const { ctx, em } = makeHarness(store, { headers: currentHeaders })
    em.transactional.mockImplementationOnce(async (work: (tx: typeof em) => Promise<unknown>) => {
      await work(em)
      throw Object.assign(new Error('duplicate key value'), { code: '23505', constraint: 'delivery_baselines_project_hash_uq' })
    })
    const result = await create.execute(input, ctx)
    expect(result).toMatchObject({ duplicate: true, version: 1 })
  })

  it('rethrows a unique violation when no baseline carries the hash', async () => {
    const { ctx, em } = makeHarness(store, { headers: currentHeaders })
    em.persist.mockImplementation(() => undefined)
    em.transactional.mockImplementationOnce(async (work: (tx: typeof em) => Promise<unknown>) => {
      await work(em)
      throw Object.assign(new Error('duplicate key value'), { code: '23505' })
    })
    await expect(create.execute(input, ctx)).rejects.toMatchObject({ code: '23505' })
  })

  it('answers 422 for a draft without acceptance criteria, requirements or a render', async () => {
    seedProject({ requirements: [], acceptanceCriteria: [], acTestMap: {}, manualChecks: {}, screens: [] })
    const error = await catchHttpError(() => create.execute(input, makeHarness(store, { headers: currentHeaders }).ctx))
    expectFrozenBody(error, 422, 'missing_acceptance_criteria')
    expect(detailCodes(error)).toEqual(['missing_requirements', 'missing_acceptance_criteria', 'missing_render'])
    expect(store.baselines).toHaveLength(0)
  })

  it('answers 422 missing_render for a draft without screens', async () => {
    seedProject({ screens: [] })
    const error = await catchHttpError(() => create.execute(input, makeHarness(store, { headers: currentHeaders }).ctx))
    expectFrozenBody(error, 422, 'missing_render')
  })

  it('answers 422 for a foreign or missing attachment without telling them apart', async () => {
    store.attachments = draftAttachmentRows(store.projects[0].draftSpec, FOREIGN_ORG_ID)
    const foreign = await catchHttpError(() => create.execute(input, makeHarness(store, { headers: currentHeaders }).ctx))
    expectFrozenBody(foreign, 422, 'attachment_scope_mismatch')
    expect((foreign.body.details as Array<{ path: string }>).map((detail) => detail.path)).toEqual([
      'screens.0.attachmentId',
      'attachments.0.attachmentId',
    ])

    store.attachments = []
    const missingHarness = makeHarness(store, { headers: currentHeaders })
    const missing = await catchHttpError(() => create.execute(input, missingHarness.ctx))
    expect(missing.body).toEqual(foreign.body)
    expect(missingHarness.ctx.container.resolve('deliveryOsAttachmentInspector')).not.toHaveBeenCalled()

    const ownRows = draftAttachmentRows(store.projects[0].draftSpec)
    for (const foreignScope of [{ tenantId: FOREIGN_ORG_ID }, { organizationId: null }, { tenantId: null }]) {
      store.attachments = ownRows.map((row) => ({ ...row, ...foreignScope }))
      const harness = makeHarness(store, { headers: currentHeaders })
      const error = await catchHttpError(() => create.execute(input, harness.ctx))
      expect(error.body).toEqual(foreign.body)
      expect(harness.ctx.container.resolve('deliveryOsAttachmentInspector')).not.toHaveBeenCalled()
    }
    expect(store.baselines).toHaveLength(0)
  })

  it('freezes the verified size and type of every attachment into the content', async () => {
    const harness = makeHarness(store, { headers: currentHeaders })
    const result = await create.execute(input, harness.ctx)
    const [row] = store.baselines
    const content = baselineContentV1Schema.parse(row.content)

    expect(content.screens[0]).toMatchObject({
      attachmentId: store.attachments[0].id,
      sha256: store.attachments[0].storedSha256,
      sizeBytes: STORED_FILE_SIZE,
      mimeType: 'image/png',
    })
    expect(content.attachments[0]).toMatchObject({ sizeBytes: STORED_FILE_SIZE, mimeType: 'image/png' })
    expect(result.contentHash).toBe(hashCanonical(content))
    const inspector = harness.ctx.container.resolve('deliveryOsAttachmentInspector') as jest.Mock
    expect(inspector).toHaveBeenCalledTimes(1)
    expect(inspector.mock.calls[0][1]).toEqual({ tenantId: store.attachments[0].tenantId, organizationId: store.attachments[0].organizationId })

    const replay = await create.execute(input, makeHarness(store, { headers: currentHeaders }).ctx)
    expect(replay).toMatchObject({ baselineId: result.baselineId, duplicate: true })
    expect(store.baselines).toHaveLength(1)
  })

  it('answers 422 attachment_hash_mismatch when the stored bytes differ from the declared sha256', async () => {
    store.attachments[0].storedSha256 = 'c'.repeat(64)
    const error = await catchHttpError(() => create.execute(input, makeHarness(store, { headers: currentHeaders }).ctx))
    expectFrozenBody(error, 422, 'attachment_hash_mismatch')
    expect(error.body.details).toEqual([
      expect.objectContaining({ path: 'screens.0.sha256', code: 'sha256_mismatch' }),
      expect.objectContaining({ path: 'attachments.0.sha256', code: 'sha256_mismatch' }),
    ])
    expect(store.baselines).toHaveLength(0)
  })

  it('answers 422 attachment_hash_mismatch for a declared size that is not the stored size', async () => {
    const screens = (makeDraft().screens as Row[]).map((screen) => ({ ...screen, sizeBytes: 1 }))
    seedProject({ screens })
    const error = await catchHttpError(() => create.execute(input, makeHarness(store, { headers: currentHeaders }).ctx))
    expectFrozenBody(error, 422, 'attachment_hash_mismatch')
    expect(detailCodes(error)).toEqual(['size_mismatch'])
  })

  it('answers 422 for an oversize render without reading its bytes', async () => {
    store.attachments[0].fileSize = MAX_BASELINE_ATTACHMENT_BYTES + 1
    const harness = makeHarness(store, { headers: currentHeaders })
    const error = await catchHttpError(() => create.execute(input, harness.ctx))
    expectFrozenBody(error, 422, 'missing_render')
    expect(detailCodes(error)).toEqual(['attachment_too_large', 'attachment_too_large'])
    expect(harness.ctx.container.resolve('deliveryOsAttachmentInspector')).not.toHaveBeenCalled()
    expect(store.baselines).toHaveLength(0)
  })

  it('answers 422 for an oversize or disallowed file that is only listed under attachments', async () => {
    const notesId = '77777777-7777-4777-8777-777777777777'
    const notesSha = 'd'.repeat(64)
    seedProject({ attachments: [{ attachmentId: notesId, sha256: notesSha }] })
    const notes = store.attachments.find((row) => row.id === notesId) as Row
    notes.mimeType = 'application/pdf'
    notes.detectedMimeType = 'application/pdf'
    await create.execute(input, makeHarness(store, { headers: currentHeaders }).ctx)
    expect(store.baselines).toHaveLength(1)

    store.baselines = []
    notes.fileSize = MAX_BASELINE_ATTACHMENT_BYTES + 1
    const oversize = await catchHttpError(() => create.execute(input, makeHarness(store, { headers: currentHeaders }).ctx))
    expectFrozenBody(oversize, 422, 'attachment_hash_mismatch')
    expect(oversize.body.details).toEqual([expect.objectContaining({ path: 'attachments.0.attachmentId', code: 'attachment_too_large' })])

    notes.fileSize = STORED_FILE_SIZE
    notes.mimeType = 'application/zip'
    const zip = await catchHttpError(() => create.execute(input, makeHarness(store, { headers: currentHeaders }).ctx))
    expectFrozenBody(zip, 422, 'attachment_hash_mismatch')
    expect(detailCodes(zip)).toEqual(['unsupported_mime_type'])
    expect(store.baselines).toHaveLength(0)
  })

  it('answers 422 missing_render for a screen stored as a type that is not a raster image', async () => {
    for (const mimeType of ['image/svg+xml', 'application/pdf', 'text/html']) {
      store.attachments[0].mimeType = mimeType
      const error = await catchHttpError(() => create.execute(input, makeHarness(store, { headers: currentHeaders }).ctx))
      expectFrozenBody(error, 422, 'missing_render')
      expect(detailCodes(error)).toContain('unsupported_mime_type')
    }
    expect(store.baselines).toHaveLength(0)
  })

  it('answers 422 missing_render when the bytes are not the image the file claims to be', async () => {
    store.attachments[0].detectedMimeType = null
    const error = await catchHttpError(() => create.execute(input, makeHarness(store, { headers: currentHeaders }).ctx))
    expectFrozenBody(error, 422, 'missing_render')
    expect(detailCodes(error)).toEqual(['render_bytes_not_image'])
  })

  it('answers 422 and never a 500 when the stored file cannot be read', async () => {
    store.attachments[0].unreadable = true
    const error = await catchHttpError(() => create.execute(input, makeHarness(store, { headers: currentHeaders }).ctx))
    expectFrozenBody(error, 422, 'attachment_hash_mismatch')
    expect(detailCodes(error)).toEqual(['attachment_unreadable', 'attachment_unreadable'])
    expect(store.baselines).toHaveLength(0)
  })

  it('answers 422 temporary_url_only for a stored screen that only has a URL', async () => {
    const [screen] = makeDraft().screens as Row[]
    const { attachmentId: _attachmentId, ...withoutRender } = screen
    store.projects[0].draftSpec = { ...makeDraft(), screens: [{ ...withoutRender, imageUrl: 'https://example.test/render.png' }] }
    const error = await catchHttpError(() => create.execute(input, makeHarness(store, { headers: currentHeaders }).ctx))
    expectFrozenBody(error, 422, 'temporary_url_only')
  })

  it('rejects duplicate screens and comments on unknown screens before touching attachments', async () => {
    const [screen] = makeDraft().screens as Row[]
    seedProject({ screens: [screen, screen] })
    const duplicate = makeHarness(store, { headers: currentHeaders })
    expectFrozenBody(await catchHttpError(() => create.execute(input, duplicate.ctx)), 422, 'duplicate_stable_id')
    expect(duplicate.ctx.container.resolve('deliveryOsAttachmentInspector')).not.toHaveBeenCalled()

    seedProject({
      comments: [{ id: 'C-1', screenAttachmentId: '77777777-7777-4777-8777-777777777777', anchor: null, body: 'Spacing?', status: 'open' }],
    })
    const orphan = await catchHttpError(() => create.execute(input, makeHarness(store, { headers: currentHeaders }).ctx))
    expectFrozenBody(orphan, 422, 'foreign_reference')
    expect(detailCodes(orphan)).toEqual(['unknown_screen'])
    expect(store.baselines).toHaveLength(0)
  })

  it('answers a client error and never a 500 for an unreadable stored draft', async () => {
    store.projects[0].draftSpec = { requirements: 'not-a-list' }
    const error = await catchHttpError(() => create.execute(input, makeHarness(store, { headers: currentHeaders }).ctx))
    expectFrozenBody(error, 400, 'validation_failed')
  })

  it('requires the project lock header', async () => {
    const error = await catchHttpError(() => create.execute(input, makeHarness(store).ctx))
    expectFrozenBody(error, 428, 'optimistic_lock_required')

    const garbage = makeHarness(store, { headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: 'not-a-date' } })
    const invalid = await catchHttpError(() => create.execute(input, garbage.ctx))
    expectFrozenBody(invalid, 400, 'validation_failed')
    expect(detailCodes(invalid)).toEqual(['optimistic_lock_invalid'])
    expect(store.baselines).toHaveLength(0)
  })

  it('answers the platform 409 for a stale project even when the lock is switched off', async () => {
    const previous = process.env.OM_OPTIMISTIC_LOCK
    process.env.OM_OPTIMISTIC_LOCK = 'off'
    try {
      const { ctx } = makeHarness(store, { headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: STALE_UPDATED_AT } })
      const error = await catchHttpError(() => create.execute(input, ctx))
      expect(error.status).toBe(409)
      expect(error.body).toMatchObject({ code: 'optimistic_lock_conflict', currentUpdatedAt: UPDATED_AT.toISOString() })
    } finally {
      if (previous === undefined) delete process.env.OM_OPTIMISTIC_LOCK
      else process.env.OM_OPTIMISTIC_LOCK = previous
    }
    expect(store.baselines).toHaveLength(0)
  })

  it('answers 404 for a project of another organization and for an archived project', async () => {
    const foreign = makeHarness(store, { orgId: FOREIGN_ORG_ID, headers: currentHeaders })
    expectFrozenBody(await catchHttpError(() => create.execute(input, foreign.ctx)), 404, 'not_found')

    store.projects[0].deletedAt = new Date()
    const archived = makeHarness(store, { headers: currentHeaders })
    expectFrozenBody(await catchHttpError(() => create.execute(input, archived.ctx)), 404, 'not_found')
    expect(store.baselines).toHaveLength(0)
  })

  it('rejects the proposal source until OSS-03 and an unknown source', async () => {
    const unknown = await catchHttpError(() =>
      create.execute({ projectId: PROJECT_ID, source: 'figma' }, makeHarness(store, { headers: currentHeaders }).ctx),
    )
    expectFrozenBody(unknown, 400, 'validation_failed')

    const proposal = await catchHttpError(() =>
      create.execute(
        { projectId: PROJECT_ID, source: 'requirements_proposal', manifest: {} },
        makeHarness(store, { headers: currentHeaders }).ctx,
      ),
    )
    expectFrozenBody(proposal, 400, 'validation_failed')
    expect(detailCodes(proposal)).toEqual(['unsupported_source'])
  })

  it('registers no update or delete command for baselines', () => {
    expect(commandRegistry.get('delivery_os.baselines.update')).toBeFalsy()
    expect(commandRegistry.get('delivery_os.baselines.delete')).toBeFalsy()
    expect(DeliveryBaseline.name).toBe('DeliveryBaseline')
  })
})
