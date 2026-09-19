'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import type { CheckStatus, DeliveryUsage, ResultManifestV1 } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import type { AcceptedResultSummary } from '@open-mercato/core/modules/delivery_os/lib/resultReadContracts'
import { countChecksByStatus, summarizeResultManifest, usageIsUnknown } from './resultImport'

/**
 * Mirrors `DeliveryEvidenceSource` in `data/entities.ts`. Declared here rather
 * than imported so a client island never pulls the ORM entity module into the
 * browser bundle.
 */
export type ResultEvidenceSource = 'adapter' | 'manual'

export type ResultSummaryProps = { accepted?: boolean } & (
  | { manifest: ResultManifestV1; source: ResultEvidenceSource; result?: never }
  | { result: AcceptedResultSummary; manifest?: never; source?: never }
)

/** `not_run` is deliberately NOT a success colour: it reports an absent measurement. */
export const checkStatusMap: StatusMap<CheckStatus> = {
  passed: 'success',
  failed: 'error',
  not_run: 'neutral',
}

const CHECK_STATUSES: readonly CheckStatus[] = ['passed', 'failed', 'not_run']

function UsageBlock({ usage }: { usage: DeliveryUsage }) {
  const t = useT()
  if (usageIsUnknown(usage)) {
    return (
      <p className="text-sm" data-testid="result-usage-unknown">
        {t('delivery_os.task.result.usage.unknown', { source: t(`delivery_os.task.result.usage.source.${usage.source}`) })}
      </p>
    )
  }
  const values = usage.values as Exclude<DeliveryUsage['values'], 'unknown'>
  const entries: Array<[string, number | undefined]> = [
    ['delivery_os.task.result.usage.inputTokens', values.inputTokens],
    ['delivery_os.task.result.usage.outputTokens', values.outputTokens],
    ['delivery_os.task.result.usage.totalTokens', values.totalTokens],
    ['delivery_os.task.result.usage.costUsd', values.costUsd],
  ]
  return (
    <dl className="flex flex-wrap gap-4 text-xs" data-testid="result-usage-values">
      <div>
        <dt className="font-medium text-muted-foreground">{t('delivery_os.task.result.usage.sourceLabel')}</dt>
        <dd>{t(`delivery_os.task.result.usage.source.${usage.source}`)}</dd>
      </div>
      {entries
        .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
        .map(([labelKey, value]) => (
          <div key={labelKey}>
            <dt className="font-medium text-muted-foreground">{t(labelKey)}</dt>
            <dd className="font-mono">{value}</dd>
          </div>
        ))}
    </dl>
  )
}

function FindingList({ manifest }: { manifest: Pick<ResultManifestV1, 'findings'> }) {
  const t = useT()
  if (manifest.findings.length === 0) {
    return <p className="text-xs text-muted-foreground">{t('delivery_os.task.result.findings.none')}</p>
  }
  return (
    <ul className="space-y-1" data-testid="result-findings">
      {manifest.findings.map((finding, index) => (
        <li key={`${finding.severity}-${index}`} className="flex flex-wrap items-center gap-2 text-xs">
          <StatusBadge variant={finding.severity === 'error' ? 'error' : finding.severity === 'warning' ? 'warning' : 'info'}>
            {t(`delivery_os.task.result.findings.severity.${finding.severity}`)}
          </StatusBadge>
          {finding.path ? <span className="font-mono text-muted-foreground">{finding.path}</span> : null}
          {finding.acId ? <span className="font-mono">{finding.acId}</span> : null}
          <span>{finding.message}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * What the result actually states — never more. The three check states are
 * shown as three counts, `not_run` among them, so a run that measured nothing
 * cannot read as a run that passed.
 */
export function ResultSummary(props: ResultSummaryProps) {
  const t = useT()
  const manifest = props.result ?? props.manifest
  const source = props.result?.source ?? props.source
  const accepted = props.result !== undefined || props.accepted === true
  const summary = props.result ? {
    externalRunId: props.result.externalRunId,
    changedPathCount: props.result.changedPaths.length,
    artifactCount: props.result.artifactCount,
    artifactBytes: props.result.artifactBytes,
    findingCount: props.result.findings.length,
  } : summarizeResultManifest(props.manifest)
  const counts = countChecksByStatus(manifest)

  return (
    <div className="space-y-3 rounded border border-border p-3" data-testid="delivery-result-summary">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge variant="neutral">{t(`delivery_os.task.result.source.${source}`)}</StatusBadge>
        <span className="font-mono text-xs text-muted-foreground">{summary.externalRunId}</span>
      </div>

      <div className="space-y-1">
        <h4 className="text-xs font-medium text-muted-foreground">{t('delivery_os.task.result.checks.title')}</h4>
        <div className="flex flex-wrap gap-2" data-testid="result-check-counts">
          {CHECK_STATUSES.map((status) => (
            <span key={status} data-testid={`result-check-count-${status}`}>
              <StatusBadge variant={checkStatusMap[status]} dot>
                {t(`delivery_os.task.result.checks.${status}`, { count: counts[status] })}
              </StatusBadge>
            </span>
          ))}
        </div>
        {counts.not_run > 0 ? (
          <p className="text-xs text-muted-foreground" data-testid="result-not-run-caveat">
            {t('delivery_os.task.result.checks.notRunCaveat')}
          </p>
        ) : null}
      </div>

      <dl className="grid gap-2 text-xs sm:grid-cols-3">
        <div>
          <dt className="font-medium text-muted-foreground">{t('delivery_os.task.result.changedPaths')}</dt>
          <dd data-testid="result-changed-path-count">{summary.changedPathCount}</dd>
        </div>
        <div>
          <dt className="font-medium text-muted-foreground">{t('delivery_os.task.result.artifacts')}</dt>
          <dd data-testid="result-artifact-count">
            {summary.artifactBytes === null
              ? t('delivery_os.task.result.artifactsUnknownSize', { count: summary.artifactCount })
              : t('delivery_os.task.result.artifactsValue', { count: summary.artifactCount, bytes: summary.artifactBytes })}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-muted-foreground">{t('delivery_os.task.result.findings.title')}</dt>
          <dd>{summary.findingCount}</dd>
        </div>
      </dl>

      {manifest.changedPaths.length > 0 ? (
        <ul className="space-y-0.5 font-mono text-xs text-muted-foreground" data-testid="result-changed-paths">
          {manifest.changedPaths.map((path) => <li key={path}>{path}</li>)}
        </ul>
      ) : null}

      {props.result ? (
        <dl className="grid gap-2 text-xs sm:grid-cols-3" data-testid="result-provenance">
          <div><dt>{t('delivery_os.task.result.read.attempt')}</dt><dd className="break-all font-mono">{props.result.attemptId}</dd></div>
          <div><dt>{t('delivery_os.task.result.read.evidence')}</dt><dd className="break-all font-mono">{props.result.evidenceId}</dd></div>
          <div><dt>{t('delivery_os.task.result.read.recorded')}</dt><dd><time dateTime={props.result.createdAt}>{props.result.createdAt}</time></dd></div>
        </dl>
      ) : null}
      <FindingList manifest={manifest} />

      <div className="space-y-1">
        <h4 className="text-xs font-medium text-muted-foreground">{t('delivery_os.task.result.usage.title')}</h4>
        <UsageBlock usage={manifest.usage} />
        {accepted ? (
          <p className="text-xs text-muted-foreground" data-testid="result-usage-persisted">
            {t('delivery_os.task.result.usage.persisted')}
          </p>
        ) : null}
      </div>
    </div>
  )
}
