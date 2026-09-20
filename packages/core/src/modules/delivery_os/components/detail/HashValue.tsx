'use client'

import * as React from 'react'
import { TruncatedCell } from '@open-mercato/ui/backend/TruncatedCell'
import { shortHash } from './baselineContent'

export type HashValueProps = {
  value: string
  testId?: string
  className?: string
}

/**
 * A content hash is an identity, not prose: the reading flow gets the first
 * twelve characters and the full value stays one hover away, so a hash never
 * pushes the sentence it belongs to off the screen.
 */
export function HashValue({ value, testId, className }: HashValueProps) {
  return (
    <TruncatedCell maxWidth="max-w-[140px]" tooltipContent={value} className={className}>
      <span className="font-mono text-xs" data-testid={testId}>{shortHash(value)}</span>
    </TruncatedCell>
  )
}
