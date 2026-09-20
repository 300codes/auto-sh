'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { LoadingMessage, ErrorMessage, TabEmptyState } from '@open-mercato/ui/backend/detail'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { Button } from '@open-mercato/ui/primitives/button'
import type { TaskDto } from '@open-mercato/core/modules/delivery_os/api/schemas'
import type { ReserveAttemptResponse, ResultManifestV1 } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { AttemptRegisterTable } from './AttemptRegisterTable'
import { CancelAttemptAction } from './CancelAttemptAction'
import { ReconcileAttemptDialog } from './ReconcileAttemptDialog'
import { ReserveAttemptAction } from './ReserveAttemptAction'
import { ResultImportDialog } from './ResultImportDialog'
import { useAcceptedResult } from './useAcceptedResult'
import { ResultSummary } from './ResultSummary'
import { TaskNextStep } from './TaskNextStep'
import { TaskReviewAction } from './TaskReviewAction'
import { TaskPackagePanel } from './TaskPackagePanel'
import { readTaskNextStep, readTaskProgress, type TaskNextStepInput } from './nextStep'
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
 * Everything the operator can do to a task, ordered as they read it: the one
 * step that is available, then what came back from the last run, then the
 * controls that prepare or close a run, then the history. The order on screen no
 * longer mirrors the domain's dependency graph — the callout carries that — so
 * the answer to "what now" is never below the fold.
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
  const [reviewOpen, setReviewOpen] = React.useState(false)
  const [reserveFocusToken, setReserveFocusToken] = React.useState(0)
  const [reconcileAttemptId, setReconcileAttemptId] = React.useState<string | null>(null)
  const activeEntry = register.kind === 'entries' ? register.activeEntry : null
  const acceptedEntry = register.kind === 'entries' ? [...register.entries].reverse().find((entry) => entry.attempt.resultEvidenceId) : null
  const accepted = useAcceptedResult(task.projectId, task.id, acceptedEntry?.attempt.attemptId ?? null, acceptedEntry?.attempt.resultEvidenceId ?? null, taskVersion)

  const onReserved = React.useCallback((reservation: ReserveAttemptResponse) => {
    setReservedAttemptId(reservation.attemptId)
    onMutated(reservation.taskUpdatedAt)
  }, [onMutated])

  const onImported = React.useCallback((result: { manifest: ResultManifestV1; taskUpdatedAt: string }) => {
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

  const nextStepInput = React.useMemo<TaskNextStepInput>(() => ({
    status: task.status,
    statusReason: task.statusReason,
    archivedAt: task.archivedAt,
    attemptNumber: task.attemptNumber,
    register,
    hasAcceptedResult: accepted.state.status === 'ready',
    canManageAttempts,
    canImportResults,
    canReconcile,
  }), [accepted.state.status, canImportResults, canManageAttempts, canReconcile, register, task])
  const nextStep = React.useMemo(() => readTaskNextStep(nextStepInput), [nextStepInput])
  const progress = React.useMemo(() => readTaskProgress(nextStepInput, nextStep), [nextStep, nextStepInput])

  const runNextStep = React.useCallback(() => {
    if (nextStep.kind === 'reconcile') {
      setReconcileAttemptId(nextStep.attemptId ?? activeEntry?.attempt.attemptId ?? null)
      return
    }
    if (nextStep.kind === 'import') { setResultOpen(true); return }
    if (nextStep.kind === 'review') { setReviewOpen(true); return }
    if (nextStep.kind === 'reserve') setReserveFocusToken((current) => current + 1)
  }, [activeEntry, nextStep])

  const canRunNextStep = nextStep.blocker === null
    && (nextStep.kind !== 'reconcile' || (nextStep.attemptId ?? activeEntry?.attempt.attemptId) !== null)

  return (
    <div className="space-y-6">
      <TaskNextStep
        step={nextStep}
        progress={progress}
        busy={accepted.state.status === 'loading' && task.status === 'awaiting_review'}
        onAction={canRunNextStep ? runNextStep : undefined}
      />

      <section className="space-y-3" data-testid="delivery-accepted-result">
        <SectionHeader
          title={t('delivery_os.task.result.read.title')}
          action={canImportResults && task.status === 'awaiting_review' && accepted.state.status === 'ready' ? (
            <TaskReviewAction
              result={accepted.state.result}
              taskUpdatedAt={taskVersion}
              onMutated={onMutated}
              open={reviewOpen}
              onOpenChange={setReviewOpen}
            />
          ) : null}
        />
        {accepted.state.status === 'loading' ? <LoadingMessage label={t('delivery_os.task.result.read.loading')} /> : null}
        {(register.kind === 'unreadable' || accepted.state.status === 'error') ? (
          <ErrorMessage
            label={t('delivery_os.task.result.read.error')}
            action={(
              <Button
                type="button"
                variant="outline"
                onClick={() => { if (register.kind === 'unreadable') onMutated(task.updatedAt); else void accepted.reload() }}
              >
                {t('delivery_os.task.retry')}
              </Button>
            )}
          />
        ) : null}
        {register.kind !== 'unreadable' && accepted.state.status === 'empty' ? (
          <TabEmptyState
            title={t('delivery_os.task.result.read.empty')}
            description={t('delivery_os.task.result.read.emptyDescription')}
          />
        ) : null}
        {accepted.state.status === 'ready' ? <ResultSummary result={accepted.state.result} /> : null}
      </section>

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

      {canManageAttempts ? (
        <section className="space-y-3">
          <SectionHeader title={t('delivery_os.task.run.title')} />
          <p className="text-xs text-muted-foreground">{t('delivery_os.task.run.description')}</p>
          <div className="grid gap-4 lg:grid-cols-2">
            <ReserveAttemptAction
              taskId={task.id}
              targetProfileId={task.targetProfileId}
              targetProfileVersion={task.targetProfileVersion}
              attemptNumber={task.attemptNumber}
              activeAttemptNumber={activeEntry?.number ?? null}
              taskUpdatedAt={taskVersion}
              onReserved={onReserved}
              focusToken={reserveFocusToken}
            />
            <TaskPackagePanel taskId={task.id} attemptId={attemptId} />
          </div>
          {activeEntry ? (
            <CancelAttemptAction
              taskId={task.id}
              attemptId={activeEntry.attempt.attemptId}
              attemptNumber={activeEntry.number}
              taskUpdatedAt={taskVersion}
              onRequested={onMutated}
            />
          ) : null}
        </section>
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
