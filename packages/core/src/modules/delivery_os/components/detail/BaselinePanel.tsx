'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { CollapsibleSection } from '@open-mercato/ui/backend/SectionHeader'
import type { BaselineDto } from '@open-mercato/core/modules/delivery_os/api/schemas'
import { BaselineVersionBar } from './BaselineVersionBar'
import { DecisionActions } from './DecisionActions'
import { DesignSection, ScreenPreview } from './DesignSection'
import { FreezeBaselineAction } from './FreezeBaselineAction'
import { RequirementsSection } from './RequirementsSection'
import { ScreenComments } from './ScreenComments'
import { readDraftSpec } from './draftSpec'
import type { SectionSource } from './useProjectSections'

export type BaselinePanelProps = {
  projectId: string
  baselines: SectionSource<BaselineDto[]>
  selectedBaselineId: string | null
  onSelectBaseline: (baselineId: string | null) => void
  onRetryBaselines: () => void
  projectVersion: string | null
  draftSpec: unknown
  canImport: boolean
  canManage: boolean
  canApprove: boolean
  onImportRequirements: () => void
  onAddScreen: () => void
  onMutated: (projectUpdatedAt: string) => void
}

/**
 * The frozen side of a project: which version is on screen, what it requires,
 * what it looks like, and the two decisions plus the freeze that move it
 * forward. Kept out of the detail host so that host stays a composer.
 */
export function BaselinePanel({
  projectId,
  baselines,
  selectedBaselineId,
  onSelectBaseline,
  onRetryBaselines,
  projectVersion,
  draftSpec,
  canImport,
  canManage,
  canApprove,
  onImportRequirements,
  onAddScreen,
  onMutated,
}: BaselinePanelProps) {
  const t = useT()
  // The draft is the editable surface behind the frozen baselines; the section
  // renders the baseline, the comment thread edits the draft the next freeze
  // will carry forward.
  const draft = React.useMemo(() => readDraftSpec(draftSpec), [draftSpec])

  return (
    <div className="space-y-6">
      <BaselineVersionBar
        baselines={baselines.status === 'ready' ? baselines.data : []}
        selectedId={selectedBaselineId}
        onSelect={onSelectBaseline}
      />
      <RequirementsSection
        state={baselines}
        selectedBaselineId={selectedBaselineId}
        onRetry={onRetryBaselines}
        action={canImport ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="delivery-import-requirements"
            onClick={onImportRequirements}
          >
            {t('delivery_os.project.import.requirements.action')}
          </Button>
        ) : null}
        decisionFor={canApprove ? (baseline) => (
          <DecisionActions
            kind="requirements"
            baseline={baseline}
            projectUpdatedAt={projectVersion}
            onDecided={onMutated}
          />
        ) : undefined}
      />
      {draft.ok && draft.draft.screens.length > 0 ? (
        <section className="space-y-3 rounded-lg border border-border p-4" data-testid="delivery-draft-design">
          <CollapsibleSection
            title={t('delivery_os.designImport.draftTitle')}
            count={draft.draft.screens.length}
          >
            <p className="text-xs text-muted-foreground">{t('delivery_os.designImport.draftDescription')}</p>
            <ul className="mt-3 space-y-4">
              {draft.draft.screens.map((screen) => (
                <li key={screen.attachmentId} className="space-y-2 rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{screen.name}</span>
                    <Badge variant="muted" size="sm">{`${screen.viewport.width}×${screen.viewport.height}`}</Badge>
                    {screen.figmaVersion ? (
                      <Badge variant="muted" size="sm">
                        {t('delivery_os.project.sections.design.figmaVersion', { version: screen.figmaVersion })}
                      </Badge>
                    ) : null}
                  </div>
                  <ScreenPreview attachmentId={screen.attachmentId} name={screen.name} />
                  {canManage ? (
                    <ScreenComments
                      projectId={projectId}
                      projectUpdatedAt={projectVersion}
                      draft={draft.draft}
                      screenAttachmentId={screen.attachmentId}
                      onSaved={onMutated}
                    />
                  ) : (
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {draft.draft.comments
                        .filter((comment) => comment.screenAttachmentId === screen.attachmentId)
                        .map((comment) => <li key={comment.id}>{comment.body}</li>)}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </CollapsibleSection>
        </section>
      ) : null}
      <DesignSection
        state={baselines}
        selectedBaselineId={selectedBaselineId}
        onRetry={onRetryBaselines}
        action={canManage ? (
          <span className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="delivery-add-screen"
              onClick={onAddScreen}
            >
              {t('delivery_os.project.screens.action')}
            </Button>
            <FreezeBaselineAction
              projectId={projectId}
              projectUpdatedAt={projectVersion}
              onFrozen={onMutated}
            />
          </span>
        ) : null}
        decisionFor={canApprove ? (baseline) => (
          <DecisionActions
            kind="design"
            baseline={baseline}
            projectUpdatedAt={projectVersion}
            onDecided={onMutated}
          />
        ) : undefined}
      />
    </div>
  )
}
