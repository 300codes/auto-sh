'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import type { BaselineDto } from '@open-mercato/core/modules/delivery_os/api/schemas'
import { overallDecisionState, shortHash } from './baselineContent'

export type BaselineVersionBarProps = {
  baselines: readonly BaselineDto[]
  selectedId: string | null
  onSelect: (baselineId: string) => void
}

const DECISION_VARIANT = {
  approved: 'success',
  rejected: 'error',
  pending: 'warning',
} as const

/**
 * Approving happens on a version that is not yet active, so the operator has to
 * be able to point at one. The selection lives in `?baselineId=` so a reload and
 * a shared link both land on the same snapshot.
 */
export function BaselineVersionBar({ baselines, selectedId, onSelect }: BaselineVersionBarProps) {
  const t = useT()
  if (baselines.length === 0) return null
  const ordered = [...baselines].sort((first, second) => second.version - first.version)
  return (
    <div data-testid="baseline-version-bar" className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">{t('delivery_os.project.versions.label')}</span>
      {ordered.map((baseline) => {
        const selected = baseline.id === selectedId
        const decision = overallDecisionState(baseline)
        return (
          <Button
            key={baseline.id}
            type="button"
            size="sm"
            variant={selected ? 'default' : 'outline'}
            aria-pressed={selected}
            data-testid={`baseline-version-${baseline.version}`}
            onClick={() => onSelect(baseline.id)}
          >
            <span className="font-medium">{t('delivery_os.project.versions.version', { version: baseline.version })}</span>
            <span className="font-mono text-xs opacity-70">{shortHash(baseline.contentHash)}</span>
            {baseline.isActive ? (
              <StatusBadge variant="info">{t('delivery_os.project.versions.active')}</StatusBadge>
            ) : null}
            <StatusBadge variant={DECISION_VARIANT[decision]}>
              {t(`delivery_os.project.versions.decision.${decision}`)}
            </StatusBadge>
          </Button>
        )
      })}
    </div>
  )
}
