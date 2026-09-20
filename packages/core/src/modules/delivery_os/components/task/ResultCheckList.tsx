'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { CollapsibleSection } from '@open-mercato/ui/backend/SectionHeader'
import type { CheckStatus } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { TechnicalFacts } from './TechnicalValue'

/** `not_run` is deliberately NOT a success colour: it reports an absent measurement. */
export const checkStatusMap: StatusMap<CheckStatus> = {
  passed: 'success',
  failed: 'error',
  not_run: 'neutral',
}

/**
 * The accepted result is read back with four fields per check; the manifest a
 * run just produced carries the measurement as well. One row renders both, and
 * what the payload did not state is simply not claimed.
 */
export type ResultCheckRow = {
  checkId: string
  testId: string
  acIds: readonly string[]
  status: CheckStatus
  exitCode?: number | null
  durationMs?: number
  commandProfileId?: string
  validationProfileVersion?: number
  testDefinitionHash?: string
  rawReportHash?: string
}

const READING_ORDER: Record<CheckStatus, number> = { failed: 0, not_run: 1, passed: 2 }

function CheckRow({ check }: { check: ResultCheckRow }) {
  const t = useT()
  const meta: string[] = []
  if (typeof check.exitCode === 'number') meta.push(t('delivery_os.task.result.checks.exitCode', { code: check.exitCode }))
  if (check.exitCode === null) meta.push(t('delivery_os.task.result.checks.noExitCode'))
  if (typeof check.durationMs === 'number') {
    meta.push(check.durationMs >= 1000
      ? t('delivery_os.task.result.checks.durationSeconds', { seconds: (check.durationMs / 1000).toFixed(1) })
      : t('delivery_os.task.result.checks.durationMillis', { millis: check.durationMs }))
  }
  if (check.commandProfileId) meta.push(t('delivery_os.task.result.checks.commandProfile', { profile: check.commandProfileId }))

  return (
    <li
      className="space-y-1 rounded border border-border p-3"
      data-testid={`result-check-${check.checkId}`}
      data-check-status={check.status}
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge variant={checkStatusMap[check.status]} dot>
          {t(`delivery_os.task.result.checks.status.${check.status}`)}
        </StatusBadge>
        <span className="text-sm">{check.testId}</span>
      </div>
      {meta.length > 0 ? (
        <p className="text-xs text-muted-foreground" data-testid={`result-check-meta-${check.checkId}`}>
          {meta.join(' · ')}
        </p>
      ) : null}
      <p className="text-xs" data-testid={`result-check-criteria-${check.checkId}`}>
        <span className="text-muted-foreground">{t('delivery_os.task.result.checks.covers')}</span>{' '}
        {check.acIds.length === 0
          ? <span className="text-muted-foreground">{t('delivery_os.task.result.checks.coversNothing')}</span>
          : check.acIds.map((acId) => (
            <span key={acId} className="mr-1 inline-flex">
              <StatusBadge variant="neutral">{acId}</StatusBadge>
            </span>
          ))}
      </p>
    </li>
  )
}

function technicalFacts(checks: readonly ResultCheckRow[], label: (key: string) => string): Array<{ label: string; value: string }> {
  return checks.flatMap((check) => {
    const facts: Array<{ label: string; value: string }> = [
      { label: `${check.checkId} · ${label('delivery_os.task.result.checks.technical.checkId')}`, value: check.checkId },
    ]
    if (check.testDefinitionHash) {
      facts.push({ label: `${check.checkId} · ${label('delivery_os.task.result.checks.technical.testDefinitionHash')}`, value: check.testDefinitionHash })
    }
    if (check.rawReportHash) {
      facts.push({ label: `${check.checkId} · ${label('delivery_os.task.result.checks.technical.rawReportHash')}`, value: check.rawReportHash })
    }
    return facts
  })
}

/**
 * What ran and what it proves, failures first — the one thing an operator has to
 * decide from. Check ids and report hashes identify a run for a machine, so they
 * live in a folded technical block instead of in the sentence being read.
 */
export function ResultCheckList({ checks }: { checks: readonly ResultCheckRow[] }) {
  const t = useT()
  if (checks.length === 0) {
    return <p className="text-xs text-muted-foreground" data-testid="result-checks-none">{t('delivery_os.task.result.checks.none')}</p>
  }
  const ordered = [...checks].sort((first, second) => READING_ORDER[first.status] - READING_ORDER[second.status])
  const failed = ordered.filter((check) => check.status === 'failed')
  return (
    <div className="space-y-2">
      {failed.length > 0 ? (
        <p
          className="rounded border border-status-error-border bg-status-error-bg px-3 py-2 text-xs text-status-error-text"
          data-testid="result-checks-failed-banner"
        >
          {t('delivery_os.task.result.checks.failedBanner', { failed: failed.length, total: checks.length })}
        </p>
      ) : null}
      <ul className="space-y-2" data-testid="result-checks">
        {ordered.map((check) => <CheckRow key={check.checkId} check={check} />)}
      </ul>
      <CollapsibleSection
        title={t('delivery_os.task.result.checks.technical.title')}
        count={checks.length}
        defaultCollapsed
      >
        <TechnicalFacts facts={technicalFacts(ordered, t)} testId="result-checks-technical" />
      </CollapsibleSection>
    </div>
  )
}
