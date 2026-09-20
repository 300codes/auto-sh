'use client'
import * as React from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import type { SourceRevision } from '../../lib/contracts'
import type { EvidenceListResponse } from '../../lib/evidenceReadContracts'
import { useEvidenceList } from './useEvidenceRead'
import { evidenceRevisionLabel } from './evidenceView'

type SourceProps = { projectId: string; baselineId: string; revision: SourceRevision | null; onEvidenceSelect: (id: string) => void }
function SourceGroup(props: SourceProps & { group: 'revision' | 'baseline' }) {
  const t = useT()
  const [offset, setOffset] = React.useState(0)
  const state = useEvidenceList(props.projectId, props.baselineId, props.revision, props.group, offset)
  const columns: ColumnDef<EvidenceListResponse['items'][number]>[] = [
    { accessorKey: 'kind', header: t('delivery_os.report.evidence.kind'), cell: ({ row }) => t(`delivery_os.report.evidence.kind.${row.original.kind}`) },
    { accessorKey: 'createdAt', header: t('delivery_os.report.evidence.createdAt'), cell: ({ row }) => <time dateTime={row.original.createdAt} className="text-sm text-muted-foreground">{row.original.createdAt}</time> },
    { accessorKey: 'id', header: t('delivery_os.report.evidence.record'), meta: { truncate: false }, cell: ({ row }) => <Button type="button" variant="ghost" size="sm" onClick={() => props.onEvidenceSelect(row.original.id)}>{row.original.id}</Button> },
  ]
  return <div className="space-y-3">
    <h3 className="text-sm font-semibold">{t(`delivery_os.report.evidence.group.${props.group}`)}</h3>
    {props.group === 'baseline' ? <Alert status="information">{t('delivery_os.report.evidence.baselineNotice')}</Alert> : null}
    {state.status === 'loading' ? <LoadingMessage label={t('delivery_os.report.evidence.loading')} /> : state.status !== 'ready' ? <><ErrorMessage label={t(`delivery_os.report.evidence.${state.status}`)} /><Button variant="outline" onClick={state.reload}>{t('delivery_os.report.evidence.retry')}</Button></> : <>
      <DataTable data={state.data?.items ?? []} columns={columns} embedded sortable={false} showQueryTime={false} emptyState={t('delivery_os.report.evidence.sourcesEmpty')} />
      <div className="flex gap-2"><Button variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>{t('delivery_os.report.evidence.previous')}</Button><Button variant="outline" disabled={state.data?.nextOffset == null} onClick={() => setOffset(state.data?.nextOffset ?? offset)}>{t('delivery_os.report.evidence.next')}</Button></div>
    </>}
  </div>
}
export function EvidenceSources(props: SourceProps) {
  const t = useT()
  const key = JSON.stringify([props.projectId, props.baselineId, evidenceRevisionLabel(props.revision)])
  return <section className="space-y-4" id="report-sources">
    <SectionHeader title={t('delivery_os.report.evidence.sources')} />
    {props.revision ? <SourceGroup key={`${key}:revision`} {...props} group="revision" /> : <Alert status="information">{t('delivery_os.report.evidence.noRevision')}</Alert>}
    <SourceGroup key={`${key}:baseline`} {...props} group="baseline" />
  </section>
}
