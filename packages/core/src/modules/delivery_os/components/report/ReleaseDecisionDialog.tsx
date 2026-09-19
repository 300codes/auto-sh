'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { Button } from '@open-mercato/ui/primitives/button'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import type { ReportSnapshot } from './useDeliveryReport'
import { decisionBlocker, type ReleaseDecisionKind, type ReleaseVerdict } from './decisionInput'
import { formatRevisionRef } from './reportView'
import { DecisionHistory } from './DecisionHistory'
import { useReleaseDecision } from './useReleaseDecision'

type DecisionValues = Record<string, unknown> & { reason: string }

export function ReleaseDecisionDialog({ snapshot, kind, verdict, refresh, onClose }: {
  snapshot: ReportSnapshot; kind: ReleaseDecisionKind; verdict: ReleaseVerdict
  refresh: () => Promise<ReportSnapshot | null>; onClose: () => void
}) {
  const t = useT()
  const decision = useReleaseDecision({ snapshot, kind, verdict, refresh, onSaved: onClose })
  const form = React.useRef<HTMLDivElement>(null)
  const initialValues = React.useMemo(() => ({ reason: '' }), [])
  const fields = React.useMemo<CrudField[]>(() => [{ id: 'reason', type: 'textarea', label: t('delivery_os.report.decisions.reason'), required: verdict === 'rejected' }], [t, verdict])
  const blocker = decisionBlocker(decision.reviewed, kind, verdict)
  const disabled = decision.busy || decision.locked || Boolean(blocker)
  const report = decision.reviewed.report
  return <Dialog open onOpenChange={(open) => { if (!open && !decision.busy) onClose() }}>
    <DialogContent onEscapeKeyDown={(event) => { if (decision.busy) event.preventDefault() }} onKeyDownCapture={(event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        if (!disabled) form.current?.querySelector('form')?.requestSubmit()
      }
    }}>
      <DialogHeader>
        <DialogTitle>{t(`delivery_os.report.decisions.${kind}`)} — {t(`delivery_os.report.history.verdict.${verdict}`)}</DialogTitle>
        <DialogDescription>{t('delivery_os.report.decisions.consentOnly')}</DialogDescription>
      </DialogHeader>
      <dl className="space-y-2 break-all text-sm">
        <div><dt>{t('delivery_os.report.summary.baseline')}</dt><dd>{report.baselineId} / {report.baselineHash}</dd></div>
        <div><dt>{t('delivery_os.report.summary.revision')}</dt><dd>{report.revision ? formatRevisionRef(report.revision) : t('delivery_os.report.status.missing')}</dd></div>
        <div><dt>{t('delivery_os.report.summary.candidate')}</dt><dd>{report.currentCandidate?.id} / {report.currentCandidate?.version}</dd></div>
        {kind === 'release' ? <div><dt>{t('delivery_os.report.deployment.evidence')}</dt><dd>{report.deployment.evidenceId}</dd></div> : null}
      </dl>
      {decision.problem || blocker ? <Alert status="warning">{t(`delivery_os.report.decisions.error.${decision.problem ?? blocker}`)}</Alert> : null}
      {decision.blockers.length ? <ul className="text-sm">{decision.blockers.map((item, index) => <li key={index}>{item}</li>)}</ul> : null}
      {decision.problem === 'ambiguous' ? <DecisionHistory report={report} /> : null}
      {decision.locked ? <Button type="button" variant="outline" onClick={() => void decision.reviewAgain()}>{t('delivery_os.report.decisions.reviewAgain')}</Button> : null}
      <div ref={form}>
        <CrudForm<DecisionValues> embedded hideFooterActions disableOptimisticLock fields={fields} initialValues={initialValues} onSubmit={(values) => disabled ? undefined : decision.submit(values.reason ?? '')} />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" disabled={decision.busy} onClick={onClose}>{t('delivery_os.report.decisions.cancel')}</Button>
        <Button type="button" disabled={disabled} onClick={() => form.current?.querySelector('form')?.requestSubmit()}>{t('delivery_os.report.decisions.confirm')}</Button>
      </div>
    </DialogContent>
  </Dialog>
}
