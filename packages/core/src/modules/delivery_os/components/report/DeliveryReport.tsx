'use client'

import * as React from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { ContextHelp } from '@open-mercato/ui/backend/ContextHelp'
import { LoadingMessage, ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { useDeliveryReport } from './useDeliveryReport'
import { reportHistoryHref, shouldPollReport } from './reportView'
import { ReportSummary } from './ReportSummary'
import { DeploymentSummary } from './DeploymentSummary'
import { DecisionHistory } from './DecisionHistory'
import { EvidenceTable } from './EvidenceTable'
import { EvidenceSources } from './EvidenceSources'
import { EvidenceDetailDialog } from './EvidenceDetailDialog'
import { ReleaseDecisionActions } from './ReleaseDecisionActions'

function ReportCard({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-border bg-card p-4 shadow-sm">{children}</div>
}

export function DeliveryReport({ projectId }: { projectId: string }) {
  const t = useT()
  const search = useSearchParams()
  const { state, refresh, historical } = useDeliveryReport(projectId, search?.toString() ?? '')
  const [selected, setSelected] = React.useState<{ key: string; evidenceId: string } | null>(null)
  const projectHref = `/backend/delivery/projects/${encodeURIComponent(projectId)}`
  const retry = <Button type="button" variant="outline" disabled={state.refreshing} onClick={() => void refresh()}>{t('delivery_os.report.refresh')}</Button>
  const snapshot = state.snapshot
  const historyHref = snapshot ? reportHistoryHref(snapshot.report) : null
  const evidenceKey = JSON.stringify([state.key, snapshot?.report.baselineId, snapshot?.report.revision])
  const archived = snapshot?.project.status === 'archived'
  return (
    <Page>
      <FormHeader mode="detail" title={snapshot?.project.name ?? t('delivery_os.report.title')} entityTypeLabel={t('delivery_os.report.title')} backHref={projectHref} />
      <PageBody>
        <div className="space-y-6" data-testid="delivery-report">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" asChild><Link href={projectHref}>{t('delivery_os.report.project')}</Link></Button>
            {retry}
            {historical ? <Button type="button" variant="outline" asChild><Link href={`${projectHref}/report`}>{t('delivery_os.report.current')}</Link></Button>
              : historyHref ? <Button type="button" variant="outline" asChild><Link href={historyHref}>{t('delivery_os.report.permalink')}</Link></Button> : null}
          </div>
          <ContextHelp title={t('delivery_os.report.help.title')}>
            <p>{t('delivery_os.report.help.body')}</p>
          </ContextHelp>
          {historical ? <Alert status="information">{t('delivery_os.report.historical')}</Alert> : null}
          {state.status === 'loading' ? <LoadingMessage label={t('delivery_os.report.loading')} /> : null}
          {state.status === 'noBaseline' ? <Alert status="information">{t('delivery_os.report.noBaseline')}</Alert> : null}
          {state.status === 'notFound'
            ? <RecordNotFoundState label={t('delivery_os.report.notFound')} description={t('delivery_os.report.notFoundDescription')} /> : null}
          {['error', 'forbidden', 'invalid'].includes(state.status)
            ? <ErrorMessage label={t(`delivery_os.report.${state.status}`)} /> : null}
          {state.stale ? <Alert status="warning">{t('delivery_os.report.stale')}</Alert> : null}
          {snapshot ? <>
            {archived ? <Alert status="information">{t('delivery_os.report.archived')}</Alert> : null}
            {!archived && shouldPollReport(snapshot.report, historical)
              ? <Alert status="information">{t('delivery_os.report.waiting')}</Alert> : null}
            <ReportCard><ReportSummary report={snapshot.report} readAt={snapshot.readAt} /></ReportCard>
            <ReportCard><DeploymentSummary report={snapshot.report} /></ReportCard>
            <ReportCard>
              <EvidenceTable key={evidenceKey} report={snapshot.report} onEvidenceSelect={(evidenceId) => setSelected({ key: evidenceKey, evidenceId })} />
            </ReportCard>
            <ReportCard>
              <EvidenceSources key={evidenceKey} projectId={projectId} baselineId={snapshot.report.baselineId} revision={snapshot.report.revision}
                onEvidenceSelect={(evidenceId) => setSelected({ key: evidenceKey, evidenceId })} />
            </ReportCard>
            <ReportCard><DecisionHistory report={snapshot.report} /></ReportCard>
            {historical || archived ? null : (
              <ReportCard>
                <ReleaseDecisionActions key={state.key} historical={historical} archived={archived} snapshot={snapshot} stale={state.stale || state.refreshing} refresh={refresh} />
              </ReportCard>
            )}
            <EvidenceDetailDialog key={evidenceKey} projectId={projectId} evidenceId={selected?.key === evidenceKey ? selected.evidenceId : null} onOpenChange={(open) => { if (!open) setSelected(null) }} />
          </> : null}
        </div>
      </PageBody>
    </Page>
  )
}
