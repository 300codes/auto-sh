'use client'

import * as React from 'react'
import Link from 'next/link'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import type { DeliveryReportV1, ReportGate, StageCurrency } from '../../lib/contracts'

import type { DeliveryReportResponse } from '../../lib/reportContracts'
import { gateBlockerAnchor, gateBlockerKey, gateBlockerSentenceKey } from './gateBlockers'
import { ShortHash } from './ShortHash'

const statusVariants: Record<string, StatusBadgeVariant> = {
  passed: 'success', failed: 'error', approved: 'success', changes_requested: 'warning',
  missing: 'neutral', not_run: 'neutral', manual_pending: 'warning', present: 'info',
}

const currencyVariants: Record<StageCurrency, StatusBadgeVariant> = {
  approved: 'success', pending: 'info', rejected: 'error', stale: 'warning', missing: 'neutral',
}

function ProofStatus({ status }: { status: string }) {
  const t = useT()
  return <StatusBadge variant={statusVariants[status] ?? 'neutral'}>{t(`delivery_os.report.status.${status}`)}</StatusBadge>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  )
}

function GateSummary({ gate, label }: { gate: ReportGate; label: string }) {
  const t = useT()
  return (
    <div className="space-y-2 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">{label}</p>
        <StatusBadge variant={gate.ok ? 'info' : 'warning'} dot>
          {t(`delivery_os.report.gate.${gate.ok ? 'satisfied' : 'blocked'}`)}
        </StatusBadge>
      </div>
      {gate.blocking.length > 0 ? (
        <ul className="space-y-1 text-sm">{gate.blocking.map((blocker, index) => {
          const sentence = t(gateBlockerSentenceKey(blocker), {
            id: blocker.id,
            status: t(`delivery_os.report.status.${blocker.status}`, blocker.status),
          })
          const anchor = gateBlockerAnchor(blocker)
          return (
            <li key={gateBlockerKey(blocker, index)} className="break-words text-status-warning-text">
              {anchor ? <Link className="underline underline-offset-2" href={anchor}>{sentence}</Link> : sentence}
            </li>
          )
        })}</ul>
      ) : <p className="text-sm text-muted-foreground">{t('delivery_os.report.gate.noBlockers')}</p>}
    </div>
  )
}

