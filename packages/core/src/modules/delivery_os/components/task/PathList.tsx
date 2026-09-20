'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'

export type PathListProps = {
  paths: readonly string[]
  testId?: string
  emptyLabel?: string
  /** Above this many entries the list opens folded: a long dump is not a reading flow. */
  foldAfter?: number
}

/**
 * A list of repository paths reads as a count first and as paths second. Every
 * path stays reachable — nothing is summarised away — but twenty of them do not
 * get to push the rest of the result off the screen.
 */
export function PathList({ paths, testId, emptyLabel, foldAfter = 8 }: PathListProps) {
  const t = useT()
  const folds = paths.length > foldAfter
  const [expanded, setExpanded] = React.useState(!folds)
  const visible = expanded ? paths : paths.slice(0, foldAfter)

  if (paths.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyLabel ?? t('delivery_os.task.paths.none')}</p>
  }

  return (
    <div className="space-y-1">
      <ul className="space-y-0.5 break-all font-mono text-xs text-muted-foreground" data-testid={testId}>
        {visible.map((path) => <li key={path}>{path}</li>)}
      </ul>
      {folds ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid={testId ? `${testId}-toggle` : undefined}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded
            ? t('delivery_os.task.paths.fold')
            : t('delivery_os.task.paths.showAll', { count: paths.length - visible.length })}
        </Button>
      ) : null}
    </div>
  )
}
