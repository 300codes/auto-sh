'use client'

import * as React from 'react'
import { TruncatedCell } from '@open-mercato/ui/backend/TruncatedCell'

export function ShortHash({ value, maxWidth = 'max-w-40' }: { value: string; maxWidth?: string }) {
  return (
    <TruncatedCell maxWidth={maxWidth} tooltipContent={value} className="font-mono text-xs">
      {value}
    </TruncatedCell>
  )
}

export default ShortHash
