'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { CollapsibleSection, SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { FLOW_APPROVAL_STAGE_ORDER } from '../../lib/contracts'
import { BriefWizard } from '../intake/BriefWizard'
import { StageReview } from '../stages/StageReview'
import type { FlowController } from './FlowController'

type Props = {
  projectId: string
  actorUserId: string | null
  canManage: boolean
  canImport: boolean
  canApprove: boolean
  clientRequest: string | null
  controller: FlowController
}

const COLLAPSE_CLIENT_REQUEST_ABOVE = 280

/**
 * The process tab: what the client asked for, the structured discovery built from
 * it, and the stage currently under review. The next step itself lives in the
 * persistent header above the tabs, so nothing here competes with it.
 */
export function ProjectOverview({ projectId, actorUserId, canManage, canImport, canApprove, clientRequest, controller }: Props) {
  const t = useT()
  const { flow } = controller
  if (!flow && controller.loading) return <LoadingMessage label={t('delivery_os.flow.loading')} />
  if (!flow) {
    return <ErrorMessage
      label={t('delivery_os.flow.loadError')}
      action={<Button type="button" onClick={() => void controller.reload()}>{t('delivery_os.task.retry')}</Button>}
    />
  }

  const approvalStages = flow.stages.filter((stage) => FLOW_APPROVAL_STAGE_ORDER.some((id) => id === stage.stageId))
  const selected = approvalStages.find((stage) => stage.stageId === controller.selectedStageId)

  return (
    <section className="space-y-4" data-testid="delivery-project-overview">
      <CollapsibleSection
        title={t('delivery_os.project.clientRequest.title')}
        defaultCollapsed={(clientRequest?.length ?? 0) > COLLAPSE_CLIENT_REQUEST_ABOVE}
      >
        <p className="text-sm text-muted-foreground" data-testid="delivery-project-client-request">
          {clientRequest ? t('delivery_os.project.clientRequest.hint') : t('delivery_os.project.clientRequest.empty')}
        </p>
        {clientRequest ? <p className="mt-2 whitespace-pre-wrap text-sm">{clientRequest}</p> : null}
      </CollapsibleSection>
      <div className="space-y-2">
        <SectionHeader
          title={t('delivery_os.flow.stages.title')}
          action={
            <Button type="button" variant="outline" size="sm" onClick={controller.toggleIntake}>
              {t('delivery_os.flow.brief.title')}
            </Button>
          }
        />
        <nav className="flex flex-wrap gap-2" aria-label={t('delivery_os.flow.stages.title')}>
          {approvalStages.map((stage) => (
            <Button
              type="button"
              variant={stage.stageId === controller.selectedStageId ? 'secondary' : 'outline'}
              key={stage.stageId}
              onClick={() => controller.selectStage(stage.stageId)}
            >
              {t(`delivery_os.flow.stage.${stage.stageId}`)}
              <StatusBadge variant={stage.currency === 'approved' ? 'success' : stage.currency === 'rejected' ? 'error' : stage.currency === 'stale' ? 'warning' : 'neutral'}>
                {t(`delivery_os.flow.currency.${stage.currency ?? 'pending'}`)}
              </StatusBadge>
            </Button>
          ))}
        </nav>
      </div>
      {controller.showIntake || flow.nextAction.kind === 'complete_intake' ? (
        <BriefWizard
          projectId={projectId}
          projectUpdatedAt={flow.updatedAt}
          actorUserId={actorUserId}
          canManage={canManage}
          canImport={canImport}
          onChanged={() => void controller.changed()}
        />
      ) : null}
      {selected ? (
        <StageReview
          key={`${projectId}:${selected.stageId}`}
          projectId={projectId}
          stage={selected}
          updatedAt={flow.updatedAt}
          canManage={canManage}
          canApprove={canApprove}
          onChanged={controller.changed}
        />
      ) : null}
    </section>
  )
}
