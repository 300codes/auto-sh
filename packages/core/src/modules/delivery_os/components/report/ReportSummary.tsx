'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import type { DeliveryReportV1, ReportGate } from '../../lib/contracts'

import type { DeliveryReportResponse } from '../../lib/reportContracts'

const statusVariants: Record<string, StatusBadgeVariant> = {
  passed: 'success', failed: 'error', approved: 'success', changes_requested: 'warning',
  missing: 'neutral', not_run: 'neutral', manual_pending: 'warning', present: 'info',
}

function ProofStatus({ status }: { status: string }) {
  const t = useT()
  return <StatusBadge variant={statusVariants[status] ?? 'neutral'}>{t(`delivery_os.report.status.${status}`)}</StatusBadge>
}

function GateSummary({ gate, label }: { gate: ReportGate; label: string }) {
  const t = useT()
  return (
    <div className="space-y-2">
      <p className="font-medium">{label}</p>
      <StatusBadge variant={gate.ok ? 'info' : 'warning'}>
        {t(`delivery_os.report.gate.${gate.ok ? 'satisfied' : 'blocked'}`)}
      </StatusBadge>
      {gate.blocking.length > 0 ? <ul className="space-y-1 text-sm">{gate.blocking.map((blocker, index) => (
        <li key={`${blocker.kind}:${blocker.id}:${index}`} className="break-words">
          {t(`delivery_os.report.blocker.${blocker.kind}`)}: {blocker.id} — {t(`delivery_os.report.status.${blocker.status}`, blocker.status)}
        </li>
      ))}</ul> : null}
    </div>
  )
}

