import { flowTemplateV1Schema, type FlowTemplateV1 } from '../lib/contracts'
import { getBuiltInFlowTemplate } from '../lib/flowTemplates'

export const DELIVERY_FLOW_TEMPLATE_PROVIDER_KEY = 'deliveryFlowTemplateProvider'

export type ResolvedFlowTemplate = { template: FlowTemplateV1; hash: string }

export type FlowTemplateLookup = FlowTemplateV1 | ResolvedFlowTemplate | null

/**
 * Resolves a published process template by id and version. The OSS default only knows the built-in
 * `delivery-default@1`; a workflows-backed provider replaces this registration and may state the hash it published
 * so the pin command can verify it.
 */
export type DeliveryFlowTemplateProvider = {
  getTemplate(templateId: string, version: number): Promise<FlowTemplateLookup>
}

export function createBuiltInFlowTemplateProvider(): DeliveryFlowTemplateProvider {
  return {
    async getTemplate(templateId, version) {
      return getBuiltInFlowTemplate(templateId, version) ?? null
    },
  }
}

export function isResolvedFlowTemplate(value: FlowTemplateLookup): value is ResolvedFlowTemplate {
  return value !== null && 'template' in value && 'hash' in value && !('schemaVersion' in value)
}

export function parseFlowTemplateLookup(value: FlowTemplateLookup): { template: FlowTemplateV1; statedHash: string | null } | null {
  if (value === null) return null
  const statedHash = isResolvedFlowTemplate(value) ? value.hash : null
  const parsed = flowTemplateV1Schema.safeParse(isResolvedFlowTemplate(value) ? value.template : value)
  if (!parsed.success) return null
  return { template: parsed.data, statedHash }
}

type ContainerLike = { resolve(name: string): unknown }

export function resolveFlowTemplateProvider(container: ContainerLike): DeliveryFlowTemplateProvider | null {
  try {
    return container.resolve(DELIVERY_FLOW_TEMPLATE_PROVIDER_KEY) as DeliveryFlowTemplateProvider
  } catch {
    return null
  }
}
