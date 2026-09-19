'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { attemptReconcileResponseSchema } from '@open-mercato/core/modules/delivery_os/api/schemas'
import { ReconcileResolutionChoice } from './ReconcileResolutionChoice'
import { ResultIssueList } from './ResultIssueList'
import type { ResultIssue } from './resultImport'
import {
  RECONCILE_ERROR_KEYS,
  RECONCILE_FIELD_ERROR_KEYS,
  RECONCILIATION_RESOLUTIONS,
  buildReconcileRequest,
  emptyReconcileDraft,
  nowAsLocalInputValue,
  type ReconcileDraft,
} from './reconcileInput'

export type ReconcileAttemptDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  taskId: string
  attemptId: string
  taskUpdatedAt: string | null
  onReconciled: (taskUpdatedAt: string) => void
}

const CONTEXT_ID = 'delivery-task-reconcile-attempt'

/**
 * The only way to close an attempt whose real fate the system does not know.
 * Four resolutions, each recording what a human actually observed — `unknown`
 * among them, which is a decision to record the uncertainty rather than a
 * failure to decide. `completed` carries the manifest and reuses the very same
 * parser the result import does, so an attempt that already produced a result
 * outside the system has a way in.
 */
export function ReconcileAttemptDialog({
  open,
  onOpenChange,
  taskId,
  attemptId,
  taskUpdatedAt,
  onReconciled,
}: ReconcileAttemptDialogProps) {
  const t = useT()
  const [draft, setDraft] = React.useState<ReconcileDraft>(() => emptyReconcileDraft(nowAsLocalInputValue()))
  const [problem, setProblem] = React.useState<string | null>(null)
  const [manifestIssues, setManifestIssues] = React.useState<ResultIssue[]>([])
  const [serverError, setServerError] = React.useState<string | null>(null)
  const [serverIssues, setServerIssues] = React.useState<ResultIssue[]>([])
  const [submitting, setSubmitting] = React.useState(false)
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({ contextId: CONTEXT_ID })

  React.useEffect(() => {
    setDraft(emptyReconcileDraft(nowAsLocalInputValue()))
    setProblem(null)
    setManifestIssues([])
    setServerError(null)
    setServerIssues([])
  }, [open])

  const update = React.useCallback((patch: Partial<ReconcileDraft>) => {
    setDraft((current) => ({ ...current, ...patch }))
    setProblem(null)
    setManifestIssues([])
  }, [])

  const submit = React.useCallback(async () => {
    setServerError(null)
    setServerIssues([])
    const built = buildReconcileRequest(draft)
    if (!built.ok) {
      setProblem(t(RECONCILE_FIELD_ERROR_KEYS[built.field][built.reason] ?? 'delivery_os.task.reconcile.error.validationFailed'))
      setManifestIssues(built.issues ?? [])
      return
    }
    setProblem(null)
    setSubmitting(true)
    try {
      const call = await runMutation({
        operation: async () => {
          const response = await withScopedApiRequestHeaders(
            buildOptimisticLockHeader(taskUpdatedAt),
            () => apiCall<unknown>(
              `/api/delivery_os/tasks/${encodeURIComponent(taskId)}/attempts/${encodeURIComponent(attemptId)}/reconcile`,
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(built.body),
              },
            ),
          )
          if (!response.ok) {
            throw Object.assign(new Error('[internal] delivery_os.attempts.reconcile failed'), {
              status: response.status,
              ...((response.result as Record<string, unknown> | null) ?? {}),
            })
          }
          return response
        },
        context: { formId: CONTEXT_ID, resourceKind: 'delivery_os.task', resourceId: taskId, retryLastMutation },
        mutationPayload: { taskId, attemptId, resolution: built.body.resolution },
      })
      const body = attemptReconcileResponseSchema.safeParse(call.result)
      if (!body.success) {
        setServerError(t('delivery_os.task.reconcile.error.unreadableResponse'))
        return
      }
      flash(
        t(`delivery_os.task.reconcile.recorded.${body.data.resolution}`, {
          status: t(`delivery_os.project.sections.tasks.status.${body.data.taskStatus}`),
        }),
        body.data.resolution === 'unknown' ? 'warning' : 'success',
      )
      onReconciled(body.data.taskUpdatedAt)
      onOpenChange(false)
    } catch (error) {
      if (surfaceRecordConflict(error, t, { title: t('delivery_os.task.reconcile.error.conflictTitle') })) return
      const details = (error as { details?: unknown } | null)?.details
      if (Array.isArray(details)) {
        setServerIssues(details.map((detail) => {
          const entry = detail as { path?: unknown; code?: unknown; message?: unknown }
          return {
            path: typeof entry.path === 'string' ? entry.path : '',
            code: typeof entry.code === 'string' ? entry.code : 'unknown',
            message: typeof entry.message === 'string' ? entry.message : '',
          }
        }))
      }
      const code = (error as { code?: unknown } | null)?.code
      const key = typeof code === 'string' ? RECONCILE_ERROR_KEYS[code] : undefined
      setServerError(key ? t(key) : t('delivery_os.task.reconcile.error.unnamed'))
    } finally {
      setSubmitting(false)
    }
  }, [attemptId, draft, onOpenChange, onReconciled, retryLastMutation, runMutation, t, taskId, taskUpdatedAt])

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void submit()
    }
  }, [submit])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" data-testid="reconcile-attempt-dialog">
        <DialogHeader>
          <DialogTitle>{t('delivery_os.task.reconcile.title')}</DialogTitle>
          <DialogDescription>{t('delivery_os.task.reconcile.description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3" onKeyDown={handleKeyDown}>
          <div className="grid gap-2 sm:grid-cols-2" data-testid="reconcile-resolutions">
            {RECONCILIATION_RESOLUTIONS.map((resolution) => (
              <ReconcileResolutionChoice
                key={resolution}
                resolution={resolution}
                selected={draft.resolution === resolution}
                onSelect={() => update({ resolution })}
              />
            ))}
          </div>
          <div className="space-y-1">
            <Label htmlFor="reconcile-note">{t('delivery_os.task.reconcile.noteLabel')}</Label>
            <Textarea
              id="reconcile-note"
              data-testid="reconcile-note"
              rows={3}
              value={draft.note}
              onChange={(event) => update({ note: event.target.value })}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="reconcile-observed-at">{t('delivery_os.task.reconcile.observedAtLabel')}</Label>
              <Input
                id="reconcile-observed-at"
                data-testid="reconcile-observed-at"
                type="datetime-local"
                value={draft.observedAt}
                onChange={(event) => update({ observedAt: event.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="reconcile-external-run-id">{t('delivery_os.task.reconcile.externalRunIdLabel')}</Label>
              <Input
                id="reconcile-external-run-id"
                data-testid="reconcile-external-run-id"
                className="font-mono text-xs"
                value={draft.externalRunId}
                onChange={(event) => update({ externalRunId: event.target.value })}
              />
            </div>
          </div>
          {draft.resolution === 'completed' ? (
            <div className="space-y-1">
              <Label htmlFor="reconcile-manifest">{t('delivery_os.task.reconcile.manifestLabel')}</Label>
              <p className="text-xs text-muted-foreground">{t('delivery_os.task.reconcile.manifestHelp')}</p>
              <Textarea
                id="reconcile-manifest"
                data-testid="reconcile-manifest"
                rows={10}
                className="font-mono text-xs"
                value={draft.manifestRaw}
                onChange={(event) => update({ manifestRaw: event.target.value })}
              />
            </div>
          ) : null}
          {problem ? (
            <p className="text-sm text-status-error-text" data-testid="reconcile-problem">{problem}</p>
          ) : null}
          {manifestIssues.length > 0 ? (
            <ResultIssueList issues={manifestIssues} label={t('delivery_os.task.reconcile.error.manifestSchema')} />
          ) : null}
          {serverError ? (
            <p className="text-sm text-status-error-text" data-testid="reconcile-server-error">{serverError}</p>
          ) : null}
          {serverIssues.length > 0 ? (
            <ResultIssueList issues={serverIssues} label={t('delivery_os.task.reconcile.error.serverDetails')} />
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('delivery_os.task.reconcile.cancel')}
          </Button>
          <Button type="button" disabled={submitting} data-testid="reconcile-submit" onClick={() => void submit()}>
            {t('delivery_os.task.reconcile.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