export function ReportSummary({ report, readAt }: { report: DeliveryReportV1 & Partial<Pick<DeliveryReportResponse, 'mode' | 'flow' | 'currentCandidate'>>; readAt: string }) {
  const t = useT()
  const revision = report.revision
  return (
    <section className="space-y-4" data-testid="delivery-report-summary">
      <SectionHeader title={t('delivery_os.report.summary.title')} />
      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        <div><dt className="text-muted-foreground">{t('delivery_os.report.summary.baseline')}</dt><dd className="break-all">{report.baselineId}</dd></div>
        <div><dt className="text-muted-foreground">{t('delivery_os.report.summary.hash')}</dt><dd className="break-all font-mono">{report.baselineHash}</dd></div>
        <div><dt className="text-muted-foreground">{t('delivery_os.report.summary.revision')}</dt><dd className="break-all font-mono">{revision ? revision.kind === 'git' ? `git:${revision.commitSha}` : `snapshot:${revision.contentHash}` : t('delivery_os.report.status.missing')}</dd>
          {revision?.kind === 'snapshot' ? <dd className="break-all">{revision.externalWorkspaceId}</dd> : null}
        </div>
        <div><dt className="text-muted-foreground">{t('delivery_os.report.summary.profile')}</dt><dd>{report.targetProfile.id} / {report.targetProfile.version}</dd></div>
        <div><dt className="text-muted-foreground">{t('delivery_os.report.summary.readAt')}</dt><dd><time dateTime={readAt}>{readAt}</time></dd></div>
        <div><dt className="text-muted-foreground">{t('delivery_os.report.summary.progress')}</dt><dd>{report.progress.proven} / {report.progress.total} — {!revision || report.progress.percent === null ? t('delivery_os.report.status.unknown') : `${report.progress.percent}%`}</dd></div>
      </dl>
      {report.revisionSource === 'latest_result' ? <Alert status="information">{t('delivery_os.report.summary.latestResult')}</Alert> : null}
      {!revision ? <Alert status="warning">{t('delivery_os.report.summary.noRevision')}</Alert> : null}
      <Alert status="information">{t(report.mode ? `delivery_os.report.summary.mode.${report.mode}` : 'delivery_os.report.summary.v1Scope')}</Alert>
      <div className="space-y-2 text-sm">
        <p>{t('delivery_os.report.summary.candidate')}: {report.currentCandidate ? `${report.currentCandidate.id} / ${report.currentCandidate.version}` : t('delivery_os.report.decisions.error.candidateRequired')}</p>
        {report.mode === 'flow' && report.flow ? <>
          <p>{t('delivery_os.report.summary.flowGate')}: {t(`delivery_os.report.gate.${report.flow.gate.ok ? 'satisfied' : 'blocked'}`)}</p>
          {report.flow.gate.blocking.map((blocker, index) => <p key={index}>{t(`delivery_os.flow.blocker.${blocker.kind}`)} {blocker.stageId} {blocker.ref}</p>)}
          {report.flow.stages.map((stage) => <div key={stage.stageId} className="space-y-1 rounded-lg border border-border p-3">
            <p>{stage.stageId} — {t(`delivery_os.report.flow.currency.${stage.currency}`)}</p>
            <p>{t('delivery_os.report.flow.clientApproved')}: {t(`delivery_os.report.flow.${stage.clientApproved ? 'yes' : 'no'}`)}</p>
            {stage.approvedArtifact ? <p className="break-all font-mono">{stage.approvedArtifact.artifactId} / {stage.approvedArtifact.contentHash}</p> : null}
          </div>)}
        </> : report.mode === 'flow' ? <Alert status="warning">{t('delivery_os.report.decisions.error.flowBlocked')}</Alert> : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <GateSummary gate={report.gates.publishable} label={t('delivery_os.report.gate.publishable')} />
        <GateSummary gate={report.gates.releasable} label={t('delivery_os.report.gate.releasable')} />
      </div>
      <SectionHeader title={t('delivery_os.report.summary.criteria')} count={report.acceptanceCriteria.length} />
      {report.acceptanceCriteria.length === 0 ? <EmptyState title={t('delivery_os.report.summary.noCriteria')} /> : report.acceptanceCriteria.map((criterion) => (
        <details key={criterion.acId} className="rounded-lg border border-border p-4">
          <summary className="cursor-pointer space-x-2"><span>{criterion.acId}</span><ProofStatus status={criterion.status} /><span>{criterion.description}</span></summary>
          <div className="mt-3 space-y-2 text-sm">
            <p>{t('delivery_os.report.summary.requirement')}: {criterion.requirementId}</p>
            {criterion.tests.length === 0 ? <p>{t('delivery_os.report.summary.noTests')}</p> : criterion.tests.map((test) => <p key={test.testId}>{test.testId} <ProofStatus status={test.status} /></p>)}
            {criterion.manualCheck ? <p>{t('delivery_os.report.summary.manualCheck')}: {criterion.manualCheck.manualCheckId} <ProofStatus status={criterion.manualCheck.status} /></p> : null}
          </div>
        </details>
      ))}
      <SectionHeader title={t('delivery_os.report.summary.scans')} />
      {report.scans.length === 0 ? <EmptyState title={t('delivery_os.report.summary.noScans')} /> : report.scans.map((scan) => (
        <div key={scan.checkId} className="flex flex-wrap gap-2 text-sm">
          <span>{scan.checkId}</span><span>{t('delivery_os.report.summary.evidenceStatus')}:</span><ProofStatus status={scan.status} />
          <span>{t('delivery_os.report.summary.reportedStatus')}:</span><ProofStatus status={scan.reportedStatus ?? 'missing'} />
        </div>
      ))}
      <SectionHeader title={t('delivery_os.report.summary.usage')} />
      {report.usage.length === 0 ? <p className="text-sm text-muted-foreground">{t('delivery_os.report.status.unknown')}</p> : report.usage.map((usage) => (
        <div key={usage.evidenceId} className="space-y-1 text-sm">
          <p>{t(`delivery_os.report.usageSource.${usage.source}`)}</p>
          {usage.values === 'unknown' ? <p>{t('delivery_os.report.status.unknown')}</p> : (
            <dl className="flex flex-wrap gap-4">{(['inputTokens', 'outputTokens', 'totalTokens', 'costUsd'] as const).map((field) => (
              <div key={field}><dt className="text-muted-foreground">{t(`delivery_os.report.usage.${field}`)}</dt><dd>{usage.values === 'unknown' ? t('delivery_os.report.status.unknown') : usage.values[field] ?? t('delivery_os.report.status.unknown')}</dd></div>
            ))}</dl>
          )}
        </div>
      ))}
    </section>
  )
}
