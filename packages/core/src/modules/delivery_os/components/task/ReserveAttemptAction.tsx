'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import {
  MAX_EXECUTION_ATTEMPTS,
  reserveAttemptResponseSchema,
  type ReserveAttemptResponse,
} from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { getTargetProfile } from '@open-mercato/core/modules/delivery_os/lib/targetProfiles'
import { buildAttemptIdempotencyKey } from './attemptKey'
import { emptyRevisionDraft, parseRevisionDraft, type RevisionDraft, type RevisionField } from './baseRevision'

export type ReserveAttemptActionProps = {
  taskId: string
  targetProfileId: string
  targetProfileVersion: number
  attemptNumber: number
  activeAttemptNumber: number | null
  taskUpdatedAt: string | null
  onReserved: (reservation: ReserveAttemptResponse) => void
}

const CONTEXT_ID = 'delivery-task-reserve-attempt'

/**
 * Every code the reserve endpoint can answer with, mapped to its own sentence.
 * `attempt_active` and `idempotency_conflict` are both 409 and both about a
 * second attempt, but the first says "something else is running" and the second
 * says "this key was used with another payload" — one message for both would
 * send the operator to the wrong place.
 */
const RESERVE_ERROR_KEYS: Record<string, string> = {
  attempt_limit_reached: 'delivery_os.task.reserve.error.attemptLimitReached',
  idempotency_conflict: 'delivery_os.task.reserve.error.idempotencyConflict',
  task_not_ready: 'delivery_os.task.reserve.error.taskNotReady',
  dependency_not_verified: 'delivery_os.task.reserve.error.dependencyNotVerified',
  reconciliation_required: 'delivery_os.task.reserve.error.reconciliationRequired',
  revision_kind_mismatch: 'delivery_os.task.reserve.error.revisionKindMismatch',
  unknown_target_profile: 'delivery_os.task.reserve.error.unknownTargetProfile',
  baseline_not_active: 'delivery_os.task.reserve.error.baselineNotActive',
  foreign_reference: 'delivery_os.task.reserve.error.foreignBaseline',
  forbidden: 'delivery_os.task.reserve.error.forbidden',
  not_found: 'delivery_os.task.reserve.error.notFound',
  validation_failed: 'delivery_os.task.reserve.error.validationFailed',
  optimistic_lock_required: 'delivery_os.task.reserve.error.lockRequired',
}

const FIELD_ERROR_KEYS: Record<RevisionField, string> = {
  commitSha: 'delivery_os.task.reserve.error.commitSha',
  contentHash: 'delivery_os.task.reserve.error.contentHash',
  externalWorkspaceId: 'delivery_os.task.reserve.error.externalWorkspaceId',
}

