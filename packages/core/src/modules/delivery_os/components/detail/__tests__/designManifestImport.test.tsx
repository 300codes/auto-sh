/** @jest-environment jsdom */
import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { DesignManifestImport } from '../DesignManifestImport'
import { loadDesignManifestFixture } from '../../../lib/fixtures'
import { DESIGN_IMPORT_SCHEMA_VERSION, designImportScreenKey, type DesignImportSession } from '../../../lib/designImportContracts'
const read = jest.fn()
const write = jest.fn()
const headers = jest.fn()
const guarded = jest.fn(async ({ operation }: { operation: () => Promise<unknown> }) => operation())
const translate = (key: string) => key
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => translate, useOptionalT: () => translate }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: (...args: unknown[]) => read(...args), apiCallOrThrow: (...args: unknown[]) => write(...args), withScopedApiRequestHeaders: (value: unknown, operation: () => Promise<unknown>) => { headers(value); return operation() } }))
jest.mock('@open-mercato/ui/backend/CrudForm', () => ({ CrudForm: () => <div data-testid="session-create-form" /> }))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({ useGuardedMutation: () => ({ runMutation: guarded, retryLastMutation: async () => true }) }))
const changed = jest.fn(async () => undefined)
let session: DesignImportSession
beforeEach(() => {
  read.mockReset(); write.mockReset(); headers.mockClear(); changed.mockClear(); guarded.mockClear()
  const manifest = loadDesignManifestFixture()
  manifest.screens = manifest.screens.slice(0, 1)
  session = { schemaVersion: DESIGN_IMPORT_SCHEMA_VERSION, id: '77777777-7777-4777-8777-777777777777', projectId: '44444444-4444-4444-8444-444444444444', manifestHash: 'a'.repeat(64), manifest, progress: { screens: [{ key: designImportScreenKey(manifest.screens[0]), screen: null, errorCode: null }], selectedKeys: [] }, status: 'partial', createdAt: '2026-09-19T10:00:00.000Z', updatedAt: '2026-09-19T11:00:00.000Z' }
  read.mockImplementation(async () => ({ ok: true, result: { schemaVersion: DESIGN_IMPORT_SCHEMA_VERSION, items: [session] } }))
  write.mockImplementation(async (_url: string, options: { body: string }) => {
    const body = JSON.parse(options.body)
    if (body.selectedKeys) session = { ...session, progress: { ...session.progress, selectedKeys: body.selectedKeys } }
    if (body.action === 'complete') session = { ...session, status: 'complete' }
    return { ok: true, result: session }
  })
})
function subject(manage = true) { return <DesignManifestImport projectId={session.projectId} projectUpdatedAt="2026-09-19T09:00:00.000Z" canManage={manage} onChanged={changed} /> }
test('partial progress restores on reload; completion stays disabled until verified renders and explicit version selection', async () => {
  const view = render(subject())
  await screen.findByTestId('design-import-progress')
  expect(screen.getByRole('button', { name: 'delivery_os.designImport.complete' })).toBeDisabled()
  expect(screen.getByText('delivery_os.designImport.missingRender')).toBeVisible()
  view.unmount()
  session = { ...session, progress: { ...session.progress, screens: [{ ...session.progress.screens[0], screen: session.manifest.screens[0] }] } }
  render(subject())
  await screen.findByAltText(session.manifest.screens[0].name)
  expect(write).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'delivery_os.designImport.complete' })).toBeDisabled()
  await act(async () => fireEvent.click(screen.getByRole('radio')))
  expect(headers).toHaveBeenLastCalledWith({ 'x-om-ext-optimistic-lock-expected-updated-at': session.updatedAt })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'delivery_os.designImport.complete' })))
  expect(JSON.parse(write.mock.calls[1][1].body)).toEqual({ action: 'complete' })
  expect(guarded).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole('button', { name: 'delivery_os.designImport.complete' })).toBeNull()
})
test('view-only history restores verified renders and exposes no import or mutation controls', async () => {
  session = { ...session, status: 'complete', progress: { screens: [{ ...session.progress.screens[0], screen: session.manifest.screens[0] }], selectedKeys: [session.progress.screens[0].key] } }
  render(subject(false))
  await screen.findByAltText(session.manifest.screens[0].name)
  expect(screen.queryByTestId('session-create-form')).toBeNull()
  expect(screen.queryByLabelText('delivery_os.designImport.render')).toBeNull()
  expect(screen.getByRole('radio')).toBeDisabled()
  expect(write).not.toHaveBeenCalled()
})

test('a failed replacement displays the preserved render but cannot complete until verification succeeds', async () => {
  session = { ...session, progress: { screens: [{ ...session.progress.screens[0], screen: session.manifest.screens[0], errorCode: 'attachment_hash_mismatch' }], selectedKeys: [session.progress.screens[0].key] } }
  render(subject())
  await screen.findByAltText(session.manifest.screens[0].name)
  expect(screen.getByRole('alert')).toHaveTextContent('delivery_os.designImport.verificationError')
  expect(screen.getByRole('button', { name: 'delivery_os.designImport.complete' })).toBeDisabled()
  expect(write).not.toHaveBeenCalled()
})
