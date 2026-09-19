'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import type { TaskDto } from '@open-mercato/core/modules/delivery_os/api/schemas'
import type { ReserveAttemptResponse, ResultManifestV1 } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { AttemptRegisterTable } from './AttemptRegisterTable'
import { CancelAttemptAction } from './CancelAttemptAction'
import { ReconcileAttemptDialog } from './ReconcileAttemptDialog'
import { ReserveAttemptAction } from './ReserveAttemptAction'
import { ResultImportDialog } from './ResultImportDialog'
import { ResultSummary } from './ResultSummary'
import { TaskPackagePanel } from './TaskPackagePanel'
import type { AttemptRegisterEntry, AttemptRegisterState } from './attemptRegister'

export type TaskExecutionPanelProps = {
  task: TaskDto
  register: AttemptRegisterState
  taskVersion: string | null
  canManageAttempts: boolean
  canReconcile: boolean
  canImportResults: boolean
  onMutated: (taskUpdatedAt: string) => void
}

/** An attempt is reconcilable while it is still open or already flagged as unresolved. */
function isReconcilable(entry: AttemptRegisterEntry): boolean {
  return entry.active || entry.reconciliationRequired
}

/**
 * Everything the operator can do to a task in one place, so the detail host
 * stays a composer. The order on screen is the order the domain forces:
 * reservation first, because both the package and the result need an
 * `attemptId` that only a reservation can produce.
 */
export function TaskExecutionPanel({
  task,
  register,
  taskVersion,
  canManageAttempts,
  canReconcile,
  canImportResults,
  onMutated,
}: TaskExecutionPanelProps) {
  const t = useT()
  const [reservedAttemptId, setReservedAttemptId] = React.useState<string | null>(null)
  const [resultOpen, setResultOpen] = React.useState(false)
  const [reconcileAttemptId, setReconcileAttemptId] = React.useState<string | null>(null)
  const [accepted, setAccepted] = React.useState<ResultManifestV1 | null>(null)
  const activeEntry = register.kind === 'entries' ? register.activeEntry : null

  const onReserved = React.useCallback((reservation: ReserveAttemptResponse) => {
    setReservedAttemptId(reservation.attemptId)
    onMutated(reservation.taskUpdatedAt)
  }, [onMutated])

  const onImported = React.useCallback((result: { manifest: ResultManifestV1; taskUpdatedAt: string }) => {
    setAccepted(result.manifest)
    onMutated(result.taskUpdatedAt)
  }, [onMutated])

  // The register is the authority once it has refetched; the id the reservation
  // just returned only covers the window before that response lands.
  const attemptId = activeEntry?.attempt.attemptId ?? reservedAttemptId

  const actionsFor = React.useCallback((entry: AttemptRegisterEntry) => {
    if (!canReconcile || !isReconcilable(entry)) return null
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid={`reconcile-open-${entry.attempt.attemptId}`}
        onClick={() => setReconcileAttemptId(entry.attempt.attemptId)}
      >
        {t('delivery_os.task.reconcile.action')}
      </Button>
    )
  }, [canReconcile, t])

  return (
    <div className="space-y-6">
      {canManageAttempts ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <ReserveAttemptAction
            taskId={task.id}
            targetProfileId={task.targetProfileId}
            targetProfileVersion={task.targetProfileVersion}
            attemptNumber={task.attemptNumber}
            activeAttemptNumber={activeEntry?.number ?? null}
            taskUpdatedAt={taskVersion}
            onReserved={onReserved}
          />
          <TaskPackagePanel taskId={task.id} attemptId={attemptId} />
        </div>
      ) : null}

      {canImportResults ? (
        <div className="space-y-3 rounded border border-border p-4" data-testid="delivery-result-import">
          <div className="space-y-1">
            <h3 className="text-sm font-medium">{t('delivery_os.task.result.sectionTitle')}</h3>
            <p className="text-xs text-muted-foreground">{t('delivery_os.task.result.sectionDescription')}</p>
          </div>
          {attemptId === null ? (
            <p className="text-sm text-muted-foreground" data-testid="result-import-no-attempt">
              {t('delivery_os.task.result.error.noAttempt')}
            </p>
          ) : (
            <Button type="button" size="sm" data-testid="result-import-open" onClick={() => setResultOpen(true)}>
              {t('delivery_os.task.result.action')}
            </Button>
          )}
          {accepted ? <ResultSummary manifest={accepted} source="manual" accepted /> : null}
          <ResultImportDialog
            open={resultOpen}
            onOpenChange={setResultOpen}
            taskId={task.id}
            attemptId={attemptId}
            taskUpdatedAt={taskVersion}
            onImported={onImported}
          />
        </div>
      ) : null}

      {canManageAttempts && activeEntry ? (
        <CancelAttemptAction
          taskId={task.id}
          attemptId={activeEntry.attempt.attemptId}
          attemptNumber={activeEntry.number}
          taskUpdatedAt={taskVersion}
          onRequested={onMutated}
        />
      ) : null}

      <AttemptRegisterTable register={register} actionsFor={actionsFor} />

      {reconcileAttemptId !== null ? (
        <ReconcileAttemptDialog
          open
          onOpenChange={(next) => { if (!next) setReconcileAttemptId(null) }}
          taskId={task.id}
          attemptId={reconcileAttemptId}
          taskUpdatedAt={taskVersion}
          onReconciled={onMutated}
        />
      ) : null}
    </div>
  )
}
