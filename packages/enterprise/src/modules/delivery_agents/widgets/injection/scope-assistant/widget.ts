import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import type { ScopingWidgetContext } from '@open-mercato/core/modules/delivery_os/lib/scopingContext'
import ScopeAssistant from './widget.client'
const widget: InjectionWidgetModule<ScopingWidgetContext> = {
  metadata: { id: 'delivery_agents.injection.scope-assistant', title: 'Scope assistant', features: ['delivery_agents.scope', 'delivery_os.projects.view', 'delivery_os.results.import', 'ai_assistant.view'], priority: 50, enabled: true },
  Widget: ScopeAssistant,
}
export default widget
