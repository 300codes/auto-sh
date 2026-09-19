'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { LoadingMessage, ErrorMessage, TabEmptyState } from '@open-mercato/ui/backend/detail'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import type { ProjectDetail, TaskDto } from '@open-mercato/core/modules/delivery_os/api/schemas'
import type { SectionSource } from './useProjectSections'

export type TasksSectionProps = {
  state: SectionSource<TaskDto[]>
  attention: ProjectDetail['attention']
  hasActiveBaseline: boolean | null
  selectedTaskId: string | null
  onSelectTask: (taskId: string | null) => void
  onRetry: () => void
}

const VERIFIED_STATUSES = new Set(['verified'])
const BLOCKING_STATUSES = new Set(['blocked', 'cancelled'])

function statusVariant(status: string): 'success' | 'error' | 'warning' | 'neutral' {
  if (VERIFIED_STATUSES.has(status)) return 'success'
  if (BLOCKING_STATUSES.has(status)) return 'error'
  if (status === 'executing' || status === 'awaiting_review' || status === 'changes_requested') return 'warning'
  return 'neutral'
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
      <Badge variant="error" size="sm" data-testid={`attempt-register-unreadable-${task.id}`}>
        {t('delivery_os.project.sections.tasks.attempts.unreadable')}
      </Badge>
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
}: TasksSectionProps) {
  const t = useT()
  const blocked = new Set(attention.blockedTaskIds)
  const reconciliation = new Set(attention.reconciliationRequiredTaskIds)

  return (
    <section data-testid="delivery-tasks-section" className="space-y-3">
      <SectionHeader
        title={t('delivery_os.project.sections.tasks.title')}
        count={state.status === 'ready' ? state.data.length : undefined}
      />
      {state.status === 'loading' ? <LoadingMessage label={t('delivery_os.project.sections.loading')} /> : null}
      {state.status === 'error' ? (
        <ErrorMessage
          label={t('delivery_os.project.sections.tasks.loadError')}
          action={<Button type="button" variant="outline" onClick={onRetry}>{t('delivery_os.project.retry')}</Button>}
        />
      ) : null}
      {state.status === 'ready' && state.data.length === 0 ? (
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
      ) : null}
      {state.status === 'ready' && state.data.length > 0 ? (
        <ul className="space-y-2">
          {state.data.map((task) => {
            const selected = task.id === selectedTaskId
            return (
              <li key={task.id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  data-testid={`delivery-task-${task.id}`}
                  onClick={() => onSelectTask(selected ? null : task.id)}
                  className={`w-full rounded border p-3 text-left ${selected ? 'border-primary bg-accent' : 'border-border'}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{task.title}</span>
                    <Badge variant={statusVariant(task.status)} size="sm">
                      {t(`delivery_os.project.sections.tasks.status.${task.status}`)}
                    </Badge>
                    {blocked.has(task.id) ? (
                      <Badge variant="error" size="sm">{t('delivery_os.project.sections.tasks.attention.blocked')}</Badge>
                    ) : null}
                    {reconciliation.has(task.id) ? (
                      <Badge variant="warning" size="sm">
                        {t('delivery_os.project.sections.tasks.attention.reconciliation')}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span className="font-mono">{task.acIds.join(', ') || '—'}</span>
                    <span>{t('delivery_os.project.sections.tasks.attemptNumber', { number: task.attemptNumber })}</span>
                    <AttemptRegister task={task} />
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </section>
  )
}
