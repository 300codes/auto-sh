'use client'

import { useT } from '@open-mercato/shared/lib/i18n/context'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'

export function ReleaseDecisionActions({ historical, archived }: { historical: boolean; archived: boolean }) {
  const t = useT()
  const { payload } = useBackendChrome()
  if (historical || archived) return null
  const canDeploy = hasFeature(payload?.grantedFeatures, 'delivery_os.deploy.approve')
  const canRelease = hasFeature(payload?.grantedFeatures, 'delivery_os.release.approve')
  return (
    <section className="space-y-3" data-testid="delivery-report-decisions">
      <SectionHeader title={t('delivery_os.report.decisions.title')} />
      <Alert status="warning" id="delivery-report-decision-blocker">
        {t('delivery_os.report.decisions.dependencies')}
      </Alert>
      {canDeploy || canRelease ? (
        <div className="flex flex-wrap gap-2" aria-describedby="delivery-report-decision-blocker">
          {canDeploy ? <Button type="button" disabled>{t('delivery_os.report.decisions.deploy')}</Button> : null}
          {canRelease ? <Button type="button" disabled>{t('delivery_os.report.decisions.release')}</Button> : null}
        </div>
      ) : null}
    </section>
  )
}
