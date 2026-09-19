'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Badge } from '@open-mercato/ui/primitives/badge'
import type { BaselineDecision } from './decisions'
import { DecisionHistory } from './decisions'
import { BaselineSectionFrame } from './BaselineSectionFrame'
import type { SectionSource } from './useProjectSections'
import type { BaselineDto } from '@open-mercato/core/modules/delivery_os/api/schemas'

export type RequirementsSectionProps = {
  state: SectionSource<BaselineDto[]>
  selectedBaselineId?: string | null
  onRetry: () => void
  /** Decision controls for the version on screen — rendered next to the content they judge. */
  decisionFor?: (baseline: BaselineDto) => React.ReactNode
  action?: React.ReactNode
}

export function RequirementsSection({ state, selectedBaselineId = null, onRetry, action, decisionFor }: RequirementsSectionProps) {
  const t = useT()
  return (
    <BaselineSectionFrame
      testId="delivery-requirements-section"
      titleKey="delivery_os.project.sections.requirements.title"
      countOf={(active) => active.content.requirements.length}
      state={state}
      selectedBaselineId={selectedBaselineId}
      onRetry={onRetry}
      action={action}
    >
      {(active) => {
        const criteriaByRequirement = new Map<string, typeof active.content.acceptanceCriteria>()
        active.content.acceptanceCriteria.forEach((criterion) => {
          const bucket = criteriaByRequirement.get(criterion.requirementId) ?? []
          bucket.push(criterion)
          criteriaByRequirement.set(criterion.requirementId, bucket)
        })
        const decisions = active.baseline.decisions.filter((decision) => decision.kind === 'requirements') as BaselineDecision[]
        return (
          <div className="space-y-4">
            {active.content.requirements.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('delivery_os.project.sections.requirements.noRequirements')}
              </p>
            ) : null}
            <ul className="space-y-3">
              {active.content.requirements.map((requirement) => (
                <li key={requirement.id} className="rounded border border-border p-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono">{requirement.id}</Badge>
                    <span className="text-sm font-medium">{requirement.title}</span>
                  </div>
                  {requirement.description ? (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{requirement.description}</p>
                  ) : null}
                  <ul className="mt-2 space-y-1">
                    {(criteriaByRequirement.get(requirement.id) ?? []).map((criterion) => (
                      <li key={criterion.id} className="flex gap-2 text-sm">
                        <span className="font-mono text-xs text-muted-foreground">{criterion.id}</span>
                        <span>{criterion.description}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
            {decisionFor ? decisionFor(active.baseline) : null}
            <DecisionHistory decisions={decisions} emptyKey="delivery_os.project.sections.decisions.none" />
          </div>
        )
      }}
    </BaselineSectionFrame>
  )
}
