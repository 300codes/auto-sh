'use client'

import * as React from 'react'
import type { ResultIssue } from './resultImport'

/**
 * Every path the refusal named, not just the first. A result manifest is
 * refused per field — collapsing `details[]` into one sentence would hide the
 * other paths the operator still has to fix.
 */
export function ResultIssueList({ issues, label }: { issues: readonly ResultIssue[]; label: string }) {
  return (
    <div data-testid="result-import-issues" className="rounded border border-status-error-border p-3">
      <p className="text-sm font-medium text-status-error-text">{label}</p>
      <ul className="mt-1 space-y-1">
        {issues.map((issue, index) => (
          <li key={`${issue.path}-${issue.code}-${index}`} className="flex gap-2 text-xs" data-testid="result-import-issue">
            <span className="font-mono text-muted-foreground">{issue.path || '(root)'}</span>
            <span className="font-mono">{issue.code}</span>
            <span>{issue.message}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
