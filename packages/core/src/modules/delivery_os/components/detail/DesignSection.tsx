'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { BaselineSectionFrame } from './BaselineSectionFrame'
import { shortHash } from './baselineContent'
import { DecisionHistory, type BaselineDecision } from './decisions'
import type { SectionSource } from './useProjectSections'
import type { BaselineDto } from '@open-mercato/core/modules/delivery_os/api/schemas'

export type DesignSectionProps = {
  state: SectionSource<BaselineDto[]>
  onRetry: () => void
}

/**
 * Metadata only — screen previews resolved from `attachmentId` belong to UI-03
 * together with the rest of the Figma work.
 */
export function DesignSection({ state, onRetry }: DesignSectionProps) {
  const t = useT()
  return (
    <BaselineSectionFrame
      testId="delivery-design-section"
      titleKey="delivery_os.project.sections.design.title"
      countOf={(active) => active.content.screens.length}
      state={state}
      onRetry={onRetry}
    >
      {(active) => {
        const tokens = Object.entries(active.content.tokens)
        const decisions = active.baseline.decisions.filter((decision) => decision.kind === 'design') as BaselineDecision[]
        return (
          <div className="space-y-4">
            {active.content.screens.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('delivery_os.project.sections.design.noScreens')}</p>
            ) : (
              <ul className="space-y-2">
                {active.content.screens.map((screen) => (
                  <li key={screen.attachmentId} className="rounded border border-border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{screen.name}</span>
                      {screen.figmaVersion ? (
                        <Badge variant="muted" size="sm">
                          {t('delivery_os.project.sections.design.figmaVersion', { version: screen.figmaVersion })}
                        </Badge>
                      ) : null}
                    </div>
                    <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
                      <div>
                        <dt className="font-medium">{t('delivery_os.project.sections.design.nodeId')}</dt>
                        <dd className="font-mono">{screen.nodeId ?? '—'}</dd>
                      </div>
                      <div>
                        <dt className="font-medium">{t('delivery_os.project.sections.design.viewport')}</dt>
                        <dd>{`${screen.viewport.width}×${screen.viewport.height}`}</dd>
                      </div>
                      <div>
                        <dt className="font-medium">{t('delivery_os.project.sections.design.sha256')}</dt>
                        <dd className="font-mono">{shortHash(screen.sha256)}</dd>
                      </div>
                      <div>
                        <dt className="font-medium">{t('delivery_os.project.sections.design.capturedAt')}</dt>
                        <dd>{new Date(screen.capturedAt).toLocaleString()}</dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ul>
            )}
            <div>
              <p className="text-xs font-medium">{t('delivery_os.project.sections.design.tokens')}</p>
              {tokens.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('delivery_os.project.sections.design.noTokens')}</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {tokens.map(([name, value]) => (
                    <li key={name} className="flex gap-2 text-xs">
                      <span className="font-mono text-muted-foreground">{name}</span>
                      <span className="font-mono">{typeof value === 'string' ? value : JSON.stringify(value)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <DecisionHistory decisions={decisions} emptyKey="delivery_os.project.sections.decisions.none" />
          </div>
        )
      }}
    </BaselineSectionFrame>
  )
}
