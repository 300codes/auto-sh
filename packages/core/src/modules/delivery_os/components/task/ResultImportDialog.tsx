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
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { resultAcceptResponseSchema } from '@open-mercato/core/modules/delivery_os/api/schemas'
import { deliveryErrorBodySchema, type ResultManifestV1 } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { ResultSummary } from './ResultSummary'
import { ResultIssueList } from './ResultIssueList'
import {
  MAX_RESULT_MANIFEST_CHARS,
  manifestTargetsAttempt,
  parseResultManifest,
  type ResultIssue,
} from './resultImport'

type Translate = ReturnType<typeof useT>

export type ResultImportDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  taskId: string
  /** `null` means no attempt is reserved, so there is nowhere to put a result. */
  attemptId: string | null
  taskUpdatedAt: string | null
  onImported: (accepted: { manifest: ResultManifestV1; taskUpdatedAt: string; duplicate: boolean }) => void
}

type ClientProblem =
  | { kind: 'empty' }
  | { kind: 'tooLarge'; length: number }
  | { kind: 'notJson' }
  | { kind: 'notObject' }
  | { kind: 'schema'; issues: ResultIssue[] }
  | { kind: 'foreignAttempt' }
  | { kind: 'noAttempt' }

const CONTEXT_ID = 'delivery-task-result-import'

/**
 * Each refusal names a different cause and a different way out. `result_conflict`
 * means a DIFFERENT result already answered this attempt; `attempt_not_active`
 * means the attempt no longer accepts one at all. One message for both would
 * turn the check into decoration.
 */
const RESULT_ERROR_KEYS: Record<string, string> = {
  result_conflict: 'delivery_os.task.result.error.resultConflict',
  attempt_not_active: 'delivery_os.task.result.error.attemptNotActive',
  attempt_cancelled: 'delivery_os.task.result.error.attemptCancelled',
  attempt_closed: 'delivery_os.task.result.error.attemptClosed',
  reconciliation_required: 'delivery_os.task.result.error.reconciliationRequired',
  correction_limit_reached: 'delivery_os.task.result.error.correctionLimitReached',
  payload_too_large: 'delivery_os.task.result.error.payloadTooLarge',
  path_not_allowed: 'delivery_os.task.result.error.pathNotAllowed',
  unknown_test_id: 'delivery_os.task.result.error.unknownTestId',
  unknown_ac: 'delivery_os.task.result.error.unknownAc',
  correlation_mismatch: 'delivery_os.task.result.error.correlationMismatch',
  baseline_mismatch: 'delivery_os.task.result.error.baselineMismatch',
  base_revision_mismatch: 'delivery_os.task.result.error.baseRevisionMismatch',
  revision_kind_mismatch: 'delivery_os.task.result.error.revisionKindMismatch',
  unsupported_schema_version: 'delivery_os.task.result.error.unsupportedSchemaVersion',
  attempt_not_found: 'delivery_os.task.result.error.attemptNotFound',
  not_found: 'delivery_os.task.result.error.notFound',
  forbidden: 'delivery_os.task.result.error.forbidden',
  validation_failed: 'delivery_os.task.result.error.validationFailed',
  optimistic_lock_required: 'delivery_os.task.result.error.lockRequired',
}

function describeProblem(problem: Exclude<ClientProblem, { kind: 'schema' }>, t: Translate): string {
  switch (problem.kind) {
    case 'empty': return t('delivery_os.task.result.error.empty')
    case 'notJson': return t('delivery_os.task.result.error.notJson')
    case 'notObject': return t('delivery_os.task.result.error.notObject')
    case 'foreignAttempt': return t('delivery_os.task.result.error.foreignAttempt')
    case 'noAttempt': return t('delivery_os.task.result.error.noAttempt')
    default: return t('delivery_os.task.result.error.tooLarge', { length: problem.length, limit: MAX_RESULT_MANIFEST_CHARS })
  }
}

