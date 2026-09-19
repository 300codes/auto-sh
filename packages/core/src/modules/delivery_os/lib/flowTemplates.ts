import { DELIVERY_FLOW_SCHEMA_VERSIONS, flowTemplateV1Schema, type FlowTemplateV1 } from './contracts'

export const DEFAULT_FLOW_TEMPLATE_ID = 'delivery-default'

const defaultTemplateDocument = {
  schemaVersion: DELIVERY_FLOW_SCHEMA_VERSIONS.flowTemplate,
  templateId: DEFAULT_FLOW_TEMPLATE_ID,
  version: 1,
  title: 'Brief to WordPress delivery',
  stages: [
    {
      stageId: 'scope',
      kind: 'scope',
      title: 'Scope with agent and tool choice',
      executor: { kind: 'agent', ref: 'delivery.scoping' },
      approverFeatures: ['delivery_os.stages.approve'],
      requiresClientApproval: false,
      dependsOn: [],
      conditions: [],
    },
    {
      stageId: 'ux',
      kind: 'ux',
      title: 'UX in Figma',
      executor: { kind: 'adapter', ref: 'figma' },
      approverFeatures: ['delivery_os.stages.approve'],
      requiresClientApproval: false,
      dependsOn: ['scope'],
      conditions: [],
    },
    {
      stageId: 'key_visual',
      kind: 'key_visual',
      title: 'Key Visual',
      executor: { kind: 'adapter', ref: 'figma' },
      approverFeatures: ['delivery_os.stages.approve'],
      requiresClientApproval: true,
      dependsOn: ['ux'],
      conditions: [],
    },
    {
      stageId: 'design_system_ui',
      kind: 'design_system_ui',
      title: 'Design System and UI',
      executor: { kind: 'adapter', ref: 'figma' },
      approverFeatures: ['delivery_os.stages.approve'],
      requiresClientApproval: true,
      dependsOn: ['key_visual'],
      conditions: [],
    },
    {
      stageId: 'implementation',
      kind: 'implementation',
      title: 'WordPress implementation',
      executor: { kind: 'adapter', ref: 'wordpress' },
      approverFeatures: [],
      requiresClientApproval: false,
      dependsOn: ['design_system_ui'],
      conditions: [],
    },
    {
      stageId: 'qa',
      kind: 'qa',
      title: 'QA and fixes',
      executor: { kind: 'human', ref: null },
      approverFeatures: ['delivery_os.results.import'],
      requiresClientApproval: false,
      dependsOn: ['implementation'],
      conditions: [],
    },
    {
      stageId: 'deploy',
      kind: 'deploy',
      title: 'Publish consent',
      executor: { kind: 'human', ref: null },
      approverFeatures: ['delivery_os.deploy.approve'],
      requiresClientApproval: false,
      dependsOn: ['qa'],
      conditions: [],
    },
    {
      stageId: 'release',
      kind: 'release',
      title: 'Final acceptance',
      executor: { kind: 'human', ref: null },
      approverFeatures: ['delivery_os.release.approve'],
      requiresClientApproval: true,
      dependsOn: ['deploy'],
      conditions: [],
    },
  ],
  approvalPolicy: { rejectionReturnsTo: 'stage_owner', staleApprovalRequiresReapproval: true },
}

export const DEFAULT_FLOW_TEMPLATE: FlowTemplateV1 = flowTemplateV1Schema.parse(defaultTemplateDocument)

export function getBuiltInFlowTemplate(templateId: string, version: number): FlowTemplateV1 | undefined {
  if (templateId === DEFAULT_FLOW_TEMPLATE.templateId && version === DEFAULT_FLOW_TEMPLATE.version) return DEFAULT_FLOW_TEMPLATE
  return undefined
}
