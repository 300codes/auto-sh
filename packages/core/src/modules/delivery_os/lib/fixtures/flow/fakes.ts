import { flowTemplateV1Schema, type FlowTemplateV1 } from '../../contracts'
import type { DeliveryFlowTemplateProvider, FlowTemplateLookup } from '../../../commands/flowTemplateProvider'
import { hashFlowTemplate } from '../../flowRules'
import { DEFAULT_FLOW_TEMPLATE } from '../../flowTemplates'

/** v1 of the default process: the built-in `delivery-default@1`. */
export const FAKE_TEMPLATE_V1: FlowTemplateV1 = DEFAULT_FLOW_TEMPLATE

/**
 * v2 as a workflows-backed builder would publish it: an extra non-approval content review depending on UX (graph
 * change) and a new condition on the implementation stage (semantic change without a topology change). Both change
 * the hash; the four approval stages stay as in v1.
 */
export const FAKE_TEMPLATE_V2: FlowTemplateV1 = flowTemplateV1Schema.parse({
  ...DEFAULT_FLOW_TEMPLATE,
  version: 2,
  title: 'Brief to WordPress delivery (with content review)',
  stages: DEFAULT_FLOW_TEMPLATE.stages.flatMap((stage) => {
    if (stage.stageId === 'implementation') {
      return [{ ...stage, conditions: [{ key: 'wordpress_site_ready', operator: 'exists' as const }] }]
    }
    if (stage.stageId !== 'ux') return [stage]
    return [
      stage,
      {
        stageId: 'content_review',
        kind: 'qa' as const,
        title: 'Content review',
        executor: { kind: 'human' as const, ref: null },
        approverFeatures: ['delivery_os.stages.approve'],
        requiresClientApproval: false,
        dependsOn: ['ux'],
        conditions: [],
      },
    ]
  }),
})

export type FakeFlowTemplateProvider = DeliveryFlowTemplateProvider & {
  publish(template: FlowTemplateV1): void
  unpublish(templateId: string, version: number): void
  readonly calls: Array<{ templateId: string; version: number }>
}

/**
 * Deterministic stand-in for the workflows-backed provider (Marcin's seam). It states the hash it published, as a
 * real provider should, so the pin command verifies it against `hashFlowTemplate`.
 */
export function createFakeTemplateProvider(initial: readonly FlowTemplateV1[] = [FAKE_TEMPLATE_V1]): FakeFlowTemplateProvider {
  const published = new Map<string, FlowTemplateV1>(initial.map((template) => [`${template.templateId}@${template.version}`, template]))
  const calls: Array<{ templateId: string; version: number }> = []
  return {
    calls,
    publish(template) {
      published.set(`${template.templateId}@${template.version}`, template)
    },
    unpublish(templateId, version) {
      published.delete(`${templateId}@${version}`)
    },
    async getTemplate(templateId, version): Promise<FlowTemplateLookup> {
      calls.push({ templateId, version })
      const template = published.get(`${templateId}@${version}`)
      return template ? { template, hash: hashFlowTemplate(template) } : null
    },
  }
}
