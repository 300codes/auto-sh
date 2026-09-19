'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
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
    <>
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
      {draft.ok && draft.draft.screens.length > 0 ? <section className="space-y-3 rounded border border-border p-4" data-testid="delivery-draft-design">
        <h2 className="text-lg font-semibold">{t('delivery_os.designImport.draftTitle')}</h2>
        {draft.draft.screens.map((screen) => <div key={screen.attachmentId} className="space-y-2">
          <p className="font-medium">{screen.name} · {screen.viewport.width}×{screen.viewport.height} · {screen.figmaVersion ?? '—'}</p>
          <ScreenPreview attachmentId={screen.attachmentId} name={screen.name} />
          {canManage ? <ScreenComments projectId={projectId} projectUpdatedAt={projectVersion} draft={draft.draft} screenAttachmentId={screen.attachmentId} onSaved={onMutated} /> : <ul>{draft.draft.comments.filter((comment) => comment.screenAttachmentId === screen.attachmentId).map((comment) => <li key={comment.id}>{comment.body}</li>)}</ul>}
        </div>)}
      </section> : null}
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
    </>
  )
}
