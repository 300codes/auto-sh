'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import type { StageArtifactListItem, StageDecisionListItem } from '../../lib/contracts'

export function StageHistory({ artifacts, decisions, selectedId, onSelect }: { artifacts: StageArtifactListItem[]; decisions: StageDecisionListItem[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const t = useT()
  return <section className="space-y-3" data-testid="delivery-stage-history">
    <h3 className="text-sm font-semibold">{t('delivery_os.flow.history')}</h3>
    <ul className="space-y-3">{artifacts.map((artifact) => <li key={artifact.artifactId}>
      <Button type="button" variant={selectedId === artifact.artifactId ? 'secondary' : 'outline'} onClick={() => onSelect(artifact.artifactId)}>{t('delivery_os.flow.version', { version: artifact.version })}</Button>
      <time className="ml-2 text-xs" dateTime={artifact.createdAt}>{new Date(artifact.createdAt).toLocaleString()}</time>
      <p className="break-all font-mono text-xs">{artifact.contentHash}</p>
      {decisions.filter((decision) => decision.artifactId === artifact.artifactId).map((decision) => <div key={decision.decisionId} className="space-y-1 text-sm">
        <StatusBadge variant={decision.verdict === 'approved' ? 'success' : 'error'}>{t(`delivery_os.flow.currency.${decision.verdict}`)}</StatusBadge>
        {decision.reason ? <p>{decision.reason}</p> : null}
        {decision.clientApproval ? <p>{decision.clientApproval.approverName} · {decision.clientApproval.evidence.reference}</p> : null}
      </div>)}
    </li>)}</ul>
  </section>
}
