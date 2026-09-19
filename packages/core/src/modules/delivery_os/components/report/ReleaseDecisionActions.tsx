'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import type { ReportSnapshot } from './useDeliveryReport'
import { decisionBlocker, type ReleaseDecisionKind, type ReleaseVerdict } from './decisionInput'
import { ReleaseDecisionDialog } from './ReleaseDecisionDialog'

export function ReleaseDecisionActions({ historical, archived, snapshot, stale = true, refresh }: {
  historical: boolean; archived: boolean; snapshot?: ReportSnapshot; stale?: boolean
  refresh?: () => Promise<ReportSnapshot | null>
}) {
  const t = useT()
  const { payload } = useBackendChrome()
  const [dialog, setDialog] = React.useState<{ snapshot: ReportSnapshot; kind: ReleaseDecisionKind; verdict: ReleaseVerdict } | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [problem, setProblem] = React.useState<string | null>(null)
  const opening = React.useRef(false)
  const active = React.useRef(true)
  React.useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  if (historical || archived) return null
  const open = async (kind: ReleaseDecisionKind, verdict: ReleaseVerdict) => {
    if (opening.current || !refresh || stale) return
    opening.current = true
    setLoading(true)
    setProblem(null)
    try {
      const fresh = await refresh()
      if (!active.current) return
      if (!fresh) { setProblem('refreshRequired'); return }
      const blocker = decisionBlocker(fresh, kind, verdict)
      if (blocker) { setProblem(blocker); return }
      setDialog({ snapshot: fresh, kind, verdict })
    } finally { opening.current = false; if (active.current) setLoading(false) }
  }
  return <section className="space-y-3" data-testid="delivery-report-decisions">
    <SectionHeader title={t('delivery_os.report.decisions.title')} />
    <Alert status="information">{t('delivery_os.report.decisions.consentOnly')}</Alert>
    {problem ? <Alert status="warning">{t(`delivery_os.report.decisions.error.${problem}`)}</Alert> : null}
    {(['deploy', 'release'] as const).filter((kind) => hasFeature(payload?.grantedFeatures, `delivery_os.${kind}.approve`)).map((kind) => {
      const blocker = snapshot ? decisionBlocker(snapshot, kind, 'approved') : 'refreshRequired'
      return <div key={kind} className="space-y-2">
        {blocker ? <p className="text-sm text-muted-foreground">{t(`delivery_os.report.decisions.error.${blocker}`)}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={loading || stale || Boolean(blocker)} onClick={() => void open(kind, 'approved')}>{t(`delivery_os.report.decisions.${kind}`)}</Button>
          <Button type="button" variant="outline" disabled={loading || stale || !snapshot || Boolean(snapshot && decisionBlocker(snapshot, kind, 'rejected'))} onClick={() => void open(kind, 'rejected')}>{t(`delivery_os.report.decisions.reject.${kind}`)}</Button>
        </div>
      </div>
    })}
    {dialog && refresh ? <ReleaseDecisionDialog {...dialog} refresh={refresh} onClose={() => setDialog(null)} /> : null}
  </section>
}
