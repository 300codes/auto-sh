/** @jest-environment jsdom */
import * as React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
// NOT mocked on purpose: the point is to check the shape of the error the list
// actually throws, not the behaviour of a stubbed conflict surface.
import { extractOptimisticLockConflict } from '@open-mercato/ui/backend/utils/optimisticLock'
import DeliveryProjectListPage from '../page'
import { metadata } from '../page.meta'

type DataTableProps = {
  data: Array<Record<string, unknown>>
  columns: Array<{ accessorKey?: string; header?: unknown }>
  rowActions?: (row: Record<string, unknown>) => React.ReactNode
  pagination?: { pageSize?: number }
}

const apiCallMock = jest.fn()
const flashMock = jest.fn()
const confirmMock = jest.fn(async () => true)
const surfaceRecordConflictMock = jest.fn(() => false)
const dataTableMock = jest.fn()
const scopedHeaderCalls: Array<Record<string, string>> = []

const translate = (key: string) => key
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => translate }))
jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({ useOrganizationScopeVersion: () => 0 }))
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}))
jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: (props: DataTableProps) => {
    dataTableMock(props)
    return (
      <div data-testid="data-table">
        {props.data.map((row) => (
          <div key={String(row.id)}>{props.rowActions?.(row)}</div>
        ))}
      </div>
    )
  },
}))
jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: ({ items }: { items: Array<{ id?: string; label: string; onSelect?: () => void }> }) => (
    <>
      {items.map((item) => (
        <button key={item.id} type="button" data-testid={`row-action-${item.id}`} onClick={item.onSelect}>
          {item.label}
        </button>
      ))}
    </>
  ),
}))
jest.mock('@open-mercato/ui/backend/filters/ListEmptyState', () => ({ ListEmptyState: () => <div data-testid="empty" /> }))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: (...args: unknown[]) => flashMock(...args) }))
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: confirmMock, ConfirmDialogElement: null }),
}))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: async () => false,
  }),
}))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: (...args: unknown[]) => surfaceRecordConflictMock(...(args as [])),
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  withScopedApiRequestHeaders: (headers: Record<string, string>, run: () => Promise<unknown>) => {
    scopedHeaderCalls.push(headers)
    return run()
  },
}))

const projectId = '11111111-1111-4111-8111-111111111111'
const otherProjectId = '22222222-2222-4222-8222-222222222222'
const updatedAt = '2026-09-19T10:00:00.000Z'

function projectRow(overrides: Record<string, unknown> = {}) {
  return {
    id: projectId,
    name: 'Delivery list project',
    inputMode: 'from_brief',
    brief: null,
    targetProfileId: 'react-vite',
    targetProfileVersion: 1,
    repositoryRef: null,
    activeBaselineId: null,
    createdAt: updatedAt,
    updatedAt,
    archivedAt: null,
    ...overrides,
  }
}

function listResponse(items: Array<Record<string, unknown>>) {
  return { ok: true, status: 200, result: { items, total: items.length, totalPages: 1 } }
}

function lastListUrl(): string {
  const calls = apiCallMock.mock.calls.filter(([url]) => typeof url === 'string' && !String(url).includes('?id='))
  return String(calls.at(-1)?.[0] ?? '')
}

async function renderList(items: Array<Record<string, unknown>>): Promise<void> {
  apiCallMock.mockResolvedValue(listResponse(items))
  render(<DeliveryProjectListPage />)
  await waitFor(() => expect(dataTableMock.mock.calls.at(-1)?.[0].data).toHaveLength(items.length))
}

beforeEach(() => {
  apiCallMock.mockReset()
  flashMock.mockReset()
  confirmMock.mockClear()
  surfaceRecordConflictMock.mockReset()
  surfaceRecordConflictMock.mockReturnValue(false)
  dataTableMock.mockClear()
  scopedHeaderCalls.length = 0
})

it('guards the page with the same feature as the project list API', () => {
  expect(metadata).toMatchObject({ requireAuth: true, requireFeatures: ['delivery_os.projects.view'] })
  expect(metadata.pageGroupKey).toBe('delivery_os.nav.group')
  expect(metadata.pageTitleKey).toBe('delivery_os.nav.projects')
  expect((metadata as { navHidden?: boolean }).navHidden).toBeUndefined()
})

it('maps list state onto the query parameters the OSS list schema accepts', async () => {
  await renderList([projectRow()])
  const initialUrl = new URL(lastListUrl(), 'http://localhost')
  expect(initialUrl.pathname).toBe('/api/delivery_os/projects')
  expect(initialUrl.searchParams.get('page')).toBe('1')
  expect(initialUrl.searchParams.get('pageSize')).toBe('50')
  expect(initialUrl.searchParams.get('includeArchived')).toBeNull()
  expect(initialUrl.searchParams.get('withDeleted')).toBeNull()

  const props = dataTableMock.mock.calls.at(-1)?.[0]
  await act(async () => { props.onSearchChange('delivery') })
  await act(async () => {
    dataTableMock.mock.calls.at(-1)?.[0].onFiltersApply({ includeArchived: true })
  })
  await waitFor(() => {
    const url = new URL(lastListUrl(), 'http://localhost')
    expect(url.searchParams.get('search')).toBe('delivery')
    expect(url.searchParams.get('includeArchived')).toBe('true')
    expect(url.searchParams.get('withDeleted')).toBeNull()
    expect(url.searchParams.get('page')).toBe('1')
  })
})

