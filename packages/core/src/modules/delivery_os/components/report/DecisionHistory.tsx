'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import type { DeliveryReportV1, ReportDecision } from '../../lib/contracts'
import { currentReportDecision } from './reportView'

export function DecisionHistory({ report }: { report: DeliveryReportV1 }) {
  const t = useT()
  const latestByKind = new Map<ReportDecision['kind'], ReportDecision>()
  for (const kind of ['requirements', 'design', 'deploy', 'release'] as const) {
    const current = currentReportDecision(report, kind)
    if (current) latestByKind.set(kind, current)
  }
  const isCurrentDecision = (decision: ReportDecision) => latestByKind.get(decision.kind)?.id === decision.id
  return (
    <section className="space-y-3" data-testid="delivery-report-history">
      <SectionHeader title={t('delivery_os.report.history.title')} count={report.decisions.length} />
      {report.decisions.length === 0 ? <EmptyState title={t('delivery_os.report.history.empty')} /> : (
        <ol className="space-y-3">{report.decisions.map((decision) => (
          <li key={decision.id} className="space-y-2 rounded-lg border border-border p-4" data-testid={`report-decision-${decision.id}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{t(`delivery_os.report.history.kind.${decision.kind}`)}</span>
              <StatusBadge variant={isCurrentDecision(decision) ? decision.verdict === 'approved' ? 'success' : 'warning' : 'neutral'}>{t(`delivery_os.report.history.verdict.${decision.verdict}`)}</StatusBadge>
              <StatusBadge variant="neutral">{t(`delivery_os.report.history.${isCurrentDecision(decision) ? 'applies' : 'historical'}`)}</StatusBadge>
              <time dateTime={decision.decidedAt} className="text-sm text-muted-foreground">{decision.decidedAt}</time>
            </div>
            <p className="break-all text-sm">{t('delivery_os.report.history.subject')}: {decision.subjectId}</p>
            <p className="break-all font-mono text-xs">{decision.subjectHash}</p>
            {decision.sourceRevision ? <p className="break-all font-mono text-xs">{decision.sourceRevision.kind === 'git' ? `git:${decision.sourceRevision.commitSha}` : `snapshot:${decision.sourceRevision.contentHash}:${decision.sourceRevision.externalWorkspaceId}`}</p> : null}
            {decision.reason ? <p className="whitespace-pre-wrap break-words text-sm">{decision.reason}</p> : null}
          </li>
        ))}</ol>
      )}
    </section>
  )
}
