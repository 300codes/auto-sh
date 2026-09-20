'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import type { DeliveryReportV1 } from '../../lib/contracts'
import { ShortHash } from './ShortHash'

function safeDeploymentUrl(value: string | null): string | null {
  if (!value) return null
  try {
    const parsed = new URL(value)
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && !parsed.username && !parsed.password ? parsed.href : null
  } catch {
    return null
  }
}

export function DeploymentSummary({ report }: { report: DeliveryReportV1 }) {
  const t = useT()
  const deployment = report.deployment
  const url = safeDeploymentUrl(deployment.url)
  return (
    <section id="report-deployment" className="space-y-3" data-testid="delivery-report-deployment">
      <SectionHeader
        title={t('delivery_os.report.deployment.title')}
        action={<StatusBadge dot variant={deployment.status === 'verified' ? 'success' : 'neutral'}>{t(`delivery_os.report.status.${deployment.status}`)}</StatusBadge>}
      />
      {deployment.status === 'missing' ? <EmptyState title={t('delivery_os.report.deployment.missing')} /> : (
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div className="space-y-1">
            <dt className="text-xs text-muted-foreground">{t('delivery_os.report.deployment.verification')}</dt>
            <dd><StatusBadge dot variant={deployment.verificationStatus === 'failed' ? 'error' : deployment.verificationStatus === 'verified' ? 'success' : 'warning'}>{t(`delivery_os.report.status.${deployment.verificationStatus ?? 'missing'}`)}</StatusBadge></dd>
          </div>
          <div className="space-y-1">
            <dt className="text-xs text-muted-foreground">{t('delivery_os.report.deployment.environment')}</dt>
            <dd>{deployment.environment ?? t('delivery_os.report.status.unknown')}</dd>
          </div>
          <div className="space-y-1">
            <dt className="text-xs text-muted-foreground">{t('delivery_os.report.deployment.build')}</dt>
            <dd>{deployment.buildId ? <ShortHash value={deployment.buildId} /> : t('delivery_os.report.status.unknown')}</dd>
          </div>
          <div className="space-y-1">
            <dt className="text-xs text-muted-foreground">{t('delivery_os.report.deployment.evidence')}</dt>
            <dd>{deployment.evidenceId ? <ShortHash value={deployment.evidenceId} /> : t('delivery_os.report.status.missing')}</dd>
          </div>
        </dl>
      )}
      {url
        ? <a href={url} target="_blank" rel="noopener noreferrer" className="block break-all text-sm underline underline-offset-2">{url}</a>
        : <p className="text-sm text-muted-foreground">{t('delivery_os.report.deployment.noSafeUrl')}</p>}
    </section>
  )
}
