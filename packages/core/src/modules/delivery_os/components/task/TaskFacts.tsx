'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { TaskDto } from '@open-mercato/core/modules/delivery_os/api/schemas'

const EMPTY_LIST = '—'

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}

/**
 * The execution contract of a task as the operator has to read it before running
 * anything: which criteria it proves, which paths it may touch, which profile
 * validates it and what it waits for. `allowedPaths` are shown, never edited —
 * they come from the approved baseline, not from an ad-hoc agreement.
 */
export function TaskFacts({ task }: { task: TaskDto }) {
  const t = useT()
  return (
    <dl data-testid="delivery-task-facts" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Fact label={t('delivery_os.task.facts.acIds')}>
        <span className="font-mono text-xs">{task.acIds.join(', ') || EMPTY_LIST}</span>
      </Fact>
      <Fact label={t('delivery_os.task.facts.allowedPaths')}>
        <span className="font-mono text-xs" data-testid="delivery-task-allowed-paths">
          {task.allowedPaths.join(', ') || EMPTY_LIST}
        </span>
      </Fact>
      <Fact label={t('delivery_os.task.facts.targetProfile')}>
        <span className="font-mono text-xs">{`${task.targetProfileId}@${task.targetProfileVersion}`}</span>
      </Fact>
      <Fact label={t('delivery_os.task.facts.attemptNumber')}>
        {t('delivery_os.project.sections.tasks.attemptNumber', { number: task.attemptNumber })}
      </Fact>
      <Fact label={t('delivery_os.task.facts.dependsOn')}>
        <span className="font-mono text-xs">{task.dependsOnTaskIds.join(', ') || EMPTY_LIST}</span>
      </Fact>
      <Fact label={t('delivery_os.task.facts.baseline')}>
        <span className="font-mono text-xs">{task.baselineId}</span>
      </Fact>
      {task.description ? (
        <div className="sm:col-span-2 lg:col-span-3">
          <Fact label={t('delivery_os.task.facts.description')}>
            <span className="whitespace-pre-wrap text-sm text-muted-foreground">{task.description}</span>
          </Fact>
        </div>
      ) : null}
    </dl>
  )
}
