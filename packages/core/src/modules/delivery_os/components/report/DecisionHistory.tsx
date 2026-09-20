'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import type { DeliveryReportV1, ReportDecision } from '../../lib/contracts'
import { currentReportDecision } from './reportView'
import { ShortHash } from './ShortHash'

export function DecisionHistory({ report }: { report: DeliveryReportV1 }) {
  const t = useT()
  const latestByKind = new Map<ReportDecision['kind'], ReportDecision>()
  for (const kind of ['requirements', 'design', 'deploy', 'release'] as const) {
    const current = currentReportDecision(report, kind)
    if (current) latestByKind.set(kind, current)
  }
  const isCurrentDecision = (decision: ReportDecision) => latestByKind.get(decision.kind)?.id === decision.id
  return (
    <section id="report-history" className="space-y-3" data-testid="delivery-report-history">
      <SectionHeader title={t('delivery_os.report.history.title')} count={report.decisions.length} />
      {report.decisions.length === 0 ? <EmptyState title={t('delivery_os.report.history.empty')} /> : (
        <ol className="space-y-3">{report.decisions.map((decision) => (
          <li key={decision.id} className="space-y-2 rounded-lg border border-border p-4" data-testid={`report-decision-${decision.id}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{t(`delivery_os.report.history.kind.${decision.kind}`)}</span>
              <StatusBadge dot variant={isCurrentDecision(decision) ? decision.verdict === 'approved' ? 'success' : 'warning' : 'neutral'}>{t(`delivery_os.report.history.verdict.${decision.verdict}`)}</StatusBadge>
              <StatusBadge variant="neutral">{t(`delivery_os.report.history.${isCurrentDecision(decision) ? 'applies' : 'historical'}`)}</StatusBadge>
              <time dateTime={decision.decidedAt} className="text-xs text-muted-foreground">{decision.decidedAt}</time>
            </div>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div className="space-y-1">
                <dt className="text-xs text-muted-foreground">{t('delivery_os.report.history.subject')}</dt>
                <dd className="break-words">{decision.subjectId}</dd>
              </div>
              <div className="space-y-1">
                <dt className="text-xs text-muted-foreground">{t('delivery_os.report.summary.hash')}</dt>
                <dd><ShortHash value={decision.subjectHash} /></dd>
              </div>
              {decision.sourceRevision ? (
                <div className="space-y-1">
                  <dt className="text-xs text-muted-foreground">{t('delivery_os.report.summary.revision')}</dt>
                  <dd><ShortHash value={decision.sourceRevision.kind === 'git' ? `git:${decision.sourceRevision.commitSha}` : `snapshot:${decision.sourceRevision.contentHash}:${decision.sourceRevision.externalWorkspaceId}`} /></dd>
                </div>
              ) : null}
            </dl>
            {decision.reason ? <p className="whitespace-pre-wrap break-words text-sm">{decision.reason}</p> : null}
          </li>
        ))}</ol>
      )}
    </section>
  )
}
