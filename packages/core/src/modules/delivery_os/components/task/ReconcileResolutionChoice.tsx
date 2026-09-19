'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ReconciliationResolution } from '@open-mercato/core/modules/delivery_os/lib/contracts'

export type ReconcileResolutionChoiceProps = {
  resolution: ReconciliationResolution
  selected: boolean
  onSelect: () => void
}

/**
 * Each resolution carries its own description, because the four are not degrees
 * of the same thing: "never started", "stopped", "completed" and "unknown" are
 * four different statements about the world, and `unknown` is a decision in its
 * own right rather than a failure to pick one of the other three.
 */
export function ReconcileResolutionChoice({ resolution, selected, onSelect }: ReconcileResolutionChoiceProps) {
  const t = useT()
  return (
    <button
      type="button"
      aria-pressed={selected}
      data-testid={`reconcile-resolution-${resolution}`}
      onClick={onSelect}
      className={`rounded border p-3 text-left ${selected ? 'border-primary bg-accent' : 'border-border'}`}
    >
      <span className="block text-sm font-medium">{t(`delivery_os.task.reconcile.resolution.${resolution}.label`)}</span>
      <span className="block text-xs text-muted-foreground">
        {t(`delivery_os.task.reconcile.resolution.${resolution}.description`)}
      </span>
    </button>
  )
}
