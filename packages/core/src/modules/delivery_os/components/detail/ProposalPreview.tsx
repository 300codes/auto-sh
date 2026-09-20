'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { TruncatedCell } from '@open-mercato/ui/backend/TruncatedCell'
import type { PlanProposalV1, RequirementsProposalV1 } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { HashValue } from './HashValue'
import {
  summarizePlanProposal,
  summarizeRequirementsProposal,
  type ProposalIssue,
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

function IdentityValue({ value }: { value: string }) {
  return (
    <TruncatedCell maxWidth="max-w-[180px]" tooltipContent={value}>
      <span className="font-mono">{value}</span>
    </TruncatedCell>
  )
}

/**
 * Field-level failures, one line each. A manifest is rejected for a field, not
 * as a whole, so a single sentence would throw away the part the operator acts
 * on — this shape serves both the client parse and the server's `details[]`.
 */
export function ProposalIssueList({ issues, label }: { issues: readonly ProposalIssue[]; label: string }) {
  return (
    <div data-testid="proposal-import-issues" className="rounded-md border border-status-error-border p-3">
      <p className="text-sm font-medium text-status-error-text">{label}</p>
      <ul className="mt-1 space-y-1">
        {issues.map((issue, index) => (
          <li key={`${issue.path}-${issue.code}-${index}`} className="flex flex-wrap gap-2 text-xs">
            <span className="font-mono text-muted-foreground">{issue.path || '(root)'}</span>
            <span className="font-mono">{issue.code}</span>
            <span>{issue.message}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * The operator approves what they can read, never a payload. The counts say how
 * much arrives, the lists say what arrives — and the manifest itself is only
 * reachable behind the dialog's technical disclosure.
 */
export function RequirementsProposalPreview({ manifest }: { manifest: RequirementsProposalV1 }) {
  const t = useT()
  const summary = summarizeRequirementsProposal(manifest)
  const criteriaByRequirement = new Map<string, typeof manifest.acceptanceCriteria>()
  manifest.acceptanceCriteria.forEach((criterion) => {
    const bucket = criteriaByRequirement.get(criterion.requirementId) ?? []
    bucket.push(criterion)
    criteriaByRequirement.set(criterion.requirementId, bucket)
  })
  return (
    <div data-testid="proposal-import-preview" className="space-y-3 rounded-lg border border-border p-4 text-xs">
      <SectionHeader title={t('delivery_os.project.import.preview.title')} count={summary.requirementCount} />
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
        <Field labelKey="delivery_os.project.import.preview.requirements">{summary.requirementCount}</Field>
        <Field labelKey="delivery_os.project.import.preview.acceptanceCriteria">{summary.acceptanceCriteriaCount}</Field>
        <Field labelKey="delivery_os.project.import.preview.producedBy">{summary.producedByTool}</Field>
        <Field labelKey="delivery_os.project.import.preview.manifestId">
          <IdentityValue value={summary.manifestId} />
        </Field>
      </dl>
      <ul className="max-h-64 space-y-2 overflow-y-auto" data-testid="proposal-import-preview-requirements">
        {manifest.requirements.map((requirement) => {
          const criteria = criteriaByRequirement.get(requirement.id) ?? []
          return (
            <li key={requirement.id} className="space-y-1 rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="font-mono">{requirement.id}</Badge>
                <span className="font-medium">{requirement.title}</span>
                <Badge variant="muted" size="sm" className="tabular-nums">
                  {t('delivery_os.project.sections.requirements.criteriaCount', { count: criteria.length })}
                </Badge>
              </div>
              <ul className="space-y-1 text-muted-foreground">
                {criteria.map((criterion) => (
                  <li key={criterion.id} className="flex gap-2">
                    <span className="font-mono">{criterion.id}</span>
                    <span>{criterion.description}</span>
                  </li>
                ))}
              </ul>
            </li>
          )
        })}
      </ul>
      {summary.questionCount > 0 || summary.riskCount > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="muted" size="sm">
            {t('delivery_os.project.import.preview.questions', { count: summary.questionCount })}
          </Badge>
          <Badge variant="muted" size="sm">
            {t('delivery_os.project.import.preview.risks', { count: summary.riskCount })}
          </Badge>
        </div>
      ) : null}
    </div>
  )
}

export function PlanProposalPreview({ manifest }: { manifest: PlanProposalV1 }) {
  const t = useT()
  const summary = summarizePlanProposal(manifest)
  return (
    <div data-testid="proposal-import-preview" className="space-y-3 rounded-lg border border-border p-4 text-xs">
      <SectionHeader title={t('delivery_os.project.import.preview.title')} count={summary.taskCount} />
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
        <Field labelKey="delivery_os.project.import.preview.tasks">{summary.taskCount}</Field>
        <Field labelKey="delivery_os.project.import.preview.declaredTests">{summary.declaredTestCount}</Field>
        <Field labelKey="delivery_os.project.import.preview.producedBy">{summary.producedByTool ?? '—'}</Field>
        <Field labelKey="delivery_os.project.import.preview.manifestId">
          <IdentityValue value={summary.manifestId} />
        </Field>
      </dl>
      {/* The baseline this plan claims to target: a plan written for an older
          version is refused, and the operator should be able to see which
          version it names before sending it. */}
      <p data-testid="proposal-import-preview-baseline" className="flex flex-wrap items-center gap-2 text-muted-foreground">
        <span>{t('delivery_os.project.import.preview.baselineLabel')}</span>
        <IdentityValue value={summary.baselineId} />
        <HashValue value={summary.baselineHash} />
      </p>
      <p className="whitespace-pre-wrap">{summary.architectureSummary}</p>
      <ul className="max-h-64 space-y-2 overflow-y-auto" data-testid="proposal-import-preview-tasks">
        {manifest.tasks.map((task) => (
          <li key={task.proposalTaskKey} className="space-y-1 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="font-mono">{task.proposalTaskKey}</Badge>
              <span className="font-medium">{task.title}</span>
            </div>
            <p className="whitespace-pre-wrap text-muted-foreground">{task.description}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="muted" size="sm">
                {t('delivery_os.project.import.preview.covers', { ids: task.acIds.join(', ') })}
              </Badge>
              {task.dependsOn.length > 0 ? (
                <Badge variant="muted" size="sm">
                  {t('delivery_os.project.import.preview.dependsOn', { ids: task.dependsOn.join(', ') })}
                </Badge>
              ) : null}
              <Badge variant="muted" size="sm">
                {t('delivery_os.project.import.preview.allowedPaths', { count: task.allowedPaths.length })}
              </Badge>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
