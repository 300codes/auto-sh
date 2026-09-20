'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { HashValue } from './StageArtifactContent'
import type { StageArtifactListItem, StageDecisionListItem } from '../../lib/contracts'

export function StageHistory({ artifacts, decisions, selectedId, onSelect }: { artifacts: StageArtifactListItem[]; decisions: StageDecisionListItem[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const t = useT()
  return <section className="space-y-3" data-testid="delivery-stage-history">
    <SectionHeader title={t('delivery_os.flow.history')} count={artifacts.length} />
    {artifacts.length === 0
      ? <EmptyState title={t('delivery_os.flow.historyEmpty.title')} description={t('delivery_os.flow.historyEmpty.description')} />
      : <ul className="space-y-2">{artifacts.map((artifact) => {
        const isSelected = selectedId === artifact.artifactId
        return <li
          key={artifact.artifactId}
          data-testid={`delivery-stage-version-${artifact.version}`}
          aria-current={isSelected ? 'true' : undefined}
          className={`space-y-2 rounded-md border p-3 ${isSelected ? 'border-primary bg-primary/5' : 'border-border'}`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant={isSelected ? 'secondary' : 'outline'} aria-pressed={isSelected} onClick={() => onSelect(artifact.artifactId)}>{t('delivery_os.flow.version', { version: artifact.version })}</Button>
            {isSelected ? <StatusBadge variant="info" appearance="stroke">{t('delivery_os.flow.historySelected')}</StatusBadge> : null}
            <time className="text-xs text-muted-foreground" dateTime={artifact.createdAt}>{new Date(artifact.createdAt).toLocaleString()}</time>
            <HashValue hash={artifact.contentHash} label={t('delivery_os.flow.artifact.contentHash')} />
          </div>
          {decisions.filter((decision) => decision.artifactId === artifact.artifactId).map((decision) => <div key={decision.decisionId} className="space-y-1 text-sm">
            <StatusBadge variant={decision.verdict === 'approved' ? 'success' : 'error'}>{t(`delivery_os.flow.currency.${decision.verdict}`)}</StatusBadge>
            {decision.reason ? <p>{decision.reason}</p> : null}
            {decision.clientApproval ? <p className="text-xs text-muted-foreground">{decision.clientApproval.approverName} — {decision.clientApproval.evidence.reference}</p> : null}
          </div>)}
        </li>
      })}</ul>}
  </section>
}