it('keeps derived status and progress off the list, which the list API does not return', async () => {
  await renderList([projectRow()])
  const accessors = (dataTableMock.mock.calls.at(-1)?.[0].columns ?? []).map((column: { accessorKey?: string }) => column.accessorKey)
  expect(accessors).toEqual(['name', 'inputMode', 'targetProfileId', 'repositoryRef', 'updatedAt'])
  expect(accessors).not.toContain('status')
  expect(accessors).not.toContain('progress')
  expect(dataTableMock.mock.calls.at(-1)?.[0].pagination.pageSize).toBeLessThanOrEqual(100)
  expect(dataTableMock.mock.calls.at(-1)?.[0].exporter).toBeUndefined()
})

it('offers stable row action ids and no edit action, which UI-03 owns', async () => {
  await renderList([projectRow()])
  expect(screen.getByTestId('row-action-open')).toBeTruthy()
  expect(screen.getByTestId('row-action-delete')).toBeTruthy()
  expect(screen.queryByTestId('row-action-edit')).toBeNull()
})

it('archives with the optimistic-lock header and reloads the list on 200', async () => {
  await renderList([projectRow()])
  apiCallMock.mockResolvedValue({ ok: true, status: 200, result: { ok: true } })
  await act(async () => { screen.getByTestId('row-action-delete').click() })
  await waitFor(() => expect(flashMock).toHaveBeenCalledWith('delivery_os.projects.list.archive.success', 'success'))

  const deleteCall = apiCallMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE')
  expect(deleteCall?.[0]).toBe(`/api/delivery_os/projects?id=${projectId}`)
  expect(scopedHeaderCalls.at(-1)).toEqual({ [OPTIMISTIC_LOCK_HEADER_NAME]: updatedAt })
})

it('routes a stale-version 409 to the shared conflict surface instead of a generic error', async () => {
  await renderList([projectRow()])
  surfaceRecordConflictMock.mockReturnValue(true)
  apiCallMock.mockResolvedValue({
    ok: false,
    status: 409,
    result: { error: 'record_modified', code: 'optimistic_lock_conflict', currentUpdatedAt: updatedAt, expectedUpdatedAt: updatedAt },
  })
  await act(async () => { screen.getByTestId('row-action-delete').click() })
  await waitFor(() => expect(surfaceRecordConflictMock).toHaveBeenCalled())
  expect(extractOptimisticLockConflict(surfaceRecordConflictMock.mock.calls[0][0])).toBeTruthy()
  expect(flashMock).not.toHaveBeenCalledWith('delivery_os.projects.list.archive.error', 'error')
  expect(flashMock).not.toHaveBeenCalledWith('delivery_os.projects.list.archive.success', 'success')
})

it('names the blocking attempt on a domain 409 rather than claiming a concurrent edit', async () => {
  await renderList([projectRow()])
  apiCallMock.mockResolvedValue({ ok: false, status: 409, result: { error: 'Attempt active', code: 'attempt_active', details: [] } })
  await act(async () => { screen.getByTestId('row-action-delete').click() })
  await waitFor(() => expect(flashMock).toHaveBeenCalledWith('delivery_os.projects.list.archive.blocked', 'error'))
  // A domain 409 must NOT look like a stale-version conflict to the shared surface.
  expect(extractOptimisticLockConflict(surfaceRecordConflictMock.mock.calls[0][0])).toBeNull()
})

it('reports a 404 as a scope loss and refreshes the list', async () => {
  await renderList([projectRow()])
  const listCallsBefore = apiCallMock.mock.calls.length
  apiCallMock.mockResolvedValue({ ok: false, status: 404, result: { error: 'Not found', code: 'not_found', details: [] } })
  await act(async () => { screen.getByTestId('row-action-delete').click() })
  await waitFor(() => expect(flashMock).toHaveBeenCalledWith('delivery_os.projects.list.archive.notFound', 'error'))
  await waitFor(() => expect(apiCallMock.mock.calls.length).toBeGreaterThan(listCallsBefore + 1))
})

it('never issues a DELETE for a row that carries no record version', async () => {
  await renderList([projectRow({ id: otherProjectId, updatedAt: null })])
  expect(screen.queryByTestId('row-action-delete')).toBeNull()
  expect(apiCallMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE')).toBe(false)
  expect(scopedHeaderCalls).toHaveLength(0)
})

it('hides the archive action for an already archived project', async () => {
  await renderList([projectRow({ archivedAt: updatedAt })])
  expect(screen.queryByTestId('row-action-delete')).toBeNull()
  expect(screen.getByTestId('row-action-open')).toBeTruthy()
})

it('surfaces a load failure instead of rendering an empty list as success', async () => {
  apiCallMock.mockResolvedValue({ ok: false, status: 500, result: null })
  render(<DeliveryProjectListPage />)
  await waitFor(() => expect(dataTableMock.mock.calls.at(-1)?.[0].error).toBe('delivery_os.projects.list.error.load'))
  expect(dataTableMock.mock.calls.at(-1)?.[0].data).toHaveLength(0)
})
