'use client'

import * as React from 'react'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useEvidenceDetail } from './useEvidenceRead'
import { evidenceAttachmentUrl } from '../../lib/evidenceReadContracts'
import { evidenceRevisionLabel } from './evidenceView'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'

export function EvidenceDetailDialog({ projectId, evidenceId, onOpenChange }: { projectId?: string; evidenceId: string | null; onOpenChange: (open: boolean) => void }) {
  const t = useT()
  const state = useEvidenceDetail(projectId, evidenceId)
  const trigger = React.useRef<HTMLElement | null>(null)
  return <Dialog open={evidenceId !== null} onOpenChange={onOpenChange}>
    <DialogContent
      onOpenAutoFocus={() => { trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null }}
      onCloseAutoFocus={(event) => { event.preventDefault(); trigger.current?.focus() }}>
      <DialogHeader>
        <DialogTitle>{t('delivery_os.report.evidence.detail')}</DialogTitle>
        <DialogDescription className="break-all">{evidenceId}</DialogDescription>
      </DialogHeader>
      {state.status === 'loading' ? <LoadingMessage label={t('delivery_os.report.evidence.loading')} /> : state.status !== 'ready' || !state.data ? <><ErrorMessage label={t(`delivery_os.report.evidence.${state.status}`)} /><Button variant="outline" onClick={state.reload}>{t('delivery_os.report.evidence.retry')}</Button></> : <div className="max-h-96 space-y-3 overflow-auto">
        <p className="font-medium">{t(`delivery_os.report.evidence.kind.${state.data.kind}`)}</p>
        <dl className="grid gap-3 break-all text-sm sm:grid-cols-2">
          <div className="space-y-1"><dt className="text-xs text-muted-foreground">{t('delivery_os.report.evidence.source')}</dt><dd>{t(`delivery_os.report.evidence.source.${state.data.source}`)}</dd></div>
          <div className="space-y-1"><dt className="text-xs text-muted-foreground">{t('delivery_os.report.evidence.createdAt')}</dt><dd><time dateTime={state.data.createdAt}>{state.data.createdAt}</time></dd></div>
          <div className="space-y-1"><dt className="text-xs text-muted-foreground">{t('delivery_os.report.summary.baseline')}</dt><dd>{state.data.baselineId}</dd></div>
          <div className="space-y-1"><dt className="text-xs text-muted-foreground">{t('delivery_os.report.evidence.task')}</dt><dd>{state.data.taskId ?? t('delivery_os.report.evidence.notLinked')}</dd></div>
          <div className="space-y-1"><dt className="text-xs text-muted-foreground">{t('delivery_os.report.evidence.attempt')}</dt><dd>{state.data.attemptId ?? t('delivery_os.report.evidence.notLinked')}</dd></div>
          <div className="space-y-1"><dt className="text-xs text-muted-foreground">{t('delivery_os.report.evidence.revision')}</dt><dd>{evidenceRevisionLabel(state.data.sourceRevision) ?? t('delivery_os.report.evidence.group.baseline')}</dd></div>
        </dl>
        <details className="rounded-md border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">{t('delivery_os.report.evidence.technical')}</summary>
          <div className="mt-2 space-y-2">
            <p className="break-all text-sm">{t('delivery_os.report.evidence.hash')}: {state.data.rawReportHash ?? t('delivery_os.report.evidence.notLinked')}</p>
            <pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(state.data.payload, null, 2)}</pre>
          </div>
        </details>
        {state.data.attachments.length === 0 ? <p>{t('delivery_os.report.evidence.noFiles')}</p> : state.data.attachments.map((attachment) => <EvidenceFile key={attachment.id} url={evidenceAttachmentUrl(state.data!.projectId, state.data!.id, attachment.id)} preview={attachment.previewUrl !== null} />)}
        {state.data.attachmentsTruncated ? <Alert status="warning">{t('delivery_os.report.evidence.filesTruncated')}</Alert> : null}
      </div>}
      <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('delivery_os.report.evidence.close')}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}

function EvidenceFile({ url, preview }: { url: string; preview: boolean }) {
  const t = useT()
  const scope = useOrganizationScopeVersion()
  const key = JSON.stringify([scope, url])
  const [enabled, setEnabled] = React.useState(preview)
  const [state, setState] = React.useState<{ key: string; objectUrl: string | null; failed: boolean }>({ key, objectUrl: null, failed: false })
  React.useEffect(() => {
    let disposed = false
    let objectUrl: string | null = null
    const controller = new AbortController()
    setState({ key, objectUrl: null, failed: false })
    if (enabled) void (async () => {
      try {
        const response = await apiCall<Blob>(url, { signal: controller.signal }, { parse: (response) => response.blob() })
        if (disposed) return
        if (!response.ok || !response.result) { setState({ key, objectUrl: null, failed: true }); return }
        objectUrl = URL.createObjectURL(response.result)
        setState({ key, objectUrl, failed: false })
      } catch { if (!disposed) setState({ key, objectUrl: null, failed: true }) }
    })()
    return () => { disposed = true; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [key, url, enabled])
  if (!enabled) return <Button variant="outline" onClick={() => setEnabled(true)}>{t('delivery_os.report.evidence.loadFile')}</Button>
  if (state.key !== key || !state.objectUrl && !state.failed) return <LoadingMessage label={t('delivery_os.report.evidence.loading')} />
  if (state.failed) return <ErrorMessage label={t('delivery_os.report.evidence.fileUnavailable')} />
  return <div className="space-y-2">{preview ? <img src={state.objectUrl!} alt={t('delivery_os.report.evidence.screenshot')} className="max-h-80 max-w-full object-contain" /> : null}<a className="underline" href={state.objectUrl!} download="evidence">{t('delivery_os.report.evidence.download')}</a></div>
}
