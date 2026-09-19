'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { shortHash } from './baselineContent'
import type {
  PlanProposalSummary,
  ProposalIssue,
  RequirementsProposalSummary,
} from './proposalImport'

function Field({ labelKey, children }: { labelKey: string; children: React.ReactNode }) {
  const t = useT()
  return (
    <div>
      <dt className="font-medium">{t(labelKey)}</dt>
      <dd>{children}</dd>
    </div>
  )
}

/**
 * Field-level failures, one line each. A manifest is rejected for a field, not
 * as a whole, so a single sentence would throw away the part the operator acts
 * on — this shape serves both the client parse and the server's `details[]`.
 */
export function ProposalIssueList({ issues, label }: { issues: readonly ProposalIssue[]; label: string }) {
  return (
    <div data-testid="proposal-import-issues" className="rounded border border-status-error-border p-3">
      <p className="text-sm font-medium text-status-error-text">{label}</p>
      <ul className="mt-1 space-y-1">
        {issues.map((issue, index) => (
          <li key={`${issue.path}-${issue.code}-${index}`} className="flex gap-2 text-xs">
            <span className="font-mono text-muted-foreground">{issue.path || '(root)'}</span>
            <span className="font-mono">{issue.code}</span>
            <span>{issue.message}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function RequirementsProposalPreview({ summary }: { summary: RequirementsProposalSummary }) {
  return (
    <dl data-testid="proposal-import-preview" className="grid grid-cols-2 gap-x-4 gap-y-1 rounded border border-border p-3 text-xs sm:grid-cols-4">
      <Field labelKey="delivery_os.project.import.preview.requirements">{summary.requirementCount}</Field>
      <Field labelKey="delivery_os.project.import.preview.acceptanceCriteria">{summary.acceptanceCriteriaCount}</Field>
      <Field labelKey="delivery_os.project.import.preview.producedBy">
        <span className="font-mono">{summary.producedByTool}</span>
      </Field>
      <Field labelKey="delivery_os.project.import.preview.manifestId">
        <span className="font-mono">{summary.manifestId}</span>
      </Field>
    </dl>
  )
}

export function PlanProposalPreview({ summary }: { summary: PlanProposalSummary }) {
  const t = useT()
  return (
    <div data-testid="proposal-import-preview" className="space-y-2 rounded border border-border p-3 text-xs">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
        <Field labelKey="delivery_os.project.import.preview.tasks">{summary.taskCount}</Field>
        <Field labelKey="delivery_os.project.import.preview.declaredTests">{summary.declaredTestCount}</Field>
        <Field labelKey="delivery_os.project.import.preview.producedBy">
          <span className="font-mono">{summary.producedByTool ?? '—'}</span>
        </Field>
        <Field labelKey="delivery_os.project.import.preview.manifestId">
          <span className="font-mono">{summary.manifestId}</span>
        </Field>
      </dl>
      {/* The baseline this plan claims to target: a plan written for an older
          version is refused, and the operator should be able to see which
          version it names before sending it. */}
      <p data-testid="proposal-import-preview-baseline" className="font-mono text-muted-foreground">
        {t('delivery_os.project.import.preview.baseline', {
          baselineId: summary.baselineId,
          hash: shortHash(summary.baselineHash),
        })}
      </p>
      <p className="whitespace-pre-wrap">{summary.architectureSummary}</p>
    </div>
  )
}
