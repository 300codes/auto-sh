'use client'

import * as React from 'react'
import { AlertTriangle, ArrowRight, Route } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { NextStepCallout } from '@open-mercato/ui/backend/NextStepCallout'
import { ActionsDropdown, type ActionMenuEntry } from '@open-mercato/ui/backend/forms'
import type { FlowController } from './FlowController'
import { WorkflowStudioLink } from './WorkflowStudioLink'

export type FlowNextStepProps = { projectId: string; canManageFlow: boolean; controller: FlowController }

/**
 * The one affordance that answers "what do I do now". Everything the flow can
 * also do — pinning a template, materializing a baseline, opening the workflow
 * definition — is deliberately demoted below it so the operator never has to
 * choose between three equally loud buttons.
 */
export function FlowNextStep({ projectId, canManageFlow, controller }: FlowNextStepProps) {
  const t = useT()
  const { flow } = controller
  if (!flow && controller.loading) return <LoadingMessage label={t('delivery_os.flow.loading')} />
  if (!flow) {
    return <ErrorMessage
      label={t('delivery_os.flow.loadError')}
      action={<Button type="button" onClick={() => void controller.reload()}>{t('delivery_os.task.retry')}</Button>}
    />
  }

  const kind = flow.nextAction.kind
  const actionLabel = t(`delivery_os.flow.nextAction.${kind}`)
  const stageLabel = flow.nextAction.stageId ? t(`delivery_os.flow.stage.${flow.nextAction.stageId}`) : null
  const secondaryActions: ActionMenuEntry[] = []
  if (canManageFlow && !flow.template && kind !== 'pin_template') {
    secondaryActions.push({ id: 'pin-template', label: t('delivery_os.flow.nextAction.pin_template'), disabled: controller.pinning, onSelect: controller.pinTemplate })
  }
  if (canManageFlow && flow.stages.length > 0) {
    secondaryActions.push({ id: 'materialize-baseline', label: t('delivery_os.flow.materialize'), disabled: controller.pinning, onSelect: controller.materializeBaseline })
  }

  return (
    <section className="space-y-3" data-testid="delivery-flow-next-step">
      <NextStepCallout
        icon={<Route className="size-6" />}
        title={t('delivery_os.flow.nextStep.heading', { action: actionLabel })}
        description={
          <>
            <span>{t(`delivery_os.flow.nextStep.description.${kind}`)}</span>
            {stageLabel ? <span className="mt-1 block">{t('delivery_os.flow.nextStep.stage', { stage: stageLabel })}</span> : null}
          </>
        }
        steps={controller.steps.map((step) => ({ id: step.id, label: t(step.labelKey), state: step.state }))}
        actionLabel={actionLabel}
        actionIcon={<ArrowRight className="size-4" />}
        onAction={controller.runNextAction}
        busy={controller.pinning}
        disabled={!controller.availability.available}
        disabledMessage={controller.availability.available ? null : t(`delivery_os.flow.nextStep.disabled.${controller.availability.reasonKey}`)}
        status={{
          tone: 'info',
          label: flow.currentStageId ? t(`delivery_os.flow.stage.${flow.currentStageId}`) : t('delivery_os.flow.noStage'),
          badge: <StatusBadge variant={flow.pendingApprovals.length > 0 ? 'info' : 'neutral'}>{t('delivery_os.flow.pending', { count: flow.pendingApprovals.length })}</StatusBadge>,
        }}
      />
      {controller.pinError ? <ErrorMessage label={t('delivery_os.flow.saveError')} /> : null}
      {flow.blockers.length > 0 ? (
        <div
          className="rounded-lg border border-status-warning-border bg-status-warning-bg px-4 py-3 text-status-warning-text"
          data-testid="delivery-flow-blockers"
        >
          <p className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="size-4 shrink-0" />
            {t('delivery_os.flow.blockers.title')}
          </p>
          <ul className="mt-2 space-y-1">
            {flow.blockers.map((blocker, index) => (
              <li key={`${blocker.kind}:${blocker.stageId}:${index}`}>
                <Button
                  type="button"
                  variant="link"
                  className="h-auto whitespace-normal p-0 text-left text-sm text-status-warning-text underline"
                  onClick={() => controller.openBlocker(blocker)}
                >
                  {blocker.stageId
                    ? t('delivery_os.flow.blockers.atStage', { reason: t(`delivery_os.flow.blocker.${blocker.kind}`), stage: t(`delivery_os.flow.stage.${blocker.stageId}`) })
                    : t('delivery_os.flow.blockers.atIntake', { reason: t(`delivery_os.flow.blocker.${blocker.kind}`) })}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <WorkflowStudioLink projectId={projectId} />
        {secondaryActions.length > 0 ? (
          <ActionsDropdown items={secondaryActions} label={t('delivery_os.flow.secondaryActions')} triggerIcon={false} />
        ) : null}
      </div>
    </section>
  )
}
