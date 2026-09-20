'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CollapsibleSection, SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import type { CheckStatus, DeliveryUsage, ResultManifestV1 } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import type { AcceptedResultSummary } from '@open-mercato/core/modules/delivery_os/lib/resultReadContracts'
import { countChecksByStatus, describeRevision, summarizeResultManifest, usageIsUnknown } from './resultImport'
import { PathList } from './PathList'
import { ResultCheckList, checkStatusMap } from './ResultCheckList'
import { TechnicalFacts, TechnicalValue } from './TechnicalValue'

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

export { checkStatusMap }

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
          <span>{finding.message}</span>
          {finding.path ? <span className="font-mono text-muted-foreground">{finding.path}</span> : null}
          {finding.acId ? <StatusBadge variant="neutral">{finding.acId}</StatusBadge> : null}
        </li>
      ))}
    </ul>
  )
}

function ArtifactSection({ artifacts }: { artifacts: ResultManifestV1['artifacts'] }) {
  const t = useT()
  if (artifacts.length === 0) return null
  return (
    <CollapsibleSection
      title={t('delivery_os.task.result.artifactsTitle')}
      count={artifacts.length}
      defaultCollapsed={artifacts.length > 8}
    >
      <ul className="space-y-1 text-xs" data-testid="result-artifacts">
        {artifacts.map((artifact) => (
          <li key={artifact.path} className="flex flex-wrap items-baseline gap-2">
            <span className="break-all font-mono">{artifact.path}</span>
            <span className="text-muted-foreground">
              {typeof artifact.sizeBytes === 'number'
                ? t('delivery_os.task.result.artifactBytes', { bytes: artifact.sizeBytes })
                : t('delivery_os.task.result.artifactSizeUnknown')}
            </span>
            <TechnicalValue value={artifact.sha256} maxWidth="max-w-[8rem]" />
          </li>
        ))}
      </ul>
    </CollapsibleSection>
  )
}

/**
 * What the result states, in the order an operator decides in: did the checks
 * pass, what did they cover, what changed, what came out, what the run said
 * about itself. Identifiers and hashes are folded away — they name a run for a
 * machine and answer none of those questions.
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
    <div className="space-y-4 rounded border border-border p-4" data-testid="delivery-result-summary">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge variant="neutral">{t(`delivery_os.task.result.source.${source}`)}</StatusBadge>
        <StatusBadge variant={counts.failed > 0 ? 'error' : counts.not_run > 0 ? 'warning' : 'success'} dot>
          {t(counts.failed > 0
            ? 'delivery_os.task.result.verdict.failed'
            : counts.not_run > 0
              ? 'delivery_os.task.result.verdict.incomplete'
              : 'delivery_os.task.result.verdict.passed')}
        </StatusBadge>
        <span className="text-xs text-muted-foreground">{t('delivery_os.task.result.runLabel')}</span>
        <TechnicalValue value={summary.externalRunId} maxWidth="max-w-[16rem]" />
      </div>

      <div className="space-y-2">
        <SectionHeader title={t('delivery_os.task.result.checks.title')} count={manifest.checks.length} />
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
        <ResultCheckList checks={manifest.checks} />
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

      <div className="space-y-2">
        <SectionHeader title={t('delivery_os.task.result.changedPathsTitle')} count={manifest.changedPaths.length} />
        <PathList
          paths={manifest.changedPaths}
          testId="result-changed-paths"
          emptyLabel={t('delivery_os.task.result.changedPathsNone')}
        />
      </div>

      {props.manifest ? <ArtifactSection artifacts={props.manifest.artifacts} /> : null}

      <div className="space-y-2">
        <SectionHeader title={t('delivery_os.task.result.findings.title')} count={manifest.findings.length} />
        <FindingList manifest={manifest} />
      </div>

      <div className="space-y-1">
        <SectionHeader title={t('delivery_os.task.result.usage.title')} />
        <UsageBlock usage={manifest.usage} />
        {accepted ? (
          <p className="text-xs text-muted-foreground" data-testid="result-usage-persisted">
            {t('delivery_os.task.result.usage.persisted')}
          </p>
        ) : null}
      </div>

      {props.result ? (
        <dl className="grid gap-2 text-xs sm:grid-cols-3" data-testid="result-provenance">
          <div className="min-w-0">
            <dt className="font-medium text-muted-foreground">{t('delivery_os.task.result.read.attempt')}</dt>
            <dd className="min-w-0"><TechnicalValue value={props.result.attemptId} /></dd>
          </div>
          <div className="min-w-0">
            <dt className="font-medium text-muted-foreground">{t('delivery_os.task.result.read.evidence')}</dt>
            <dd className="min-w-0"><TechnicalValue value={props.result.evidenceId} /></dd>
          </div>
          <div className="min-w-0">
            <dt className="font-medium text-muted-foreground">{t('delivery_os.task.result.read.recorded')}</dt>
            <dd><time dateTime={props.result.createdAt}>{props.result.createdAt}</time></dd>
          </div>
        </dl>
      ) : null}

      <CollapsibleSection title={t('delivery_os.task.result.technicalTitle')} defaultCollapsed>
        <TechnicalFacts
          testId="result-technical"
          facts={props.manifest ? [
            { label: t('delivery_os.task.result.technical.baseline'), value: props.manifest.baselineId },
            { label: t('delivery_os.task.result.technical.baselineHash'), value: props.manifest.baselineHash },
            { label: t('delivery_os.task.result.technical.baseRevision'), value: describeRevision(props.manifest.baseRevision) },
            { label: t('delivery_os.task.result.technical.resultRevision'), value: describeRevision(props.manifest.resultRevision) },
          ] : [
            { label: t('delivery_os.task.result.technical.baseline'), value: props.result.baselineId },
            { label: t('delivery_os.task.result.technical.baselineHash'), value: props.result.baselineHash },
            { label: t('delivery_os.task.result.technical.resultRevision'), value: describeRevision(props.result.sourceRevision) },
          ]}
        />
      </CollapsibleSection>
    </div>
  )
}