export function ReserveAttemptAction({
  taskId,
  targetProfileId,
  targetProfileVersion,
  attemptNumber,
  activeAttemptNumber,
  taskUpdatedAt,
  onReserved,
}: ReserveAttemptActionProps) {
  const t = useT()
  const [draft, setDraft] = React.useState<RevisionDraft>(emptyRevisionDraft)
  const [problem, setProblem] = React.useState<string | null>(null)
  const [reserving, setReserving] = React.useState(false)
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({ contextId: CONTEXT_ID })

  const profile = getTargetProfile(targetProfileId, targetProfileVersion)

  const reserve = React.useCallback(async () => {
    setProblem(null)
    if (!profile) {
      setProblem(t('delivery_os.task.reserve.error.unknownTargetProfile'))
      return
    }
    const revision = parseRevisionDraft(profile.revisionKind, draft)
    if (!revision.ok) {
      setProblem(t(FIELD_ERROR_KEYS[revision.field]))
      return
    }
    setReserving(true)
    try {
      const call = await runMutation({
        operation: async () => {
          const response = await withScopedApiRequestHeaders(
            buildOptimisticLockHeader(taskUpdatedAt),
            () => apiCall<unknown>(`/api/delivery_os/tasks/${encodeURIComponent(taskId)}/attempts`, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'idempotency-key': buildAttemptIdempotencyKey({ taskId, baseRevision: revision.revision, attemptNumber }),
              },
              body: JSON.stringify({ mode: 'manual_handoff', baseRevision: revision.revision }),
            }),
          )
          if (!response.ok) {
            throw Object.assign(new Error('[internal] delivery_os.attempts.reserve failed'), {
              status: response.status,
              ...((response.result as Record<string, unknown> | null) ?? {}),
            })
          }
          return response
        },
        context: { formId: CONTEXT_ID, resourceKind: 'delivery_os.task', resourceId: taskId, retryLastMutation },
        mutationPayload: { taskId, attemptNumber },
      })
      const body = reserveAttemptResponseSchema.safeParse(call.result)
      if (!body.success) {
        setProblem(t('delivery_os.task.reserve.error.unreadableResponse'))
        return
      }
      // 200 is a SUCCESS: the same key found the same attempt, so nothing was
      // written and the operator already has what they asked for.
      const existing = call.status === 200
      flash(
        existing
          ? t('delivery_os.task.reserve.existing', { attemptId: body.data.attemptId })
          : t('delivery_os.task.reserve.created', { attemptId: body.data.attemptId }),
        existing ? 'info' : 'success',
      )
      onReserved(body.data)
    } catch (error) {
      if (surfaceRecordConflict(error, t, { title: t('delivery_os.task.reserve.error.conflictTitle') })) return
      const code = (error as { code?: unknown } | null)?.code
      if (code === 'attempt_active') {
        setProblem(t('delivery_os.task.reserve.error.attemptActive', { number: activeAttemptNumber ?? attemptNumber }))
        return
      }
      const key = typeof code === 'string' ? RESERVE_ERROR_KEYS[code] : undefined
      setProblem(key ? t(key) : t('delivery_os.task.reserve.error.unnamed'))
    } finally {
      setReserving(false)
    }
  }, [activeAttemptNumber, attemptNumber, draft, onReserved, profile, retryLastMutation, runMutation, t, taskId, taskUpdatedAt])

  return (
    <div className="space-y-3 rounded border border-border p-4" data-testid="delivery-reserve-attempt">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">{t('delivery_os.task.reserve.title')}</h3>
        <p className="text-xs text-muted-foreground">
          {t('delivery_os.task.reserve.description', { limit: MAX_EXECUTION_ATTEMPTS, used: attemptNumber })}
        </p>
      </div>
      {activeAttemptNumber !== null ? (
        <p className="text-xs text-status-warning-text" data-testid="reserve-attempt-active-note">
          {t('delivery_os.task.reserve.activeNote', { number: activeAttemptNumber })}
        </p>
      ) : null}
      {profile === undefined ? (
        <p className="text-sm text-status-error-text" data-testid="reserve-attempt-problem">
          {t('delivery_os.task.reserve.error.unknownTargetProfile')}
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {t(`delivery_os.task.reserve.revision.${profile.revisionKind}.help`)}
          </p>
          {profile.revisionKind === 'git' ? (
            <div className="space-y-1">
              <Label htmlFor="reserve-commit-sha">{t('delivery_os.task.reserve.revision.git.commitSha')}</Label>
              <Input
                id="reserve-commit-sha"
                data-testid="reserve-commit-sha"
                className="font-mono text-xs"
                value={draft.commitSha}
                onChange={(event) => { setDraft((current) => ({ ...current, commitSha: event.target.value })); setProblem(null) }}
              />
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="reserve-content-hash">{t('delivery_os.task.reserve.revision.snapshot.contentHash')}</Label>
                <Input
                  id="reserve-content-hash"
                  data-testid="reserve-content-hash"
                  className="font-mono text-xs"
                  value={draft.contentHash}
                  onChange={(event) => { setDraft((current) => ({ ...current, contentHash: event.target.value })); setProblem(null) }}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="reserve-workspace-id">{t('delivery_os.task.reserve.revision.snapshot.externalWorkspaceId')}</Label>
                <Input
                  id="reserve-workspace-id"
                  data-testid="reserve-workspace-id"
                  className="font-mono text-xs"
                  value={draft.externalWorkspaceId}
                  onChange={(event) => { setDraft((current) => ({ ...current, externalWorkspaceId: event.target.value })); setProblem(null) }}
                />
              </div>
            </div>
          )}
          <Button
            type="button"
            size="sm"
            disabled={reserving}
            data-testid="reserve-attempt-submit"
            onClick={() => void reserve()}
          >
            {t('delivery_os.task.reserve.action')}
          </Button>
          {problem ? (
            <p className="text-sm text-status-error-text" data-testid="reserve-attempt-problem">{problem}</p>
          ) : null}
        </>
      )}
    </div>
  )
}