export function ReportSummary({ report, readAt }: { report: DeliveryReportV1 & Partial<Pick<DeliveryReportResponse, 'mode' | 'flow' | 'currentCandidate'>>; readAt: string }) {
  const t = useT()
  const revision = report.revision
  return (
    <section id="report-summary" className="space-y-6" data-testid="delivery-report-summary">
      <SectionHeader title={t('delivery_os.report.summary.title')} />
      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        <Field label={t('delivery_os.report.summary.baseline')}><ShortHash value={report.baselineId} /></Field>
        <Field label={t('delivery_os.report.summary.hash')}><ShortHash value={report.baselineHash} /></Field>
        <Field label={t('delivery_os.report.summary.revision')}>
          {revision
            ? <ShortHash value={revision.kind === 'git' ? `git:${revision.commitSha}` : `snapshot:${revision.contentHash}`} />
            : t('delivery_os.report.status.missing')}
          {revision?.kind === 'snapshot' ? <ShortHash value={revision.externalWorkspaceId} /> : null}
        </Field>
        <Field label={t('delivery_os.report.summary.profile')}>{report.targetProfile.id} / {report.targetProfile.version}</Field>
        <Field label={t('delivery_os.report.summary.readAt')}><time dateTime={readAt}>{readAt}</time></Field>
        <Field label={t('delivery_os.report.summary.progress')}>
          {report.progress.proven} / {report.progress.total}
          {' — '}
          {!revision || report.progress.percent === null
            ? <span>{t('delivery_os.report.status.unknown')}</span>
            : <span>{report.progress.percent}%</span>}
        </Field>
        <Field label={t('delivery_os.report.summary.candidate')}>
          {report.currentCandidate
            ? `${report.currentCandidate.id} / ${report.currentCandidate.version}`
            : t('delivery_os.report.decisions.error.candidateRequired')}
        </Field>
      </dl>
      {report.revisionSource === 'latest_result' ? <Alert status="information">{t('delivery_os.report.summary.latestResult')}</Alert> : null}
      {!revision ? <Alert status="warning">{t('delivery_os.report.summary.noRevision')}</Alert> : null}
      <Alert status="information">{t(report.mode ? `delivery_os.report.summary.mode.${report.mode}` : 'delivery_os.report.summary.v1Scope')}</Alert>

      <div className="space-y-3">
        <SectionHeader title={t('delivery_os.report.gate.title')} />
        <div className="grid gap-4 sm:grid-cols-2">
          <GateSummary gate={report.gates.publishable} label={t('delivery_os.report.gate.publishable')} />
          <GateSummary gate={report.gates.releasable} label={t('delivery_os.report.gate.releasable')} />
        </div>
      </div>

      {report.mode === 'flow' ? (
        <div className="space-y-3">
          <SectionHeader title={t('delivery_os.report.summary.flowGate')} />
          {report.flow ? <>
            <StatusBadge variant={report.flow.gate.ok ? 'info' : 'warning'} dot>
              {t(`delivery_os.report.gate.${report.flow.gate.ok ? 'satisfied' : 'blocked'}`)}
            </StatusBadge>
            {report.flow.gate.blocking.length > 0 ? (
              <ul className="space-y-1 text-sm">{report.flow.gate.blocking.map((blocker, index) => (
                <li key={`${blocker.kind}:${blocker.stageId}:${index}`} className="break-words text-status-warning-text">
                  {t('delivery_os.report.flow.blockerSentence', {
                    blocker: t(`delivery_os.flow.blocker.${blocker.kind}`),
                    stage: t(`delivery_os.flow.stage.${blocker.stageId}`),
                  })}
                  {blocker.ref ? <> <ShortHash value={blocker.ref} /></> : null}
                </li>
              ))}</ul>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">{report.flow.stages.map((stage) => (
              <div key={stage.stageId} className="space-y-2 rounded-lg border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{t(`delivery_os.flow.stage.${stage.stageId}`)}</span>
                  <StatusBadge variant={currencyVariants[stage.currency] ?? 'neutral'} dot>
                    {t(`delivery_os.report.flow.currency.${stage.currency}`)}
                  </StatusBadge>
                </div>
                <p className="text-muted-foreground">
                  {t('delivery_os.report.flow.clientApproved')}: {t(`delivery_os.report.flow.${stage.clientApproved ? 'yes' : 'no'}`)}
                </p>
                {stage.approvedArtifact ? <ShortHash value={stage.approvedArtifact.contentHash} /> : null}
              </div>
            ))}</div>
          </> : <Alert status="warning">{t('delivery_os.report.decisions.error.flowBlocked')}</Alert>}
        </div>
      ) : null}

      <div className="space-y-3">
        <SectionHeader title={t('delivery_os.report.summary.criteria')} count={report.acceptanceCriteria.length} />
        {report.acceptanceCriteria.length === 0 ? <EmptyState title={t('delivery_os.report.summary.noCriteria')} /> : report.acceptanceCriteria.map((criterion) => (
          <details id={`report-ac-${criterion.acId}`} key={criterion.acId} className="rounded-lg border border-border p-4">
            <summary className="cursor-pointer">
              <span className="inline-flex flex-wrap items-center gap-2">
                <span className="font-medium">{criterion.acId}</span>
                <ProofStatus status={criterion.status} />
                <span>{criterion.description}</span>
              </span>
            </summary>
            <div className="mt-3 space-y-2 text-sm">
              <p className="text-muted-foreground">{t('delivery_os.report.summary.requirement')}: {criterion.requirementId}</p>
              {criterion.tests.length === 0 ? <p>{t('delivery_os.report.summary.noTests')}</p> : criterion.tests.map((test) => (
                <p key={test.testId} className="flex flex-wrap items-center gap-2">{test.testId} <ProofStatus status={test.status} /></p>
              ))}
              {criterion.manualCheck ? (
                <p className="flex flex-wrap items-center gap-2">
                  {t('delivery_os.report.summary.manualCheck')}: {criterion.manualCheck.manualCheckId} <ProofStatus status={criterion.manualCheck.status} />
                </p>
              ) : null}
            </div>
          </details>
        ))}
      </div>

      <div className="space-y-3">
        <SectionHeader title={t('delivery_os.report.summary.scans')} count={report.scans.length} />
        {report.scans.length === 0 ? <EmptyState title={t('delivery_os.report.summary.noScans')} /> : report.scans.map((scan) => (
          <div id={`report-scan-${scan.checkId}`} key={scan.checkId} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3 text-sm">
            <span className="font-medium">{scan.checkId}</span>
            <span className="text-muted-foreground">{t('delivery_os.report.summary.evidenceStatus')}:</span><ProofStatus status={scan.status} />
            <span className="text-muted-foreground">{t('delivery_os.report.summary.reportedStatus')}:</span><ProofStatus status={scan.reportedStatus ?? 'missing'} />
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <SectionHeader title={t('delivery_os.report.summary.usage')} />
        {report.usage.length === 0 ? <p className="text-sm text-muted-foreground">{t('delivery_os.report.status.unknown')}</p> : report.usage.map((usage) => (
          <div key={usage.evidenceId} className="space-y-1 text-sm">
            <p className="font-medium">{t(`delivery_os.report.usageSource.${usage.source}`)}</p>
            {usage.values === 'unknown' ? <p>{t('delivery_os.report.status.unknown')}</p> : (
              <dl className="flex flex-wrap gap-4">{(['inputTokens', 'outputTokens', 'totalTokens', 'costUsd'] as const).map((field) => (
                <div key={field}><dt className="text-xs text-muted-foreground">{t(`delivery_os.report.usage.${field}`)}</dt><dd>{usage.values === 'unknown' ? t('delivery_os.report.status.unknown') : usage.values[field] ?? t('delivery_os.report.status.unknown')}</dd></div>
              ))}</dl>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
