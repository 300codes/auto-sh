'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { evidenceRecordResponseSchema } from '../../api/schemas'
import type { AcceptedResultSummary } from '../../lib/resultReadContracts'

type Values = Record<string, unknown> & { verdict: string; summary: string; manualCheckId: string }

/**
 * `open`/`onOpenChange` are optional: the button next to the result opens the
 * review on its own, and the next-step callout opens the same dialog from the
 * top of the screen without a second review path existing.
 */
export function TaskReviewAction({ result, taskUpdatedAt, onMutated, open: controlledOpen, onOpenChange }: {
  result: AcceptedResultSummary
  taskUpdatedAt: string | null
  onMutated: (updatedAt: string) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const t = useT()
  const [internalOpen, setInternalOpen] = React.useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = React.useCallback((next: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(next)
    onOpenChange?.(next)
  }, [controlledOpen, onOpenChange])
  const form = React.useRef<HTMLDivElement>(null)
  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'verdict', type: 'select', required: true, label: t('delivery_os.task.review.verdict'), options: [
      { value: 'approved', label: t('delivery_os.task.review.approved') },
      { value: 'changes_requested', label: t('delivery_os.task.review.changesRequested') },
    ] },
    { id: 'summary', type: 'textarea', required: true, label: t('delivery_os.task.review.summary') },
    { id: 'manualCheckId', type: 'text', label: t('delivery_os.task.review.manualCheckId'), description: t('delivery_os.task.review.manualCheckHelp') },
  ], [t])
  return <>
    <Button type="button" data-testid="task-review-open" onClick={() => setOpen(true)}>{t('delivery_os.task.review.action')}</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent onKeyDownCapture={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault()
          event.stopPropagation()
          form.current?.querySelector('form')?.requestSubmit()
        }
      }}>
        <DialogHeader><DialogTitle>{t('delivery_os.task.review.action')}</DialogTitle></DialogHeader>
        <div ref={form}>
          <CrudForm<Values> embedded entityId="delivery_os.task_review" fields={fields}
            initialValues={{ id: result.taskId, updatedAt: taskUpdatedAt, verdict: 'changes_requested', summary: '', manualCheckId: '' }}
            submitLabel={t('delivery_os.task.review.submit')}
            onSubmit={async (values) => {
              const summary = values.summary.trim()
              if (!summary) throw createCrudFormError(t('delivery_os.task.review.summaryRequired'))
              const response = await apiCall<unknown>(`/api/delivery_os/projects/${encodeURIComponent(result.projectId)}/evidence`, {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ kind: 'review', baselineId: result.baselineId, taskId: result.taskId, attemptId: result.attemptId,
                  sourceRevision: result.sourceRevision, payload: { verdict: values.verdict, summary, findings: [], reviewer: { kind: 'human' },
                    reviewedEvidenceId: result.evidenceId, ...(values.manualCheckId.trim() ? { manualCheckId: values.manualCheckId.trim() } : {}) } }),
              })
              if (!response.ok) {
                const error = Object.assign(new Error('[internal] task review failed'), { status: response.status, ...(response.result as Record<string, unknown> ?? {}) })
                if (surfaceRecordConflict(error, t)) throw error
                throw createCrudFormError(t('delivery_os.task.review.failed'))
              }
              const parsed = evidenceRecordResponseSchema.safeParse(response.result)
              if (!parsed.success || (!values.manualCheckId.trim() && !parsed.data.taskUpdatedAt)) throw createCrudFormError(t('delivery_os.task.review.failed'))
              onMutated(parsed.data.taskUpdatedAt ?? taskUpdatedAt ?? '')
              setOpen(false)
            }} />
        </div>
      </DialogContent>
    </Dialog>
  </>
}
