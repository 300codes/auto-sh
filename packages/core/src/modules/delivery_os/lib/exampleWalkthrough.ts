import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { createAttachmentFromBuffer } from '@open-mercato/core/modules/attachments/lib/createFromBuffer'
import {
  DeliveryBaseline,
  DeliveryDecision,
  DeliveryFlowBaselineBinding,
  DeliveryFlowStageArtifact,
  DeliveryFlowStageDecision,
  DeliveryIntake,
  DeliveryProject,
  DeliveryTask,
} from '../data/entities'
import {
  DELIVERY_FLOW_SCHEMA_VERSIONS,
  DELIVERY_SCHEMA_VERSIONS,
  FLOW_APPROVAL_STAGE_ORDER,
  type DesignScreen,
  type FlowStageId,
  type StageArtifactDependency,
} from './contracts'
import { hashBaseline } from './baseline'
import { hashStageArtifactContent } from './stageArtifacts'
import { DEFAULT_FLOW_TEMPLATE, DEFAULT_FLOW_TEMPLATE_ID } from './flowTemplates'
import { hashFlowTemplate } from './flowRules'
import { flowRefsHash } from './flowBaseline'
import { hashCanonical } from './hash'
import { EXAMPLE_ASSETS, EXAMPLE_FIGMA_FILE_KEY, readExampleAsset } from './exampleAssets'
import { EXAMPLE_INTAKE_BRIEF, EXAMPLE_INTAKE_QUESTIONS, EXAMPLE_SCOPE_CONTENT, EXAMPLE_STAGE_PROSE, EXAMPLE_TASKS } from './exampleContent'

const logger = createLogger('delivery_os').child({ component: 'example-walkthrough' })

/** Every row this seeder writes says who made it, so a demonstration is never mistaken for a real agent run. */
export const EXAMPLE_PRODUCED_BY = { tool: 'example-seed', sessionRef: null } as const
export const EXAMPLE_APPROVER = 'Aster Works (przykład)'
export const EXAMPLE_APPROVAL_NOTE = 'Przykładowy przebieg: decyzję zapisał seeder, nie klient.'

type Scope = { tenantId: string; organizationId: string }

async function storeScreens(em: EntityManager, projectId: string, scope: Scope, capturedAt: string): Promise<Map<FlowStageId, DesignScreen[]>> {
  const byStage = new Map<FlowStageId, DesignScreen[]>()
  for (const asset of EXAMPLE_ASSETS) {
    const { bytes, sha256 } = await readExampleAsset(asset)
    const attachment = await createAttachmentFromBuffer({
      em,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      entityId: 'delivery_os:project',
      recordId: projectId,
      fileName: asset.file,
      mimeType: 'image/png',
      buffer: bytes,
    })
    const screen: DesignScreen = {
      fileKey: EXAMPLE_FIGMA_FILE_KEY,
      nodeId: asset.nodeId,
      name: asset.name,
      viewport: { width: asset.width, height: asset.height },
      attachmentId: attachment.id,
      sha256,
      capturedAt,
      sizeBytes: bytes.length,
      mimeType: 'image/png',
    }
    byStage.set(asset.stageId, [...(byStage.get(asset.stageId) ?? []), screen])
  }
  return byStage
}

function stageContent(stageId: FlowStageId, screens: DesignScreen[]): unknown {
  if (stageId === 'scope') return EXAMPLE_SCOPE_CONTENT
  const prose = EXAMPLE_STAGE_PROSE[stageId as 'ux' | 'key_visual' | 'design_system_ui']
  return {
    summary: prose.summary,
    figmaRefs: screens.map((screen) => ({
      fileKey: screen.fileKey,
      nodeId: screen.nodeId,
      name: screen.name,
      figmaVersion: null,
      url: `https://www.figma.com/design/${EXAMPLE_FIGMA_FILE_KEY}?node-id=${screen.nodeId.replace(':', '-')}`,
    })),
    screens,
    notes: prose.notes,
    resolvedThreadKeys: [],
  }
}