export function ResultImportDialog({
  open,
  onOpenChange,
  taskId,
  attemptId,
  taskUpdatedAt,
  onImported,
}: ResultImportDialogProps) {
  const t = useT()
  const [raw, setRaw] = React.useState('')
  const [problem, setProblem] = React.useState<ClientProblem | null>(null)
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
    setRaw('')
    setProblem(null)
    setServerError(null)
    setServerIssues([])
  }, [open])

  const parsed = React.useMemo(() => (raw.trim().length === 0 ? null : parseResultManifest(raw)), [raw])

  const submit = React.useCallback(async () => {
    setServerError(null)
    setServerIssues([])
    if (attemptId === null) {
      setProblem({ kind: 'noAttempt' })
      return
    }
    const result = parseResultManifest(raw)
    if (!result.ok) {
      setProblem(
        result.reason === 'empty' ? { kind: 'empty' }
          : result.reason === 'too_large' ? { kind: 'tooLarge', length: result.length }
          : result.reason === 'not_json' ? { kind: 'notJson' }
          : result.reason === 'not_object' ? { kind: 'notObject' }
          : { kind: 'schema', issues: result.issues },
      )
      return
    }
    if (!manifestTargetsAttempt(result.manifest, { taskId, attemptId })) {
      setProblem({ kind: 'foreignAttempt' })
      return
    }
    setProblem(null)
    setSubmitting(true)
    try {
      const call = await runMutation({
        operation: async () => {
          const response = await withScopedApiRequestHeaders(
            buildOptimisticLockHeader(taskUpdatedAt),
            () => apiCall<unknown>(`/api/delivery_os/tasks/${encodeURIComponent(taskId)}/results`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ attemptId, manifest: result.manifest }),
            }),
          )
          if (!response.ok) {
            throw Object.assign(new Error('[internal] delivery_os.results.accept failed'), {
              status: response.status,
              ...((response.result as Record<string, unknown> | null) ?? {}),
            })
          }
          return response
        },
        context: { formId: CONTEXT_ID, resourceKind: 'delivery_os.task', resourceId: taskId, retryLastMutation },
        mutationPayload: { taskId, attemptId },
      })
      const body = resultAcceptResponseSchema.safeParse(call.result)
      if (!body.success) {
        setServerError(t('delivery_os.task.result.error.unreadableResponse'))
        return
      }
      // A replay is a SUCCESS: the same manifest for the same attempt was already
      // accepted, so no second evidence was written and nothing is wrong.
      flash(
        body.data.duplicate
          ? t('delivery_os.task.result.duplicate', { status: t(`delivery_os.project.sections.tasks.status.${body.data.taskStatus}`) })
          : t('delivery_os.task.result.accepted', { status: t(`delivery_os.project.sections.tasks.status.${body.data.taskStatus}`) }),
        body.data.duplicate ? 'info' : 'success',
      )
      onImported({ manifest: result.manifest, taskUpdatedAt: body.data.taskUpdatedAt, duplicate: body.data.duplicate })
      onOpenChange(false)
    } catch (error) {
      if (surfaceRecordConflict(error, t, { title: t('delivery_os.task.result.error.conflictTitle') })) return
      const parsedBody = deliveryErrorBodySchema.safeParse(error)
      if (parsedBody.success && parsedBody.data.details.length > 0) {
        setServerIssues(parsedBody.data.details.map((detail) => ({
          path: detail.path ?? '',
          code: detail.code,
          message: detail.message ?? '',
        })))
      }
      const code = (error as { code?: unknown } | null)?.code
      const key = typeof code === 'string' ? RESULT_ERROR_KEYS[code] : undefined
      setServerError(key ? t(key) : t('delivery_os.task.result.error.unnamed'))
    } finally {
      setSubmitting(false)
    }
  }, [attemptId, onImported, onOpenChange, raw, retryLastMutation, runMutation, t, taskId, taskUpdatedAt])

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void submit()
    }
  }, [submit])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" data-testid="result-import-dialog">
        <DialogHeader>
          <DialogTitle>{t('delivery_os.task.result.title')}</DialogTitle>
          <DialogDescription>{t('delivery_os.task.result.description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Textarea
            data-testid="result-import-textarea"
            aria-label={t('delivery_os.task.result.manifestLabel')}
            value={raw}
            rows={12}
            className="font-mono text-xs"
            onChange={(event) => { setRaw(event.target.value); setProblem(null); setServerError(null); setServerIssues([]) }}
            onKeyDown={handleKeyDown}
          />
          <p className="text-xs text-muted-foreground" data-testid="result-import-counter">
            {t('delivery_os.task.result.charCount', { count: raw.trim().length, limit: MAX_RESULT_MANIFEST_CHARS })}
          </p>
          {parsed?.ok ? <ResultSummary manifest={parsed.manifest} source="manual" /> : null}
          {problem?.kind === 'schema' ? (
            <ResultIssueList issues={problem.issues} label={t('delivery_os.task.result.error.schema')} />
          ) : null}
          {problem && problem.kind !== 'schema' ? (
            <p data-testid="result-import-problem" className="text-sm text-status-error-text">
              {describeProblem(problem, t)}
            </p>
          ) : null}
          {serverError ? (
            <p data-testid="result-import-server-error" className="text-sm text-status-error-text">{serverError}</p>
          ) : null}
          {serverIssues.length > 0 ? (
            <ResultIssueList issues={serverIssues} label={t('delivery_os.task.result.error.serverDetails')} />
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('delivery_os.task.result.cancel')}
          </Button>
          <Button type="button" disabled={submitting} onClick={() => void submit()} data-testid="result-import-submit">
            {t('delivery_os.task.result.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
