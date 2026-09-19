'use client'

import * as React from 'react'
import Link from 'next/link'
import { z } from 'zod'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions, type RowActionItem } from '@open-mercato/ui/backend/RowActions'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { projectListItemSchema, type ProjectListItem } from '@open-mercato/core/modules/delivery_os/api/schemas'

const PAGE_SIZE = 50
const SORTABLE_FIELDS = ['name', 'createdAt', 'updatedAt'] as const
const MUTATION_CONTEXT_ID = 'delivery-projects-list:mutation'

const projectListResponseSchema = z.object({
  items: z.array(projectListItemSchema),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative().optional(),
  totalIsCapped: z.boolean().optional(),
})

type ArchiveMutationContext = {
  formId: string
  resourceKind: string
  resourceId: string
  retryLastMutation: () => Promise<boolean>
}

function hasUsableVersion(row: ProjectListItem): boolean {
  return typeof row.updatedAt === 'string' && row.updatedAt.trim().length > 0
}

function formatDateTime(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

export function DeliveryProjectListClient() {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const scopeVersion = useOrganizationScopeVersion()
  const { runMutation, retryLastMutation } = useGuardedMutation<ArchiveMutationContext>({
    contextId: MUTATION_CONTEXT_ID,
  })

  const [rows, setRows] = React.useState<ProjectListItem[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [totalIsCapped, setTotalIsCapped] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const [filters, setFilters] = React.useState<FilterValues>({})
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'createdAt', desc: true }])
  const [isLoading, setIsLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [reloadToken, setReloadToken] = React.useState(0)
  const requestSequence = React.useRef(0)

  const includeArchived = filters.includeArchived === true
  const sortState = sorting[0]
  const sortField = SORTABLE_FIELDS.includes(sortState?.id as (typeof SORTABLE_FIELDS)[number])
    ? (sortState.id as string)
    : 'createdAt'
  const sortDir = sortState?.desc === false ? 'asc' : 'desc'

  React.useEffect(() => {
    const sequence = ++requestSequence.current
    async function load(): Promise<void> {
      setIsLoading(true)
      try {
        const params = new URLSearchParams()
        params.set('page', String(page))
        params.set('pageSize', String(PAGE_SIZE))
        params.set('sortField', sortField)
        params.set('sortDir', sortDir)
        if (search) params.set('search', search)
        if (includeArchived) params.set('includeArchived', 'true')
        const call = await apiCall<unknown>(`/api/delivery_os/projects?${params.toString()}`)
        if (sequence !== requestSequence.current) return
        const parsed = projectListResponseSchema.safeParse(call.result)
        if (!call.ok || !parsed.success) {
          setRows([])
          setTotal(0)
          setTotalPages(1)
          setTotalIsCapped(false)
          setLoadError(t('delivery_os.projects.list.error.load'))
          return
        }
        setRows(parsed.data.items)
        setTotal(parsed.data.total)
        setTotalPages(parsed.data.totalPages ?? 1)
        setTotalIsCapped(parsed.data.totalIsCapped === true)
        setLoadError(null)
      } catch {
        if (sequence === requestSequence.current) {
          setRows([])
          setLoadError(t('delivery_os.projects.list.error.load'))
        }
      } finally {
        if (sequence === requestSequence.current) setIsLoading(false)
      }
    }
    void load()
    return () => { requestSequence.current += 1 }
  }, [page, search, includeArchived, sortField, sortDir, reloadToken, scopeVersion])

  const reload = React.useCallback(() => setReloadToken((token) => token + 1), [])

  const handleArchive = React.useCallback(async (row: ProjectListItem) => {
    if (!hasUsableVersion(row)) {
      flash(t('delivery_os.projects.list.archive.missingVersion'), 'error')
      return
    }
    const confirmed = await confirm({
      title: t('delivery_os.projects.list.archive.confirmTitle', { name: row.name }),
      description: t('delivery_os.projects.list.archive.confirmDescription'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await runMutation({
        operation: async () => {
          const call = await withScopedApiRequestHeaders(
            buildOptimisticLockHeader(row.updatedAt),
            () => apiCall(`/api/delivery_os/projects?id=${encodeURIComponent(row.id)}`, { method: 'DELETE' }),
          )
          if (!call.ok) {
            throw Object.assign(new Error('[internal] delivery_os.projects.delete failed'), {
              status: call.status,
              ...((call.result as Record<string, unknown> | null) ?? {}),
            })
          }
          return call
        },
        context: {
          formId: MUTATION_CONTEXT_ID,
          resourceKind: 'delivery_os.project',
          resourceId: row.id,
          retryLastMutation,
        },
        mutationPayload: { id: row.id },
      })
      flash(t('delivery_os.projects.list.archive.success'), 'success')
      reload()
    } catch (error) {
      if (surfaceRecordConflict(error, t, {
        title: t('delivery_os.projects.list.archive.conflictTitle'),
        onRefresh: reload,
      })) return
      const status = (error as { status?: number } | null)?.status
      if (status === 404) {
        flash(t('delivery_os.projects.list.archive.notFound'), 'error')
        reload()
        return
      }
      if (status === 409) {
        flash(t('delivery_os.projects.list.archive.blocked'), 'error')
        return
      }
      flash(t('delivery_os.projects.list.archive.error'), 'error')
    }
  }, [confirm, reload, retryLastMutation, runMutation, t])

  const columns = React.useMemo<ColumnDef<ProjectListItem>[]>(() => [
    {
      accessorKey: 'name',
      header: t('delivery_os.projects.list.columns.name'),
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Link href={`/backend/delivery/projects/${row.original.id}`} className="font-medium hover:underline">
            {row.original.name}
          </Link>
          {row.original.archivedAt ? (
            <Badge variant="muted">{t('delivery_os.projects.list.badge.archived')}</Badge>
          ) : null}
        </div>
      ),
    },
    {
      accessorKey: 'inputMode',
      header: t('delivery_os.projects.list.columns.inputMode'),
      enableSorting: false,
      cell: ({ row }) => t(`delivery_os.projects.inputMode.${row.original.inputMode}`),
    },
    {
      accessorKey: 'targetProfileId',
      header: t('delivery_os.projects.list.columns.targetProfile'),
      enableSorting: false,
      cell: ({ row }) => `${row.original.targetProfileId} v${row.original.targetProfileVersion}`,
    },
    {
      accessorKey: 'repositoryRef',
      header: t('delivery_os.projects.list.columns.repository'),
      enableSorting: false,
      cell: ({ row }) => row.original.repositoryRef ?? '—',
    },
    {
      accessorKey: 'updatedAt',
      header: t('delivery_os.projects.list.columns.updatedAt'),
      cell: ({ row }) => formatDateTime(row.original.updatedAt),
    },
  ], [t])

  const filterDefs = React.useMemo<FilterDef[]>(() => [
    { id: 'includeArchived', label: t('delivery_os.projects.list.filters.includeArchived'), type: 'checkbox' },
  ], [t])

  const rowActions = React.useCallback((row: ProjectListItem) => {
    const items: RowActionItem[] = [
      {
        id: 'open',
        label: t('delivery_os.projects.list.actions.open'),
        href: `/backend/delivery/projects/${row.id}`,
      },
    ]
    if (!row.archivedAt && hasUsableVersion(row)) {
      items.push({
        id: 'delete',
        label: t('delivery_os.projects.list.actions.archive'),
        destructive: true,
        onSelect: () => { void handleArchive(row) },
      })
    }
    return <RowActions items={items} />
  }, [handleArchive, t])

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('delivery_os.projects.list.title')}
          titleHeadingLevel={1}
          columns={columns}
          data={rows}
          isLoading={isLoading}
          error={loadError}
          extensionTableId="delivery_os.projects"
          searchValue={search}
          searchPlaceholder={t('delivery_os.projects.list.searchPlaceholder')}
          onSearchChange={(value) => { setSearch(value); setPage(1) }}
          filters={filterDefs}
          filterValues={filters}
          onFiltersApply={(values) => { setFilters(values); setPage(1) }}
          onFiltersClear={() => { setFilters({}); setPage(1) }}
          actions={(
            <Button asChild>
              <Link href="/backend/delivery/projects/create">
                <Plus className="size-4" aria-hidden />
                {t('delivery_os.projects.list.actions.create')}
              </Link>
            </Button>
          )}
          rowActions={rowActions}
          sortable
          manualSorting
          sorting={sorting}
          onSortingChange={(next) => { setSorting(next); setPage(1) }}
          emptyState={(
            <ListEmptyState
              entityName={t('delivery_os.projects.list.title')}
              title={t('delivery_os.projects.list.empty.title')}
              description={t('delivery_os.projects.list.empty.description')}
              createHref="/backend/delivery/projects/create"
              createLabel={t('delivery_os.projects.list.actions.create')}
            />
          )}
          pagination={{ page, pageSize: PAGE_SIZE, total, totalPages, totalIsCapped, onPageChange: setPage }}
        />
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}

export default DeliveryProjectListClient
