'use client'

import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { Alert } from '@open-mercato/ui/primitives/alert'

export function EvidenceSources() {
  const t = useT()
  return <section className="space-y-3" id="report-sources">
    <SectionHeader title={t('delivery_os.report.evidence.sources')} />
    <Alert status="information" data-testid="report-evidence-unavailable">{t('delivery_os.report.evidence.apiUnavailable')}</Alert>
  </section>
}