/**
 * Writes the example project as a finished walkthrough: four approved stages carrying the renders the agent built in
 * Figma, a frozen baseline activated by its two decisions, and the planned tasks. Hashes come from the same functions
 * the running system uses and every screen points at an attachment whose bytes exist, so the report reads a real
 * delivery rather than rows shaped like one.
 */
export async function seedExampleWalkthrough(
  em: EntityManager,
  project: DeliveryProject,
  actorUserId: string,
  scope: Scope,
): Promise<{ baselineId: string; taskCount: number; screenCount: number }> {
  const now = new Date()
  const capturedAt = now.toISOString()
  const screensByStage = await storeScreens(em, project.id, scope, capturedAt)
  const templateHash = hashFlowTemplate(DEFAULT_FLOW_TEMPLATE)

  project.flowTemplateId = DEFAULT_FLOW_TEMPLATE_ID
  project.flowTemplateVersion = DEFAULT_FLOW_TEMPLATE.version
  project.flowTemplateHash = templateHash
  project.flowTemplateSnapshot = DEFAULT_FLOW_TEMPLATE
  project.flowPinnedAt = now

  em.persist(em.create(DeliveryIntake, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    projectId: project.id,
    schemaVersion: DELIVERY_FLOW_SCHEMA_VERSIONS.intake,
    step: 'submitted',
    brief: { ...EXAMPLE_INTAKE_BRIEF, features: [...EXAMPLE_INTAKE_BRIEF.features], integrations: [...EXAMPLE_INTAKE_BRIEF.integrations], constraints: [...EXAMPLE_INTAKE_BRIEF.constraints], inspirations: [], materials: [], unknowns: [...EXAMPLE_INTAKE_BRIEF.unknowns] },
    questions: [...EXAMPLE_INTAKE_QUESTIONS],
    proposals: [],
    platform: {
      recommendation: { profileId: project.targetProfileId, profileVersion: project.targetProfileVersion, rationale: EXAMPLE_SCOPE_CONTENT.platform.rationale, alternatives: [] },
      chosen: { profileId: project.targetProfileId, profileVersion: project.targetProfileVersion, chosenBy: actorUserId, chosenAt: capturedAt },
    },
    tools: [],
  }))

  let upstream: StageArtifactDependency[] = []
  for (const stageId of FLOW_APPROVAL_STAGE_ORDER) {
    const screens = screensByStage.get(stageId) ?? []
    const content = stageContent(stageId, screens)
    const artifact = {
      schemaVersion: DELIVERY_FLOW_SCHEMA_VERSIONS.stageArtifact,
      projectId: project.id,
      stageId,
      source: 'manual' as const,
      dependsOn: upstream,
      attachments: [],
      producedBy: EXAMPLE_PRODUCED_BY,
      content,
    }
    const contentHash = hashStageArtifactContent(artifact as Parameters<typeof hashStageArtifactContent>[0])
    const row = em.create(DeliveryFlowStageArtifact, {
      id: randomUUID(),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      projectId: project.id,
      stageId,
      version: 1,
      contentHash,
      source: 'manual',
      content,
      dependsOn: upstream,
      attachmentIds: screens.map((screen) => screen.attachmentId),
      templateHash,
      createdBy: actorUserId,
      createdAt: now,
    })
    em.persist(row)
    em.persist(em.create(DeliveryFlowStageDecision, {
      id: randomUUID(),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      projectId: project.id,
      stageId,
      artifactId: row.id,
      subjectHash: contentHash,
      subjectVersion: 1,
      verdict: 'approved',
      reason: null,
      actorUserId,
      decidedAt: now,
      clientApproverName: EXAMPLE_APPROVER,
      clientApproverRole: 'Dyrektor zarządzający',
      clientApprovalEvidence: { kind: 'email', reference: EXAMPLE_APPROVAL_NOTE, attachment: null, recordedAt: capturedAt },
      deferredThreadKeys: [],
      templateHash,
      idempotencyKey: `example-${stageId}`,
      requestHash: contentHash,
    }))
    upstream = [{ stageId, artifactId: row.id, version: 1, contentHash }]
  }

  const allScreens = [...screensByStage.values()].flat()
  const acTestMap = Object.fromEntries(EXAMPLE_SCOPE_CONTENT.acceptanceCriteria.map((criterion) => [criterion.id, []]))
  const manualChecks = Object.fromEntries(EXAMPLE_SCOPE_CONTENT.acceptanceCriteria.map((criterion) => [criterion.id, `example-${criterion.id.toLowerCase()}`]))
  const draft = {
    requirements: EXAMPLE_SCOPE_CONTENT.requirements,
    acceptanceCriteria: EXAMPLE_SCOPE_CONTENT.acceptanceCriteria,
    risks: EXAMPLE_SCOPE_CONTENT.risks,
    screens: allScreens,
    tokens: {},
    architectureSummary: EXAMPLE_SCOPE_CONTENT.platform.rationale,
    planSummary: EXAMPLE_SCOPE_CONTENT.summary,
    acTestMap,
    manualChecks,
    declaredTests: [],
    attachments: [],
    comments: [],
    questions: [],
    adr: [],
  }
  const baselineContent = {
    schemaVersion: DELIVERY_SCHEMA_VERSIONS.baselineContent,
    requirements: draft.requirements,
    acceptanceCriteria: draft.acceptanceCriteria,
    screens: allScreens,
    tokens: {},
    architectureSummary: draft.architectureSummary,
    planSummary: draft.planSummary,
    acTestMap,
    manualChecks,
    declaredTests: [],
    attachments: [],
    resolvedComments: [],
    importedManifestHashes: [],
  }
  const contentHash = hashBaseline(baselineContent as Parameters<typeof hashBaseline>[0])
  const baseline = em.create(DeliveryBaseline, {
    id: randomUUID(),
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    projectId: project.id,
    version: 1,
    contentHash,
    source: 'manual',
    parentBaselineId: null,
    content: baselineContent,
    attachmentIds: allScreens.map((screen) => screen.attachmentId),
    createdBy: actorUserId,
    createdAt: now,
  })
  em.persist(baseline)

  project.draftSpec = { ...draft, flowBaseline: { templateHash, stageRefs: upstream, draftHash: hashCanonical(draft) } }
  project.activeBaselineId = baseline.id
  project.updatedAt = now

  em.persist(em.create(DeliveryFlowBaselineBinding, {
    id: randomUUID(),
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    projectId: project.id,
    baselineId: baseline.id,
    templateHash,
    refsHash: flowRefsHash(upstream),
    stageRefs: upstream,
    createdBy: actorUserId,
  }))

  for (const kind of ['requirements', 'design'] as const) {
    em.persist(em.create(DeliveryDecision, {
      id: randomUUID(),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      projectId: project.id,
      kind,
      subjectType: 'baseline',
      subjectId: baseline.id,
      subjectHash: contentHash,
      verdict: 'approved',
      reason: null,
      actorUserId,
      decidedAt: now,
    }))
  }

  for (const task of EXAMPLE_TASKS) {
    em.persist(em.create(DeliveryTask, {
      id: randomUUID(),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      projectId: project.id,
      baselineId: baseline.id,
      title: task.title,
      description: task.description,
      acIds: [...task.acIds],
      dependsOnTaskIds: [],
      allowedPaths: [...task.allowedPaths],
      targetProfileId: project.targetProfileId,
      targetProfileVersion: project.targetProfileVersion,
      status: 'ready',
      statusReason: null,
      proposalTaskKey: task.key,
    }))
  }

  logger.info('seeded the example walkthrough', { projectId: project.id, baselineId: baseline.id, screens: allScreens.length })
  return { baselineId: baseline.id, taskCount: EXAMPLE_TASKS.length, screenCount: allScreens.length }
}
