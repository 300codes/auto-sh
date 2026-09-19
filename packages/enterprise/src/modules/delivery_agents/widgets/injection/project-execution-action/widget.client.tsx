'use client'

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'

type DeliveryProjectExecutionContext = {
  projectId: string
  taskId?: string
  baselineId?: string
  updatedAt?: string
  retryLastMutation?: () => void
}

/**
 * Skeleton execution action widget — EXEC-02.
 * Actual execute/cancel API calls and attempt status polling are wired in EXEC-04.
 */
export default function ProjectExecutionActionWidget({
  context,
}: InjectionWidgetComponentProps<DeliveryProjectExecutionContext, undefined>) {
  if (!context.taskId) return null

  return (
    <div data-testid="delivery-execution-action" data-project-id={context.projectId} data-task-id={context.taskId}>
      {/* Execution controls rendered by EXEC-04 */}
    </div>
  )
}
