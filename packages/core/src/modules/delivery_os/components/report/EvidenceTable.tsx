'use client'

import * as React from 'react'
import Link from 'next/link'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import type { DeliveryReportV1 } from '../../lib/contracts'
import { evidenceRevisionLabel, evidenceStatusVariant, evidenceTableRows } from './evidenceView'

type EvidenceRow = ReturnType<typeof evidenceTableRows>[number]

export function EvidenceTable({ report, onEvidenceSelect }: { report: DeliveryReportV1; onEvidenceSelect?: (id: string) => void }) {
  const t = useT()
  const [page, setPage] = React.useState(1)
  const rows = React.useMemo(() => evidenceTableRows(report), [report])
  const revision = evidenceRevisionLabel(report.revision)
  React.useEffect(() => setPage(1), [report.projectId, report.baselineId, revision])
  const currentPage = Math.min(page, Math.max(1, Math.ceil(rows.length / 50)))
  const statusBadge = (status: string | null) => (
    <StatusBadge variant={evidenceStatusVariant(status)}>{t(`delivery_os.report.evidence.status.${status ?? 'unknown'}`)}</StatusBadge>
  )
  const evidenceLink = (id: string | null) => id ? (
    <Button type="button" variant="ghost" size="sm" disabled={!onEvidenceSelect} onClick={() => onEvidenceSelect?.(id)}>{id}</Button>
  ) : t('delivery_os.report.evidence.notLinked')
  const columns: ColumnDef<EvidenceRow>[] = [
    { accessorKey: 'requirementId', header: t('delivery_os.report.evidence.requirement'), cell: ({ row }) => row.original.requirementId ?? t('delivery_os.report.evidence.notLinked') },
    { accessorKey: 'acId', header: t('delivery_os.report.evidence.criterion'), cell: ({ row }) => <div className="space-y-1"><div>{row.original.acId ?? t('delivery_os.report.evidence.notLinked')}</div>{statusBadge(row.original.acStatus)}</div> },
    { accessorKey: 'taskId', header: t('delivery_os.report.evidence.task'), cell: ({ row }) => row.original.taskId ? <Link className="underline" href={`/backend/delivery/projects/${report.projectId}/tasks/${row.original.taskId}`}>{row.original.taskId}</Link> : t('delivery_os.report.evidence.notLinked') },
    { id: 'test', header: t('delivery_os.report.evidence.test'), cell: ({ row }) => <div className="space-y-1"><div>{row.original.testId ?? row.original.manualCheckId ?? t('delivery_os.report.evidence.notLinked')}</div>{statusBadge(row.original.testId ? row.original.testStatus : row.original.manualCheckStatus)}</div> },
    { accessorKey: 'evidenceId', header: t('delivery_os.report.evidence.record'), cell: ({ row }) => evidenceLink(row.original.evidenceId) },
    { accessorKey: 'rawReportHash', header: t('delivery_os.report.evidence.hash'), cell: ({ row }) => row.original.rawReportHash ?? t('delivery_os.report.evidence.notLinked') },
    { accessorKey: 'deploymentEvidenceId', header: t('delivery_os.report.evidence.deployment'), cell: ({ row }) => evidenceLink(row.original.deploymentEvidenceId) },
  ]
  return (
    <section className="space-y-3" id="report-evidence">
      <SectionHeader title={t('delivery_os.report.evidence.title')} />
      <p className="break-all text-sm text-muted-foreground">{t('delivery_os.report.evidence.revision')}: {revision ?? t('delivery_os.report.evidence.status.unknown')}</p>
      {report.truncated ? <Alert status="warning">{t('delivery_os.report.evidence.truncated', { shown: rows.length, total: report.totalRows })}</Alert> : null}
      <DataTable columns={columns.map((column) => ({ ...column, meta: { truncate: true, maxWidth: '16rem' } }))} data={rows.slice((currentPage - 1) * 50, currentPage * 50)} sortable={false} embedded
        emptyState={t('delivery_os.report.evidence.empty')} showQueryTime={false}
        pagination={{ page: currentPage, pageSize: 50, total: rows.length, totalPages: Math.max(1, Math.ceil(rows.length / 50)), onPageChange: setPage }} />
    </section>
  )
}
