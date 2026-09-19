'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { LoadingMessage, ErrorMessage, TabEmptyState } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import type { SectionSource } from './useProjectSections'
import { resolveActiveBaseline, shortHash, type ActiveBaseline } from './baselineContent'
import type { BaselineDto } from '@open-mercato/core/modules/delivery_os/api/schemas'

export type BaselineSectionFrameProps = {
  testId: string
  titleKey: string
  countOf?: (active: Extract<ActiveBaseline, { kind: 'ready' }>) => number
  state: SectionSource<BaselineDto[]>
  onRetry: () => void
  children: (active: Extract<ActiveBaseline, { kind: 'ready' }>) => React.ReactNode
}

/**
 * Shared chrome for the two baseline-backed sections. It keeps the four
 * outcomes disjoint — still loading, request failed, no approved baseline yet,
 * baseline content unreadable — so none of them can collapse into "empty".
 */
export function BaselineSectionFrame({ testId, titleKey, countOf, state, onRetry, children }: BaselineSectionFrameProps) {
  const t = useT()
  const active = state.status === 'ready' ? resolveActiveBaseline(state.data) : null

  const subtitle = active?.kind === 'ready' || active?.kind === 'unreadable'
    ? t('delivery_os.project.sections.baselineVersion', {
        version: active.baseline.version,
        hash: shortHash(active.baseline.contentHash),
      })
    : null

  return (
    <section data-testid={testId} className="space-y-3">
      <SectionHeader title={t(titleKey)} count={active?.kind === 'ready' ? countOf?.(active) : undefined} />
      {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
      {state.status === 'loading' ? <LoadingMessage label={t('delivery_os.project.sections.loading')} /> : null}
      {state.status === 'error' ? (
        <ErrorMessage
          label={t('delivery_os.project.sections.baselines.loadError')}
          action={<Button type="button" variant="outline" onClick={onRetry}>{t('delivery_os.project.retry')}</Button>}
        />
      ) : null}
      {active?.kind === 'none' ? (
        <div data-testid={`${testId}-empty`}>
          <TabEmptyState
            title={t('delivery_os.project.sections.baselines.none.title')}
            description={t('delivery_os.project.sections.baselines.none.description')}
          />
        </div>
      ) : null}
      {active?.kind === 'unreadable' ? (
        <ErrorMessage
          label={t('delivery_os.project.sections.baselines.unreadableTitle')}
          description={t('delivery_os.project.sections.baselines.unreadableDescription')}
          action={<Button type="button" variant="outline" onClick={onRetry}>{t('delivery_os.project.retry')}</Button>}
        />
      ) : null}
      {active?.kind === 'ready' ? children(active) : null}
    </section>
  )
}
