import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { DeliveryFlowStageArtifact, DeliveryFlowStageDecision, type DeliveryProject } from '../data/entities'
import {
  buildDeliveryError,
  FLOW_APPROVAL_STAGE_ORDER,
  flowTemplateV1Schema,
  type DeliveryCheckResult,
  type DeliveryErrorDetail,
  type FlowTemplateRef,
  type FlowTemplateV1,
} from '../lib/contracts'
import {
  checkFlowGate,
  computeStageCurrency,
  type StageArtifactRecord,
  type StageCurrencyMap,
  type StageDecisionRecord,
} from '../lib/flowRules'
import type { DeliveryScope } from './shared'

const logger = createLogger('delivery_os')

export type PinnedFlowProject = Pick<DeliveryProject, 'id' | 'flowTemplateId' | 'flowTemplateSnapshot'>

export type FlowGateStates = { template: FlowTemplateV1; states: StageCurrencyMap }

export async function loadStageArtifactRows(em: EntityManager, projectId: string, scope: DeliveryScope): Promise<DeliveryFlowStageArtifact[]> {
  const rows = await findWithDecryption(
    em,
    DeliveryFlowStageArtifact,
    { projectId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    undefined,
    scope,
  )
  return [...rows].sort((left, right) => left.version - right.version)
}

export async function loadStageDecisionRows(em: EntityManager, projectId: string, scope: DeliveryScope): Promise<DeliveryFlowStageDecision[]> {
  const rows = await findWithDecryption(
    em,
    DeliveryFlowStageDecision,
    { projectId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    undefined,
    scope,
  )
  return [...rows].sort((left, right) => left.decidedAt.getTime() - right.decidedAt.getTime() || left.id.localeCompare(right.id))
}

export function toStageArtifactRecord(row: DeliveryFlowStageArtifact): StageArtifactRecord {
  return { id: row.id, stageId: row.stageId, version: row.version, contentHash: row.contentHash, dependsOn: row.dependsOn }
}

/** Only an approval stores the approver columns, so their presence is the exact `clientApproved` flag. */
export function toStageDecisionRecord(row: DeliveryFlowStageDecision): StageDecisionRecord {
  return {
    id: row.id,
    stageId: row.stageId,
    artifactId: row.artifactId,
    subjectHash: row.subjectHash,
    verdict: row.verdict,
    decidedAt: row.decidedAt.toISOString(),
    clientApproved: row.verdict === 'approved' && typeof row.clientApproverName === 'string' && row.clientApproverName.length > 0,
  }
}

/** The pinned marker: `flow_template_id` set by the pin command. Legacy projects keep it null and are never gated. */
export function isFlowPinned(project: Pick<DeliveryProject, 'flowTemplateId'>): boolean {
  return project.flowTemplateId !== null && project.flowTemplateId !== undefined
}

export function readPinnedTemplate(project: Pick<DeliveryProject, 'flowTemplateSnapshot'>): FlowTemplateV1 | null {
  const parsed = flowTemplateV1Schema.safeParse(project.flowTemplateSnapshot)
  return parsed.success ? parsed.data : null
}

export function readPinnedTemplateRef(project: Pick<DeliveryProject, 'flowTemplateId' | 'flowTemplateVersion' | 'flowTemplateHash'>): FlowTemplateRef | null {
  if (!project.flowTemplateId || !project.flowTemplateVersion || !project.flowTemplateHash) return null
  return { templateId: project.flowTemplateId, version: project.flowTemplateVersion, hash: project.flowTemplateHash }
}

/**
 * Stage currency of a pinned project derived from the snapshot and the append-only rows; `null` for legacy projects
 * and `'unreadable'` when the pinned snapshot no longer parses (the gate then fails closed).
 */
export async function loadFlowGateStates(em: EntityManager, project: PinnedFlowProject, scope: DeliveryScope): Promise<FlowGateStates | 'unreadable' | null> {
  if (!isFlowPinned(project)) return null
  const template = readPinnedTemplate(project)
  if (!template) return 'unreadable'
  const artifactRows = await loadStageArtifactRows(em, project.id, scope)
  const decisionRows = await loadStageDecisionRows(em, project.id, scope)
  const states = computeStageCurrency(template, artifactRows.map(toStageArtifactRecord), decisionRows.map(toStageDecisionRecord))
  return { template, states }
}

export function unreadableSnapshotDetails(): DeliveryErrorDetail[] {
  return FLOW_APPROVAL_STAGE_ORDER.map((stageId) => ({
    path: `stages.${stageId}`,
    code: 'stage_not_approved',
    message: `Stage ${stageId} is missing (pinned template snapshot is unreadable)`,
  }))
}

/**
 * The server-side flow gate on the frozen v1 paths (task ready, attempt reserve in any mode, publish consent):
 * a pinned project needs all four approval stages (the template schema requires each) approved and current. The refusal keeps the v1 code
 * `422 baseline_not_approved`; the stage detail lives in `details[]` (`FLOW_GATE_DETAIL_CODES`). Unpinned projects
 * skip the gate without a query, so legacy behaviour is untouched.
 */
export async function checkProjectFlowGateV1(em: EntityManager, project: PinnedFlowProject, scope: DeliveryScope): Promise<DeliveryCheckResult> {
  const loaded = await loadFlowGateStates(em, project, scope)
  if (loaded === null) return { ok: true }
  if (loaded === 'unreadable') {
    logger.warn('pinned flow template snapshot is unreadable; gate fails closed', { projectId: project.id, templateId: project.flowTemplateId })
    return { ok: false, ...buildDeliveryError('baseline_not_approved', 'Flow stages are not approved', unreadableSnapshotDetails()) }
  }
  const result = checkFlowGate(loaded.states, FLOW_APPROVAL_STAGE_ORDER, { v1Compatible: true })
  if (result.ok) return result
  return { ok: false, ...buildDeliveryError('baseline_not_approved', result.body.error, result.body.details) }
}
