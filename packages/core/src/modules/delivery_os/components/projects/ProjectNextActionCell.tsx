'use client'

import * as React from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import type { FlowStatusV1 } from '../../lib/contracts'
import { buildFlowHighlight, type FlowHighlightBlocker } from './projectFlowView'

export function ProjectNextActionCell({ projectId, flow, loadFailed }: {
  projectId: string
  flow?: FlowStatusV1
  loadFailed: boolean
}) {
  const t = useT()
  if (!flow) {
    return <span className="text-sm text-muted-foreground">{t(loadFailed ? 'delivery_os.flow.loadError' : 'delivery_os.flow.loading')}</span>
  }
  const highlight = buildFlowHighlight(flow)
  const stageLabel = highlight.stageId ? t(`delivery_os.flow.stage.${highlight.stageId}`) : t('delivery_os.flow.noStage')
  const blockerSentence = (blocker: FlowHighlightBlocker) => {
    const cause = t(`delivery_os.flow.blocker.${blocker.kind}`)
    return blocker.stageId
      ? t('delivery_os.projects.list.flow.blockerAtStage', { blocker: cause, stage: t(`delivery_os.flow.stage.${blocker.stageId}`) })
      : t('delivery_os.projects.list.flow.blocker', { blocker: cause })
  }
  return (
    <div className="space-y-2" data-testid={`portfolio-flow-${projectId}`}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge variant={highlight.tone} dot>{t(`delivery_os.projects.list.flow.state.${highlight.state}`)}</StatusBadge>
        <span className="text-xs text-muted-foreground">
          {highlight.currency
            ? t('delivery_os.projects.list.flow.stageWithCurrency', { stage: stageLabel, currency: t(`delivery_os.flow.currency.${highlight.currency}`) })
            : stageLabel}
        </span>
      </div>
      <Link
        href={`/backend/delivery/projects/${projectId}`}
        className="inline-flex items-center gap-1 text-sm font-medium text-foreground underline-offset-2 hover:underline"
        data-testid={`portfolio-next-action-${projectId}`}
      >
        <ArrowRight className="size-4 shrink-0" aria-hidden />
        <span>{t(`delivery_os.flow.nextAction.${highlight.nextActionKind}`)}</span>
      </Link>
      {highlight.blockers.length > 0 ? (
        <ul className="space-y-1">
          {highlight.blockers.map((blocker, index) => (
            <li key={`${blocker.kind}:${blocker.stageId ?? ''}:${index}`} className="text-xs text-status-warning-text">
              {blockerSentence(blocker)}
            </li>
          ))}
        </ul>
      ) : null}
      {highlight.hiddenBlockerCount > 0 ? (
        <p className="text-xs text-muted-foreground">{t('delivery_os.projects.list.flow.moreBlockers', { count: highlight.hiddenBlockerCount })}</p>
      ) : null}
      {highlight.pendingApprovals > 0 ? (
        <p className="text-xs text-muted-foreground">{t('delivery_os.flow.pending', { count: highlight.pendingApprovals })}</p>
      ) : null}
    </div>
  )
}

export default ProjectNextActionCell
