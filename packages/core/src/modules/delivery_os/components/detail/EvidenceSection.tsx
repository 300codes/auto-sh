'use client'

import * as React from 'react'
import Link from 'next/link'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { LoadingMessage, ErrorMessage, TabEmptyState } from '@open-mercato/ui/backend/detail'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Button } from '@open-mercato/ui/primitives/button'
import type { BaselineDto, ProjectDetail } from '@open-mercato/core/modules/delivery_os/api/schemas'
import { resolveActiveBaseline } from './baselineContent'
import type { SectionSource } from './useProjectSections'

export type EvidenceSectionProps = {
  projectId?: string
  progress: ProjectDetail['progress']
  taskCounts: ProjectDetail['taskCounts']
  attention: ProjectDetail['attention']
  baselines: SectionSource<BaselineDto[]>
  onRetry: () => void
}

/**
 * `percent: null` accompanies `total: 0` — the project has no acceptance
 * criteria yet. Rendering it as 0% would show an unproven, started project
 * where there is nothing to prove, so the percentage is withheld entirely.
 */
function ProgressValue({ progress }: { progress: ProjectDetail['progress'] }) {
  const t = useT()
  return (
    <p className="text-sm" data-testid="delivery-evidence-progress">
      <span className="font-medium tabular-nums">{`${progress.proven} / ${progress.total}`}</span>{' '}
      <span className="text-muted-foreground">{t('delivery_os.project.sections.evidence.unit.ac')}</span>{' '}
      <span className="tabular-nums" data-testid="delivery-evidence-percent">
        {progress.percent === null ? '—' : `${progress.percent}%`}
      </span>
    </p>
  )
}

export function EvidenceSection({ projectId, progress, taskCounts, attention, baselines, onRetry }: EvidenceSectionProps) {
  const t = useT()
  const active = baselines.status === 'ready' ? resolveActiveBaseline(baselines.data) : null
  const coverage = active?.kind === 'ready' ? active.content : null
  const counts = Object.entries(taskCounts)

  return (
    <section data-testid="delivery-evidence-section" className="space-y-6">
      <SectionHeader
        title={t('delivery_os.project.sections.evidence.title')}
        action={projectId ? (
          <Button type="button" variant="outline" size="sm" asChild>
            <Link href={`/backend/delivery/projects/${encodeURIComponent(projectId)}/report`} data-testid="delivery-report-link">
              {t('delivery_os.report.open')}
            </Link>
          </Button>
        ) : null}
      />

      <div className="space-y-2">
        <SectionHeader title={t('delivery_os.project.sections.evidence.acProgress')} />
        <ProgressValue progress={progress} />
      </div>

      <div className="space-y-2">
        <SectionHeader title={t('delivery_os.project.sections.evidence.taskState')} count={counts.length} />
        {counts.length === 0 ? (
          <div data-testid="delivery-evidence-no-task-counts">
            <TabEmptyState
              title={t('delivery_os.project.sections.evidence.noTaskCounts')}
              description={t('delivery_os.project.sections.evidence.noTaskCountsDescription')}
            />
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {counts.map(([status, count]) => (
              <StatusBadge key={status} variant="neutral">
                {`${t(`delivery_os.project.sections.tasks.status.${status}`, status)}: ${count}`}
              </StatusBadge>
            ))}
          </div>
        )}
        {attention.blockedTaskIds.length > 0 || attention.reconciliationRequiredTaskIds.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {attention.blockedTaskIds.length > 0 ? (
              <StatusBadge variant="error">
                {t('delivery_os.project.sections.evidence.blocked', { count: attention.blockedTaskIds.length })}
              </StatusBadge>
            ) : null}
            {attention.reconciliationRequiredTaskIds.length > 0 ? (
              <StatusBadge variant="warning">
                {t('delivery_os.project.sections.evidence.reconciliation', {
                  count: attention.reconciliationRequiredTaskIds.length,
                })}
              </StatusBadge>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="space-y-2">
        <SectionHeader title={t('delivery_os.project.sections.evidence.declaredCoverage')} />
        <p className="text-xs text-muted-foreground">
          {t('delivery_os.project.sections.evidence.declaredCoverageCaveat')}
        </p>
        {baselines.status === 'loading' ? <LoadingMessage label={t('delivery_os.project.sections.loading')} /> : null}
        {baselines.status === 'error' ? (
          <ErrorMessage
            label={t('delivery_os.project.sections.baselines.loadError')}
            action={<Button type="button" variant="outline" onClick={onRetry}>{t('delivery_os.project.retry')}</Button>}
          />
        ) : null}
        {baselines.status === 'ready' && coverage === null ? (
          <div data-testid="delivery-evidence-no-coverage">
            <TabEmptyState
              title={t('delivery_os.project.sections.evidence.noDeclaredCoverage')}
              description={t('delivery_os.project.sections.evidence.noDeclaredCoverageDescription')}
            />
          </div>
        ) : null}
        {coverage ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="muted" size="sm">
              {t('delivery_os.project.sections.evidence.acTestMap', { count: Object.keys(coverage.acTestMap).length })}
            </Badge>
            <Badge variant="muted" size="sm">
              {t('delivery_os.project.sections.evidence.declaredTests', { count: coverage.declaredTests.length })}
            </Badge>
            <Badge variant="muted" size="sm">
              {t('delivery_os.project.sections.evidence.manualChecks', { count: Object.keys(coverage.manualChecks).length })}
            </Badge>
          </div>
        ) : null}
      </div>
    </section>
  )
}
