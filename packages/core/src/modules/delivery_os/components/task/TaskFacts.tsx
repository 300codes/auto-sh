'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CollapsibleSection, SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import type { TaskDto } from '@open-mercato/core/modules/delivery_os/api/schemas'
import { PathList } from './PathList'
import { TechnicalFacts } from './TechnicalValue'

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  )
}

function IdList({ ids, emptyLabel, testId }: { ids: readonly string[]; emptyLabel: string; testId?: string }) {
  if (ids.length === 0) return <span className="text-xs text-muted-foreground">{emptyLabel}</span>
  return (
    <span className="flex flex-wrap gap-1" data-testid={testId}>
      {ids.map((id) => <StatusBadge key={id} variant="neutral">{id}</StatusBadge>)}
    </span>
  )
}

/**
 * The execution contract of a task as the operator has to read it before running
 * anything: which criteria it proves, which paths it may touch, what it waits
 * for. `allowedPaths` are shown, never edited — they come from the approved
 * baseline, not from an ad-hoc agreement. The pinned ids and the profile
 * version answer nothing an operator decides on, so they fold away.
 */
export function TaskFacts({ task }: { task: TaskDto }) {
  const t = useT()
  return (
    <section className="space-y-3" data-testid="delivery-task-contract">
      <SectionHeader title={t('delivery_os.task.contract.title')} />
      <p className="text-xs text-muted-foreground">{t('delivery_os.task.contract.description')}</p>
      <dl data-testid="delivery-task-facts" className="grid gap-4 sm:grid-cols-2">
        <Fact label={t('delivery_os.task.facts.acIds')}>
          <IdList ids={task.acIds} emptyLabel={t('delivery_os.task.facts.noAcIds')} testId="delivery-task-ac-ids" />
        </Fact>
        <Fact label={t('delivery_os.task.facts.dependsOn')}>
          <IdList ids={task.dependsOnTaskIds} emptyLabel={t('delivery_os.task.facts.noDependencies')} />
        </Fact>
        <Fact label={t('delivery_os.task.facts.attemptNumber')}>
          {t('delivery_os.project.sections.tasks.attemptNumber', { number: task.attemptNumber })}
        </Fact>
        <Fact label={t('delivery_os.task.facts.targetProfile')}>
          <span className="text-sm">{`${task.targetProfileId}@${task.targetProfileVersion}`}</span>
        </Fact>
        <div className="sm:col-span-2">
          <Fact label={t('delivery_os.task.facts.allowedPaths')}>
            <PathList
              paths={task.allowedPaths}
              testId="delivery-task-allowed-paths"
              emptyLabel={t('delivery_os.task.facts.noAllowedPaths')}
            />
          </Fact>
        </div>
        {task.description ? (
          <div className="sm:col-span-2">
            <Fact label={t('delivery_os.task.facts.description')}>
              <span className="whitespace-pre-wrap text-sm text-muted-foreground">{task.description}</span>
            </Fact>
          </div>
        ) : null}
      </dl>
      <CollapsibleSection title={t('delivery_os.task.contract.technicalTitle')} defaultCollapsed>
        <TechnicalFacts
          testId="delivery-task-technical"
          facts={[
            { label: t('delivery_os.task.facts.baseline'), value: task.baselineId },
            { label: t('delivery_os.task.facts.taskId'), value: task.id },
            ...(task.proposalTaskKey ? [{ label: t('delivery_os.task.facts.proposalKey'), value: task.proposalTaskKey }] : []),
          ]}
        />
      </CollapsibleSection>
    </section>
  )
}
