'use client'

import * as React from 'react'
import { TruncatedCell } from '@open-mercato/ui/backend/TruncatedCell'

export type TechnicalFact = { label: string; value: string }

const EMPTY_VALUE = '—'

/**
 * An id, a hash or a revision reference carries no meaning at a glance, so it is
 * width-capped with the whole value behind a tooltip. Nothing in the reading
 * flow becomes a wall of hexadecimal.
 */
export function TechnicalValue({ value, maxWidth = 'max-w-[14rem]' }: { value: string; maxWidth?: string }) {
  if (value.length === 0) return <span className="text-muted-foreground">{EMPTY_VALUE}</span>
  return (
    <TruncatedCell maxWidth={maxWidth} tooltipContent={value}>
      <span className="font-mono text-xs">{value}</span>
    </TruncatedCell>
  )
}

export function TechnicalFacts({ facts, testId }: { facts: readonly TechnicalFact[]; testId?: string }) {
  return (
    <dl className="grid gap-2 sm:grid-cols-2" data-testid={testId}>
      {facts.map((fact) => (
        <div key={fact.label} className="min-w-0 space-y-0.5">
          <dt className="text-xs font-medium text-muted-foreground">{fact.label}</dt>
          <dd className="min-w-0"><TechnicalValue value={fact.value} /></dd>
        </div>
      ))}
    </dl>
  )
}
