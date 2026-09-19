'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Button } from '@open-mercato/ui/primitives/button'
import type { BaselineDto, ProjectDetail } from '@open-mercato/core/modules/delivery_os/api/schemas'
import { resolveActiveBaseline } from './baselineContent'
import type { SectionSource } from './useProjectSections'

export type EvidenceSectionProps = {
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

export function EvidenceSection({ progress, taskCounts, attention, baselines, onRetry }: EvidenceSectionProps) {
  const t = useT()
  const active = baselines.status === 'ready' ? resolveActiveBaseline(baselines.data) : null
  const coverage = active?.kind === 'ready' ? active.content : null
  const counts = Object.entries(taskCounts)

  return (
    <section data-testid="delivery-evidence-section" className="space-y-3">
      <SectionHeader title={t('delivery_os.project.sections.evidence.title')} />

      <div>
        <p className="text-xs font-medium">{t('delivery_os.project.sections.evidence.acProgress')}</p>
        <ProgressValue progress={progress} />
      </div>

      <div>
        <p className="text-xs font-medium">{t('delivery_os.project.sections.evidence.taskState')}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {counts.length === 0 ? (
            <span className="text-xs text-muted-foreground">{t('delivery_os.project.sections.evidence.noTaskCounts')}</span>
          ) : (
            counts.map(([status, count]) => (
              <StatusBadge key={status} variant="neutral">
                {`${t(`delivery_os.project.sections.tasks.status.${status}`, status)}: ${count}`}
              </StatusBadge>
            ))
          )}
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
      </div>

      <div>
        <p className="text-xs font-medium">{t('delivery_os.project.sections.evidence.declaredCoverage')}</p>
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
          <p className="mt-1 text-sm text-muted-foreground">
            {t('delivery_os.project.sections.evidence.noDeclaredCoverage')}
          </p>
        ) : null}
        {coverage ? (
          <div className="mt-1 flex flex-wrap items-center gap-2">
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

      {/* Platform gap, not a domain result: the read endpoint does not exist yet. */}
      <Alert status="information" data-testid="delivery-evidence-list-unavailable">
        <p className="font-medium">{t('delivery_os.project.sections.evidence.listUnavailable')}</p>
        <p>{t('delivery_os.project.sections.evidence.listUnavailableDescription')}</p>
      </Alert>
    </section>
  )
}
