import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import ProjectExecutionActionWidget from './widget.client'

type DeliveryProjectExecutionContext = {
  projectId: string
  taskId?: string
  baselineId?: string
  updatedAt?: string
  retryLastMutation?: () => void
}

/**
 * Renders execution controls (run / cancel / status) for the active task on the
 * delivery_os project detail page.
 *
 * Mounted via spot `delivery_os.project.execution`; gated on
 * `delivery_agents.execute`. The widget is a skeleton in EXEC-02 — the
 * execution API call and attempt lifecycle are wired in EXEC-04.
 */
const widget: InjectionWidgetModule<DeliveryProjectExecutionContext, undefined> = {
  metadata: {
    id: 'delivery_agents.injection.project-execution-action',
    title: 'Execute delivery task',
    description: 'Authorises and runs the active task via Cezar, shows attempt status',
    features: ['delivery_agents.execute'],
    priority: 50,
    enabled: true,
  },
  Widget: ProjectExecutionActionWidget,
}

export default widget
