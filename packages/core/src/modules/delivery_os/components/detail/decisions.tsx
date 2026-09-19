'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Badge } from '@open-mercato/ui/primitives/badge'
import type { BaselineDto } from '@open-mercato/core/modules/delivery_os/api/schemas'
import { shortHash } from './baselineContent'

export type BaselineDecision = BaselineDto['decisions'][number]

/**
 * Read-only decision log. UI-02 renders history only — approving and rejecting
 * a baseline belongs to UI-03, so this component deliberately exposes no action.
 */
export function DecisionHistory({ decisions, emptyKey }: { decisions: readonly BaselineDecision[]; emptyKey: string }) {
  const t = useT()
  if (decisions.length === 0) return <p className="text-xs text-muted-foreground">{t(emptyKey)}</p>
  return (
    <ul className="space-y-1">
      {decisions.map((decision) => (
        <li key={decision.id} className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant={decision.verdict === 'approved' ? 'success' : 'error'} size="sm">
            {t(`delivery_os.project.sections.decisions.verdict.${decision.verdict}`)}
          </Badge>
          <span>{new Date(decision.decidedAt).toLocaleString()}</span>
          <span className="font-mono">{shortHash(decision.subjectHash)}</span>
          {decision.reason ? <span>{decision.reason}</span> : null}
        </li>
      ))}
    </ul>
  )
}
