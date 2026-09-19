'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'

export function EvidenceDetailDialog({ evidenceId, onOpenChange }: { evidenceId: string | null; onOpenChange: (open: boolean) => void }) {
  const t = useT()
  const trigger = React.useRef<HTMLElement | null>(null)
  return <Dialog open={evidenceId !== null} onOpenChange={onOpenChange}>
    <DialogContent
      onOpenAutoFocus={() => { trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null }}
      onCloseAutoFocus={(event) => { event.preventDefault(); trigger.current?.focus() }}>
      <DialogHeader>
        <DialogTitle>{t('delivery_os.report.evidence.detail')}</DialogTitle>
        <DialogDescription className="break-all">{evidenceId}</DialogDescription>
      </DialogHeader>
      <Alert status="information">{t('delivery_os.report.evidence.detailUnavailable')}</Alert>
      <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('delivery_os.report.evidence.close')}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
