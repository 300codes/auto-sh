import type { WorkflowDefinition } from '@open-mercato/core/modules/workflows/data/entities'
import { getBuiltInFlowTemplate } from '@open-mercato/core/modules/delivery_os/lib/flowTemplates'
import { mapDeliveryWorkflow } from '../templateMapper'
import { createWorkflowFlowTemplateProvider } from '../flowTemplateProvider'
import type { PublishedDefinitionService } from '@open-mercato/core/modules/workflows/lib/published-definition-service'

function definition(version = 1): WorkflowDefinition {
  const template = structuredClone(getBuiltInFlowTemplate('delivery-default', 1)!)
  return {
    id: `definition-${version}`, version, workflowId: 'project-delivery', workflowName: 'Delivery',
    lifecycle: 'published', metadata: { immutablePolicy: 'delivery' }, grantedFeatures: ['delivery_os.projects.view'],
    definition: {
      steps: [{ stepId: 'start', stepName: 'Start', stepType: 'START' }, ...template.stages.map((stage) => ({
        stepId: stage.stageId, stepName: stage.title, stepType: (['scope', 'ux', 'key_visual', 'design_system_ui'].includes(stage.stageId) ? 'WAIT_FOR_SIGNAL' : 'USER_TASK') as 'WAIT_FOR_SIGNAL' | 'USER_TASK', signalConfig: { signalName: `delivery.stage.${stage.stageId}.approved` }, config: { deliveryStage: stage },
      })), { stepId: 'end', stepName: 'End', stepType: 'END' }],
      transitions: template.stages.flatMap((stage) => (stage.dependsOn.length ? stage.dependsOn : ['start']).map((fromStepId) => ({
        transitionId: `${fromStepId}-${stage.stageId}`, fromStepId, toStepId: stage.stageId, trigger: 'auto' as const,
      }))),
    },
  } as WorkflowDefinition
}

test('binding hashes the full native conditions/tools/approval config without extending frozen v1', () => {
  const original = definition()
  const mapped = mapDeliveryWorkflow(original)
  const condition = structuredClone(original)
  condition.definition.transitions[0].condition = { field: 'approved', operator: '=', value: true }
  expect(mapDeliveryWorkflow(condition).definitionHash).not.toBe(mapped.definitionHash)
  expect(mapDeliveryWorkflow(condition).template).toEqual(mapped.template)
  const tool = structuredClone(original)
  tool.definition.steps[1].config = { ...tool.definition.steps[1].config, tool: 'changed' }
  expect(mapDeliveryWorkflow(tool).definitionHash).not.toBe(mapped.definitionHash)
  expect(mapDeliveryWorkflow(definition(2)).definitionHash).not.toBe(mapped.definitionHash)
})

test('invalid policy or missing mandatory approvals fail closed', () => {
  const invalid = definition()
  invalid.metadata = {}
  expect(() => mapDeliveryWorkflow(invalid)).toThrow()
  const approval = definition()
  const stage = approval.definition.steps[1].config!.deliveryStage as { approverFeatures: string[] }
  stage.approverFeatures = []
  expect(() => mapDeliveryWorkflow(approval)).toThrow()
})

test('one provider resolves the same version independently per scope and preserves built-in fallback', async () => {
  const first = { tenantId: 'tenant-a', organizationId: 'org-a' }
  const second = { tenantId: 'tenant-b', organizationId: 'org-b' }
  const getExactPublished = jest.fn(async (scope, id, version) => scope.tenantId === first.tenantId && id === 'project-delivery' && version === 1 ? definition() : null)
  const provider = createWorkflowFlowTemplateProvider({ getExactPublished } as unknown as PublishedDefinitionService)
  expect(await provider.forScope!(first).getTemplate('project-delivery', 1)).toMatchObject({ definitionId: 'definition-1' })
  expect(await provider.forScope!(second).getTemplate('project-delivery', 1)).toBeNull()
  expect(await provider.forScope!(first).getTemplate('project-delivery', 2)).toBeNull()
  expect(await provider.getTemplate('delivery-default', 1)).toMatchObject({ templateId: 'delivery-default' })
  expect(getExactPublished).toHaveBeenCalledWith(second, 'project-delivery', 1)
})

test('a graph edge bypassing a mandatory gate or replacing its durable wait is rejected', () => {
  const bypass = definition()
  bypass.definition.transitions.push({ transitionId: 'bypass', fromStepId: 'start', toStepId: 'implementation', trigger: 'auto' })
  expect(() => mapDeliveryWorkflow(bypass)).toThrow()
  const noWait = definition()
  noWait.definition.steps[1].stepType = 'AUTOMATED'
  expect(() => mapDeliveryWorkflow(noWait)).toThrow()
  const noClient = definition()
  const declaration = noClient.definition.steps.find((step) => step.stepId === 'key_visual')!.config!.deliveryStage as { requiresClientApproval: boolean }
  declaration.requiresClientApproval = false
  expect(() => mapDeliveryWorkflow(noClient)).toThrow()
})
