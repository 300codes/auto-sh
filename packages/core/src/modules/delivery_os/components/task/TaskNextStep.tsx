'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { NextStepCallout } from '@open-mercato/ui/backend/NextStepCallout'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import type { TaskNextStep as TaskNextStepDecision, TaskProgressStep } from './nextStep'

export type TaskNextStepProps = {
  step: TaskNextStepDecision
  progress: readonly TaskProgressStep[]
  busy?: boolean
  onAction?: () => void
}

const TONES: Record<TaskNextStepDecision['kind'], 'default' | 'info' | 'warning' | 'muted'> = {
  reconcile: 'warning',
  import: 'info',
  review: 'info',
  reserve: 'default',
  prepare: 'muted',
  settled: 'muted',
  unknown_history: 'warning',
}

/**
 * The one step the operator can take, named in the words of the domain. A step
 * they cannot take keeps its name and gains the reason in prose — a hidden
 * affordance reads as a finished task.
 */
export function TaskNextStep({ step, progress, busy = false, onAction }: TaskNextStepProps) {
  const t = useT()

  if (step.kind === 'settled') {
    return (
      <div
        className="rounded-lg border border-status-neutral-border bg-status-neutral-bg px-4 py-3"
        data-testid="task-next-step-settled"
      >
        <p className="text-sm font-medium text-status-neutral-text">{t('delivery_os.task.next.title.settled')}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t(step.blocker === 'archived' ? 'delivery_os.task.next.blocker.archived' : 'delivery_os.task.next.description.settled')}
        </p>
      </div>
    )
  }

  return (
    <div data-testid="task-next-step" data-next-step={step.kind}>
      <NextStepCallout
        title={t(`delivery_os.task.next.title.${step.kind}`)}
        description={t(`delivery_os.task.next.description.${step.kind}`)}
        steps={progress.map((entry) => ({
          id: entry.id,
          label: t(`delivery_os.task.next.step.${entry.id}`),
          state: entry.state,
        }))}
        actionLabel={t(`delivery_os.task.next.action.${step.kind}`)}
        onAction={onAction}
        busy={busy}
        disabled={step.blocker !== null || onAction === undefined}
        disabledMessage={step.blocker !== null ? t(`delivery_os.task.next.blocker.${step.blocker}`) : undefined}
        status={step.attemptNumber !== null ? {
          tone: TONES[step.kind],
          label: t('delivery_os.task.next.attempt', { number: step.attemptNumber }),
          badge: (
            <StatusBadge variant={step.kind === 'reconcile' ? 'warning' : 'info'} dot>
              {t(`delivery_os.task.next.badge.${step.kind}`)}
            </StatusBadge>
          ),
        } : null}
      />
    </div>
  )
}
