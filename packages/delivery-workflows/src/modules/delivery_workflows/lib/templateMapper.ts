import { createHash } from 'node:crypto'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { DELIVERY_FLOW_SCHEMA_VERSIONS, flowTemplateV1Schema, flowTemplateStageSchema, type FlowTemplateV1 } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { hashFlowTemplate } from '@open-mercato/core/modules/delivery_os/lib/flowRules'
import type { WorkflowDefinition } from '@open-mercato/core/modules/workflows/data/entities'

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([first], [second]) => first.localeCompare(second)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
export function hashWorkflowDefinition(definition: Pick<WorkflowDefinition, 'definition' | 'metadata' | 'grantedFeatures' | 'workflowId' | 'version'>) {
  return createHash('sha256').update(canonical({ workflowId: definition.workflowId, version: definition.version,
    definition: definition.definition, metadata: definition.metadata, grantedFeatures: definition.grantedFeatures })).digest('hex')
}

export function mapDeliveryWorkflow(definition: WorkflowDefinition) {
  if (definition.lifecycle !== 'published' || definition.metadata?.immutablePolicy !== 'delivery') throw new CrudHttpError(422, { error: '[internal] Published immutable Delivery process required' })
  const requiredGates = ['scope', 'ux', 'key_visual', 'design_system_ui']
  if (definition.definition.triggers?.length) throw new CrudHttpError(422, { error: '[internal] Delivery process starts only through its project binding' })
  for (const stageId of requiredGates) {
    const step = definition.definition.steps.find((candidate) => candidate.stepId === stageId)
    if (step?.stepType !== 'WAIT_FOR_SIGNAL' || step.signalConfig?.signalName !== `delivery.stage.${stageId}.approved` || step.activities?.length) {
      throw new CrudHttpError(422, { error: '[internal] Mandatory approval must wait for its guarded domain signal' })
    }
  }
  const stages = definition.definition.steps.filter((step) => step.stepType !== 'START' && step.stepType !== 'END').map((step) => {
    const parsed = flowTemplateStageSchema.safeParse(step.config?.deliveryStage)
    if (!parsed.success || parsed.data.stageId !== step.stepId) throw new CrudHttpError(422, { error: '[internal] Every process step requires a matching Delivery stage declaration' })
    const dependsOn = definition.definition.transitions.filter((transition) => transition.toStepId === step.stepId)
      .map((transition) => transition.fromStepId).filter((id) => definition.definition.steps.find((source) => source.stepId === id)?.stepType !== 'START')
    return { ...parsed.data, title: step.stepName, dependsOn: [...new Set(dependsOn)] }
  })
  const template: FlowTemplateV1 = flowTemplateV1Schema.parse({
    schemaVersion: DELIVERY_FLOW_SCHEMA_VERSIONS.flowTemplate, templateId: definition.workflowId, version: definition.version,
    title: definition.workflowName, stages,
    approvalPolicy: { rejectionReturnsTo: 'stage_owner', staleApprovalRequiresReapproval: true },
  })
  for (const stage of template.stages) {
    if (['key_visual', 'design_system_ui'].includes(stage.kind) && !stage.requiresClientApproval) throw new CrudHttpError(422, { error: '[internal] Mandatory client approval cannot be removed' })
    const feature = stage.kind === 'deploy' ? 'delivery_os.deploy.approve' : stage.kind === 'release' ? 'delivery_os.release.approve'
      : ['scope', 'ux', 'key_visual', 'design_system_ui'].includes(stage.kind) ? 'delivery_os.stages.approve' : null
    if (feature && !stage.approverFeatures.includes(feature)) throw new CrudHttpError(422, { error: '[internal] Mandatory approval feature missing' })
  }
  if (!template.stages.some((stage) => stage.kind === 'deploy') || !template.stages.some((stage) => stage.kind === 'release')) throw new CrudHttpError(422, { error: '[internal] Publication consent and release stages are mandatory' })
  for (const stage of template.stages.filter((candidate) => ['implementation', 'deploy', 'release'].includes(candidate.kind))) {
    for (const gate of requiredGates) {
      const reachable = new Set(definition.definition.steps.filter((step) => step.stepType === 'START').map((step) => step.stepId))
      let expanded = true
      while (expanded) {
        expanded = false
        for (const transition of definition.definition.transitions) {
          if (transition.toStepId !== gate && reachable.has(transition.fromStepId) && !reachable.has(transition.toStepId)) {
            reachable.add(transition.toStepId)
            expanded = true
          }
        }
      }
      if (reachable.has(stage.stageId)) throw new CrudHttpError(422, { error: '[internal] Process path bypasses mandatory server approval' })
    }
  }
  return { template, hash: hashFlowTemplate(template), definitionId: definition.id, definitionHash: hashWorkflowDefinition(definition) }
}
