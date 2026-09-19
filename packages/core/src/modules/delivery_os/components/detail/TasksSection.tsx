'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { LoadingMessage, ErrorMessage, TabEmptyState } from '@open-mercato/ui/backend/detail'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { Button } from '@open-mercato/ui/primitives/button'
import type { ProjectDetail, TaskDto } from '@open-mercato/core/modules/delivery_os/api/schemas'
import { findActiveAttempt } from '@open-mercato/core/modules/delivery_os/components/task/attemptRegister'
import type { SectionSource } from './useProjectSections'

export type TasksSectionProps = {
  state: SectionSource<TaskDto[]>
  attention: ProjectDetail['attention']
  hasActiveBaseline: boolean | null
  selectedTaskId: string | null
  onSelectTask: (taskId: string | null) => void
  onRetry: () => void
  action?: React.ReactNode
}

/** Module-owned status map, as the design system requires for entity status. */
export const deliveryTaskStatusMap: StatusMap<TaskDto['status']> = {
  draft: 'neutral',
  ready: 'info',
  executing: 'warning',
  awaiting_review: 'warning',
  changes_requested: 'warning',
  verified: 'success',
  blocked: 'error',
  cancelled: 'error',
}

/**
 * The attempt register has three disjoint outcomes: no attempts, attempts
 * listed, register unreadable. `attemptRegisterReadable: false` arrives with an
 * empty array, so collapsing it into "no attempts" would report a clean record
 * for a task whose history could not be read at all.
 */
function AttemptRegister({ task }: { task: TaskDto }) {
  const t = useT()
  if (!task.attemptRegisterReadable) {
    return (
      <span data-testid={`attempt-register-unreadable-${task.id}`}>
        <StatusBadge variant="error">{t('delivery_os.project.sections.tasks.attempts.unreadable')}</StatusBadge>
      </span>
    )
  }
  if (task.executionAttempts.length === 0) {
    return (
      <span className="text-xs text-muted-foreground" data-testid={`attempt-register-empty-${task.id}`}>
        {t('delivery_os.project.sections.tasks.attempts.none')}
      </span>
    )
  }
  return (
    <span className="text-xs text-muted-foreground" data-testid={`attempt-register-count-${task.id}`}>
      {t('delivery_os.project.sections.tasks.attempts.count', { count: task.executionAttempts.length })}
    </span>
  )
}

export function TasksSection({
  state,
  attention,
  hasActiveBaseline,
  selectedTaskId,
  onSelectTask,
  onRetry,
  action,
}: TasksSectionProps) {
  const t = useT()
  const blocked = new Set(attention.blockedTaskIds)
  const reconciliation = new Set(attention.reconciliationRequiredTaskIds)

  return (
    <section data-testid="delivery-tasks-section" className="space-y-3">
      <SectionHeader
        title={t('delivery_os.project.sections.tasks.title')}
        count={state.status === 'ready' ? state.data.length : undefined}
        action={action}
      />
      {state.status === 'loading' ? <LoadingMessage label={t('delivery_os.project.sections.loading')} /> : null}
      {state.status === 'error' ? (
        <ErrorMessage
          label={t('delivery_os.project.sections.tasks.loadError')}
          action={<Button type="button" variant="outline" onClick={onRetry}>{t('delivery_os.project.retry')}</Button>}
        />
      ) : null}
      {state.status === 'ready' && state.data.length === 0 ? (
        <div data-testid="delivery-tasks-empty">
          {/*
            `hasActiveBaseline === null` means the baseline state is UNKNOWN —
            the baselines request has not resolved, or it failed. Folding it into
            the negative branch would state a cause ("no approved baseline") this
            section never observed. It stays silent about the cause instead; the
            sections that issued the failing request are the ones that report it.
          */}
          {hasActiveBaseline === null ? (
            <TabEmptyState
              title={t('delivery_os.project.sections.tasks.empty.noTasks')}
              description={t('delivery_os.project.sections.tasks.empty.baselineUnknown')}
            />
          ) : (
            <TabEmptyState
              title={t(
                hasActiveBaseline
                  ? 'delivery_os.project.sections.tasks.empty.baselineWithoutTasks'
                  : 'delivery_os.project.sections.tasks.empty.noBaseline',
              )}
              description={t(
                hasActiveBaseline
                  ? 'delivery_os.project.sections.tasks.empty.baselineWithoutTasksDescription'
                  : 'delivery_os.project.sections.tasks.empty.noBaselineDescription',
              )}
            />
          )}
        </div>
      ) : null}
      {state.status === 'ready' && state.data.length > 0 ? (
        <ul className="space-y-2">
          {state.data.map((task) => {
            const selected = task.id === selectedTaskId
            // Same function the task detail uses, so the list and the detail can
            // never disagree about which attempt is running.
            const activeAttempt = findActiveAttempt(task)
            return (
              <li key={task.id} className="space-y-1">
                <button
                  type="button"
                  aria-pressed={selected}
                  data-testid={`delivery-task-${task.id}`}
                  onClick={() => onSelectTask(selected ? null : task.id)}
                  className={`w-full rounded border p-3 text-left ${selected ? 'border-primary bg-accent' : 'border-border'}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{task.title}</span>
                    <StatusBadge variant={deliveryTaskStatusMap[task.status] ?? 'neutral'} dot>
                      {t(`delivery_os.project.sections.tasks.status.${task.status}`)}
                    </StatusBadge>
                    {blocked.has(task.id) ? (
                      <StatusBadge variant="error">{t('delivery_os.project.sections.tasks.attention.blocked')}</StatusBadge>
                    ) : null}
                    {reconciliation.has(task.id) ? (
                      <StatusBadge variant="warning">
                        {t('delivery_os.project.sections.tasks.attention.reconciliation')}
                      </StatusBadge>
                    ) : null}
                    {activeAttempt ? (
                      <span data-testid={`task-active-attempt-${task.id}`}>
                        <StatusBadge variant="info" dot>
                          {t('delivery_os.project.sections.tasks.attempts.active', {
                            state: t(`delivery_os.task.attempts.state.${activeAttempt.state}`),
                          })}
                        </StatusBadge>
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span className="font-mono">{task.acIds.join(', ') || '—'}</span>
                    <span>{t('delivery_os.project.sections.tasks.attemptNumber', { number: task.attemptNumber })}</span>
                    <AttemptRegister task={task} />
                  </div>
                </button>
                {/*
                  A sibling of the selection button, never a child: a link inside
                  a button is invalid markup and would break the existing
                  select/deselect contract this row already carries.
                */}
                <a
                  data-testid={`delivery-task-open-${task.id}`}
                  href={`/backend/delivery/projects/${encodeURIComponent(task.projectId)}/tasks/${encodeURIComponent(task.id)}`}
                  className="inline-block text-xs underline underline-offset-2"
                >
                  {t('delivery_os.project.sections.tasks.open')}
                </a>
              </li>
            )
          })}
        </ul>
      ) : null}
    </section>
  )
}
