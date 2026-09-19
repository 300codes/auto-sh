import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { DeliveryFlowBaselineBinding, type DeliveryProject } from '../data/entities'
import { buildDeliveryError, FLOW_APPROVAL_STAGE_ORDER, type DeliveryCheckResult, type StageArtifactDependency } from '../lib/contracts'
import { hashFlowTemplate } from '../lib/flowRules'
import { flowRefsHash } from '../lib/flowBaseline'
import { checkProjectFlowGateV1, isFlowPinned, loadFlowGateStates, loadStageArtifactRows } from './flowGate'
import { assertDeliveryCheck, deliveryHttpError, type DeliveryScope } from './shared'

export function flowBaselineFailure(code: string): DeliveryCheckResult & { ok: false } {
  return { ok: false, ...buildDeliveryError('baseline_not_approved', 'Flow baseline is not current', [{ path: 'baselineId', code }]) }
}

export async function currentFlowRefs(em: EntityManager, project: DeliveryProject, scope: DeliveryScope): Promise<StageArtifactDependency[]> {
  assertDeliveryCheck(await checkProjectFlowGateV1(em, project, scope))
  const loaded = await loadFlowGateStates(em, project, scope)
  if (!loaded || loaded === 'unreadable' || hashFlowTemplate(loaded.template) !== project.flowTemplateHash || loaded.template.templateId !== project.flowTemplateId || loaded.template.version !== project.flowTemplateVersion) {
    throw deliveryHttpError(flowBaselineFailure('flow_template_hash_mismatch'))
  }
  const rows = await loadStageArtifactRows(em, project.id, scope)
  return FLOW_APPROVAL_STAGE_ORDER.map((stageId) => {
    const ref = loaded.states[stageId].currentArtifact
    const row = rows.find((candidate) => candidate.id === ref?.artifactId && candidate.templateHash === project.flowTemplateHash)
    if (!ref || !row) throw deliveryHttpError(flowBaselineFailure('stage_not_approved'))
    return { stageId, ...ref }
  })
}

export async function checkFlowExecutionGate(em: EntityManager, project: DeliveryProject, baselineId: string, scope: DeliveryScope): Promise<DeliveryCheckResult> {
  if (!isFlowPinned(project)) return { ok: true }
  const stages = await checkProjectFlowGateV1(em, project, scope)
  if (!stages.ok) return stages
  const stageRefs = await currentFlowRefs(em, project, scope)
  const binding = await findOneWithDecryption(em, DeliveryFlowBaselineBinding, {
    tenantId: scope.tenantId, organizationId: scope.organizationId, projectId: project.id,
    baselineId, templateHash: project.flowTemplateHash!, refsHash: flowRefsHash(stageRefs),
  }, undefined, scope)
  if (!binding || flowRefsHash(binding.stageRefs) !== flowRefsHash(stageRefs)) return flowBaselineFailure('flow_baseline_binding_missing')
  return { ok: true }
}
