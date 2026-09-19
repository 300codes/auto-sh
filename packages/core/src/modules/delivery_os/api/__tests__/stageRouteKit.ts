import { GET as LIST_ARTIFACTS, POST as CREATE_ARTIFACT } from '../projects/[id]/stages/[stageId]/artifacts/route'
import { GET as LIST_DECISIONS, POST as DECIDE_STAGE } from '../projects/[id]/stages/[stageId]/decisions/route'
import { POST as PIN } from '../projects/[id]/flow/pin/route'
import type { FlowStageId, StageArtifactV1, StageDecisionRequest } from '../../lib/contracts'
import { loadStageArtifactFixture } from '../../lib/fixtures/flow/index'
import { DEFAULT_FLOW_TEMPLATE } from '../../lib/flowTemplates'
import { createProject, expectStatus, projectVersion, type Json } from './flowHelpers'
import { apiRequest, routeParams } from './routeTestKit'

export type ArtifactRef = { artifactId: string; version: number; contentHash: string }

export function stageParams(projectId: string, stageId: string): { params: Record<string, unknown> } {
  return { params: { id: projectId, stageId } }
}

export async function createPinnedProject(): Promise<string> {
  const projectId = (await createProject({ targetProfileId: 'wordpress-theme' })).id as string
  const body = { templateId: DEFAULT_FLOW_TEMPLATE.templateId, templateVersion: DEFAULT_FLOW_TEMPLATE.version }
  await expectStatus(
    await PIN(apiRequest('POST', `/projects/${projectId}/flow/pin`, { body, lock: await projectVersion(projectId) }), routeParams(projectId)),
    201,
  )
  return projectId
}

export function scopeArtifact(projectId: string, summary?: string): StageArtifactV1 {
  const fixture = loadStageArtifactFixture('scope')
  if (fixture.stageId !== 'scope') throw new Error('[internal] scope fixture expected')
  return { ...fixture, projectId, source: 'manual', content: { ...fixture.content, summary: summary ?? fixture.content.summary } }
}

export function designArtifact(
  projectId: string,
  stageId: Exclude<FlowStageId, 'scope'>,
  dependsOn: Array<ArtifactRef & { stageId: FlowStageId }>,
  source: StageArtifactV1['source'] = 'manual',
): StageArtifactV1 {
  return {
    schemaVersion: 'delivery.stage-artifact/v1',
    projectId,
    stageId,
    source,
    dependsOn,
    attachments: [],
    producedBy: null,
    content: { summary: `${stageId} package`, figmaRefs: [], screens: [], notes: null, resolvedThreadKeys: [] },
  } as StageArtifactV1
}

export function postArtifact(projectId: string, stageId: string, body: unknown, lock: string | null): Promise<Response> {
  return CREATE_ARTIFACT(apiRequest('POST', `/projects/${projectId}/stages/${stageId}/artifacts`, { body, lock }), stageParams(projectId, stageId))
}

export async function recordArtifact(projectId: string, artifact: StageArtifactV1): Promise<ArtifactRef> {
  const created = await expectStatus(await postArtifact(projectId, artifact.stageId, artifact, await projectVersion(projectId)), 201)
  return { artifactId: created.artifactId as string, version: created.version as number, contentHash: created.contentHash as string }
}

export function approvalFor(ref: ArtifactRef, overrides: Partial<StageDecisionRequest> = {}): StageDecisionRequest {
  return { artifactId: ref.artifactId, subjectHash: ref.contentHash, subjectVersion: ref.version, verdict: 'approved', ...overrides }
}

export function postDecision(
  projectId: string,
  stageId: string,
  body: unknown,
  options: { key: string | null; lock: string | null },
): Promise<Response> {
  const headers: Record<string, string> = options.key === null ? {} : { 'Idempotency-Key': options.key }
  return DECIDE_STAGE(
    apiRequest('POST', `/projects/${projectId}/stages/${stageId}/decisions`, { body, lock: options.lock, headers }),
    stageParams(projectId, stageId),
  )
}

export async function approveStage(projectId: string, stageId: FlowStageId, ref: ArtifactRef, key: string, extra: Partial<StageDecisionRequest> = {}): Promise<Json> {
  return expectStatus(await postDecision(projectId, stageId, approvalFor(ref, extra), { key, lock: await projectVersion(projectId) }), 201)
}

export function listArtifacts(projectId: string, stageId: string, query = ''): Promise<Response> {
  return LIST_ARTIFACTS(apiRequest('GET', `/projects/${projectId}/stages/${stageId}/artifacts${query}`), stageParams(projectId, stageId))
}

export function listDecisions(projectId: string, stageId: string, query = ''): Promise<Response> {
  return LIST_DECISIONS(apiRequest('GET', `/projects/${projectId}/stages/${stageId}/decisions${query}`), stageParams(projectId, stageId))
}
