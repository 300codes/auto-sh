'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { RESULT_ISSUE_MESSAGE_KEYS, type ResultIssue } from './resultImport'

/**
 * Every field the refusal named, not just the first, and each one as a sentence
 * about what to change rather than the code that produced it. The code stays
 * readable underneath, because a support conversation needs the machine word.
 */
export function ResultIssueList({ issues, label }: { issues: readonly ResultIssue[]; label: string }) {
  const t = useT()
  return (
    <div
      data-testid="result-import-issues"
      className="rounded border border-status-error-border bg-status-error-bg p-3"
    >
      <p className="text-sm font-medium text-status-error-text">{label}</p>
      <ul className="mt-2 space-y-2">
        {issues.map((issue, index) => {
          const key = RESULT_ISSUE_MESSAGE_KEYS[issue.code]
          return (
            <li key={`${issue.path}-${issue.code}-${index}`} className="space-y-0.5 text-xs" data-testid="result-import-issue">
              <p>{key ? t(key) : issue.message || t('delivery_os.task.result.issue.unnamed')}</p>
              <p className="text-muted-foreground">
                <span>{t('delivery_os.task.result.issue.fieldLabel')}</span>{' '}
                <span className="font-mono">{issue.path || t('delivery_os.task.result.issue.rootField')}</span>
                {' · '}
                <span className="font-mono">{issue.code}</span>
              </p>
              {key && issue.message ? <p className="text-muted-foreground">{issue.message}</p> : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
