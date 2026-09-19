'use client'
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { AiChat } from '@open-mercato/ui/ai/AiChat'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { scopingWidgetContextSchema, type ScopingWidgetContext } from '@open-mercato/core/modules/delivery_os/lib/scopingContext'

export default function ScopeAssistant({ context }: { context: ScopingWidgetContext }) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const parsed = scopingWidgetContextSchema.safeParse(context)
  if (!parsed.success) return null
  const projectId = parsed.data.projectId
  return <div>
    <Button type="button" variant="outline" onClick={() => setOpen(true)}>{t('delivery_agents.scope.open')}</Button>
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) void context.refresh?.() }}>
      <DialogContent className="flex h-full max-h-screen max-w-3xl flex-col">
        <DialogHeader><DialogTitle>{t('delivery_agents.scope.title')}</DialogTitle><DialogDescription>{t('delivery_agents.scope.description')}</DialogDescription></DialogHeader>
        {open ? <AiChat key={projectId} agent="delivery_agents.scope" pageContext={{ view: 'delivery_os.project.scoping', entityType: 'delivery_os.project', recordType: 'delivery_os.project', recordId: projectId, extra: { projectId, intakeUpdatedAt: parsed.data.intakeUpdatedAt } }} className="min-h-0 flex-1" placeholder={t('delivery_agents.scope.placeholder')} /> : null}
      </DialogContent>
    </Dialog>
  </div>
}
