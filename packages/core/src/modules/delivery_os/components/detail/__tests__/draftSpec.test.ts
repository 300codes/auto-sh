import type { ScreenRef } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { draftSpecV1Schema } from '@open-mercato/core/modules/delivery_os/data/validators'
import {
  appendComment,
  appendScreen,
  countOpenComments,
  nextCommentId,
  readDraftSpec,
  removeScreen,
  resolveComment,
} from '../draftSpec'

const attachmentId = '55555555-5555-4555-8555-555555555555'
const otherAttachmentId = '66666666-6666-4666-8666-666666666666'
const hash = 'a'.repeat(64)

function screen(overrides: Partial<ScreenRef> = {}): ScreenRef {
  return {
    name: 'Service list',
    fileKey: '5wOkFtN959W4MFmgRuaU8S',
    nodeId: '3:2',
    viewport: { width: 1440, height: 1024 },
    attachmentId,
    sha256: hash,
    capturedAt: '2026-09-19T10:00:00.000Z',
    ...overrides,
  }
}

const emptyDraft = draftSpecV1Schema.parse({})

describe('readDraftSpec', () => {
  it('parses an empty draft into the schema defaults so a fresh project is editable', () => {
    const read = readDraftSpec({})
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.draft.screens).toEqual([])
    expect(read.draft.comments).toEqual([])
  })

  it('refuses a draft it cannot parse rather than replacing it with a clean object', () => {
    // `requirements` is an array in the contract; a string there means the stored
    // draft carries something this UI does not understand.
    expect(readDraftSpec({ requirements: 'not an array' })).toEqual({ ok: false, reason: 'unparsable' })
  })
})

describe('appendScreen', () => {
  it('adds the screen and leaves the rest of the draft untouched', () => {
    const next = appendScreen({ ...emptyDraft, architectureSummary: 'kept' }, screen())
    expect(next.screens).toHaveLength(1)
    expect(next.architectureSummary).toBe('kept')
  })

  it('replaces an entry for the same attachment instead of duplicating it', () => {
    const once = appendScreen(emptyDraft, screen())
    const twice = appendScreen(once, screen({ name: 'Service list v2' }))
    expect(twice.screens).toHaveLength(1)
    expect(twice.screens[0].name).toBe('Service list v2')
  })

  it('keeps two different renders of the same node as two screens', () => {
    const both = appendScreen(appendScreen(emptyDraft, screen()), screen({ attachmentId: otherAttachmentId }))
    expect(both.screens.map((entry) => entry.attachmentId)).toEqual([attachmentId, otherAttachmentId])
  })
})

describe('removeScreen', () => {
  it('drops the comments bound to the removed screen, because they would name a screen the draft no longer has', () => {
    const withScreen = appendScreen(emptyDraft, screen())
    const commented = appendComment(withScreen, { id: 'C-1', screenAttachmentId: attachmentId, body: 'Tighten the spacing' })
    expect(commented.ok).toBe(true)
    if (!commented.ok) return
    const cleaned = removeScreen(commented.draft, attachmentId)
    expect(cleaned.screens).toEqual([])
    expect(cleaned.comments).toEqual([])
  })
})

describe('appendComment', () => {
  it('refuses a comment pointing at a screen the draft does not carry', () => {
    expect(appendComment(emptyDraft, { id: 'C-1', screenAttachmentId: attachmentId, body: 'Nowhere to pin this' }))
      .toEqual({ ok: false, reason: 'unknown_screen' })
  })

  it('refuses a duplicate comment id, which the draft contract rejects too', () => {
    const withScreen = appendScreen(emptyDraft, screen())
    const first = appendComment(withScreen, { id: 'C-1', screenAttachmentId: attachmentId, body: 'One' })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(appendComment(first.draft, { id: 'C-1', screenAttachmentId: attachmentId, body: 'Two' }))
      .toEqual({ ok: false, reason: 'duplicate_id' })
  })

  it('produces a draft the contract accepts, with the comment open and unanchored', () => {
    const withScreen = appendScreen(emptyDraft, screen())
    const added = appendComment(withScreen, { id: 'C-1', screenAttachmentId: attachmentId, body: 'Tighten the spacing' })
    expect(added.ok).toBe(true)
    if (!added.ok) return
    expect(draftSpecV1Schema.safeParse(added.draft).success).toBe(true)
    expect(added.draft.comments[0]).toMatchObject({ status: 'open', anchor: null })
  })
})

describe('resolveComment', () => {
  it('moves the comment to resolved with its resolution and stops counting it as open', () => {
    const withScreen = appendScreen(emptyDraft, screen())
    const added = appendComment(withScreen, { id: 'C-1', screenAttachmentId: attachmentId, body: 'Tighten the spacing' })
    expect(added.ok).toBe(true)
    if (!added.ok) return
    expect(countOpenComments(added.draft)).toBe(1)
    const resolved = resolveComment(added.draft, 'C-1', 'Spacing reduced to 8px')
    expect(countOpenComments(resolved)).toBe(0)
    expect(resolved.comments[0]).toMatchObject({ status: 'resolved', resolution: 'Spacing reduced to 8px' })
    expect(draftSpecV1Schema.safeParse(resolved).success).toBe(true)
  })
})

describe('nextCommentId', () => {
  it('produces a stable id the contract accepts — a bare UUID would be refused for starting with a digit', () => {
    const withScreen = appendScreen(emptyDraft, screen())
    const first = appendComment(withScreen, { id: nextCommentId(withScreen), screenAttachmentId: attachmentId, body: 'One' })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = nextCommentId(first.draft)
    expect(second).not.toBe(first.draft.comments[0].id)
    expect(second).toMatch(/^[A-Za-z][A-Za-z0-9._-]{0,63}$/)
  })
})
