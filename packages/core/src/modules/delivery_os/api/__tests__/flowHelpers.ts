import { POST as CREATE_PROJECT, PUT as UPDATE_PROJECT } from '../projects/route'
import { GET as PROJECT_DETAIL } from '../projects/[id]/route'
import { POST as CREATE_BASELINE } from '../projects/[id]/baselines/route'
import { POST as DECIDE } from '../baselines/[id]/decisions/route'
import { POST as CREATE_TASK } from '../projects/[id]/tasks/route'
import { PUT as UPDATE_TASK } from '../tasks/route'
import { POST as RESERVE } from '../tasks/[id]/attempts/route'
import { GET as PACKAGE } from '../tasks/[id]/package/route'
import { POST as IMPORT_RESULT } from '../tasks/[id]/results/route'
import { draftAttachmentRows, makeDraft, type Row } from '../../commands/__tests__/baselineTestKit'
import type { TaskPackageV1 } from '../../lib/contracts'
import { TARGET_PROFILES } from '../../lib/targetProfiles'
import { BASE_REVISION } from './attemptRouteKit'
import { apiRequest, readBody, routeParams, routeState } from './routeTestKit'

export type Json = Record<string, unknown>
export type Flow = { projectId: string; baselineId: string; contentHash: string; version: number; taskId: string }

export const flowDraft = makeDraft()
export const flowAcIds = (flowDraft.acceptanceCriteria as Array<{ id: string }>).map((criterion) => criterion.id)

export async function expectStatus(response: Response, status: number): Promise<Json> {
  const body = await readBody(response)
  if (response.status !== status) expect({ status: response.status, body }).toEqual({ status })
  return body
}

export async function createProject(extraBody: Json = {}): Promise<Json> {
  const body = { name: 'Customer portal', inputMode: 'from_brief', targetProfileId: TARGET_PROFILES[0].id, ...extraBody }
  return expectStatus(await CREATE_PROJECT(apiRequest('POST', '/projects', { body })), 201)
}

export async function readProject(projectId: string): Promise<Json> {
  return expectStatus(await PROJECT_DETAIL(apiRequest('GET', `/projects/${projectId}`), routeParams(projectId)), 200)
}

export async function projectVersion(projectId: string): Promise<string> {
  return (await readProject(projectId)).updatedAt as string
}

export function storedTask(taskId: string): Row {
  const task = routeState.store.tasks.find((row) => row.id === taskId)
  if (!task) throw new Error(`[internal] task ${taskId} is not in the route store`)
  return task
}

export function taskVersion(taskId: string): string {
  return (storedTask(taskId).updatedAt as Date).toISOString()
}

export function decide(
  flow: Pick<Flow, 'projectId' | 'baselineId' | 'contentHash' | 'version'>,
  kind: 'requirements' | 'design',
  options: { lock: string | null; subjectHash?: string },
): Promise<Response> {
  const body = { kind, verdict: 'approved', subjectHash: options.subjectHash ?? flow.contentHash, subjectVersion: flow.version }
  return DECIDE(
    apiRequest('POST', `/baselines/${flow.baselineId}/decisions`, { body, lock: options.lock }),
    routeParams(flow.baselineId),
  )
}

export async function freezeDraftBaseline(): Promise<Omit<Flow, 'taskId'>> {
  const created = await createProject()
  const projectId = created.id as string
  routeState.store.attachments.push(...draftAttachmentRows(flowDraft))
  await expectStatus(
    await UPDATE_PROJECT(apiRequest('PUT', '/projects', { body: { id: projectId, draftSpec: flowDraft }, lock: created.updatedAt as string })),
    200,
  )
  const baseline = await expectStatus(
    await CREATE_BASELINE(
      apiRequest('POST', `/projects/${projectId}/baselines`, { body: { source: 'manual' }, lock: await projectVersion(projectId) }),
      routeParams(projectId),
    ),
    201,
  )
  return {
    projectId,
    baselineId: baseline.baselineId as string,
    contentHash: baseline.contentHash as string,
    version: baseline.version as number,
  }
}

export async function prepareReadyTask(): Promise<Flow> {
  const frozen = await freezeDraftBaseline()
  for (const kind of ['requirements', 'design'] as const) {
    await expectStatus(await decide(frozen, kind, { lock: await projectVersion(frozen.projectId) }), 201)
  }
  const task = await expectStatus(
    await CREATE_TASK(
      apiRequest('POST', `/projects/${frozen.projectId}/tasks`, {
        body: { source: 'manual', baselineId: frozen.baselineId, title: 'Service list', acIds: [flowAcIds[0]] },
      }),
      routeParams(frozen.projectId),
    ),
    201,
  )
  const taskId = task.id as string
  await expectStatus(
    await UPDATE_TASK(apiRequest('PUT', '/tasks', { body: { id: taskId, status: 'ready' }, lock: task.updatedAt as string })),
    200,
  )
  return { ...frozen, taskId }
}

export function reserveOn(taskId: string, key: string, lock: string | null = taskVersion(taskId)): Promise<Response> {
  return RESERVE(
    apiRequest('POST', `/tasks/${taskId}/attempts`, {
      body: { mode: 'manual_handoff', baseRevision: BASE_REVISION },
      lock,
      headers: { 'Idempotency-Key': key },
    }),
    routeParams(taskId),
  )
}

export function getPackageOn(taskId: string, attemptId: string): Promise<Response> {
  return PACKAGE(apiRequest('GET', `/tasks/${taskId}/package?attemptId=${attemptId}`), routeParams(taskId))
}

export async function exportPackageOn(taskId: string, attemptId: string): Promise<TaskPackageV1> {
  return (await expectStatus(await getPackageOn(taskId, attemptId), 200)) as unknown as TaskPackageV1
}

export function importResult(taskId: string, body: unknown): Promise<Response> {
  return IMPORT_RESULT(apiRequest('POST', `/tasks/${taskId}/results`, { body }), routeParams(taskId))
}

export function useScopedProjectList(): void {
  routeState.queryEngine.query.mockImplementation(
    async (_entityId: string, options: { tenantId?: string; withDeleted?: boolean; filters?: Record<string, { $eq?: string }> }) => {
      const organizationId = options.filters?.organization_id?.$eq
      const items = routeState.store.projects
        .filter((row) => row.tenantId === options.tenantId && row.organizationId === organizationId)
        .filter((row) => options.withDeleted || !row.deletedAt)
        .map((row) => ({
          id: row.id,
          name: row.name,
          input_mode: row.inputMode,
          brief: row.brief ?? null,
          target_profile_id: row.targetProfileId,
          target_profile_version: row.targetProfileVersion,
          repository_ref: row.repositoryRef ?? null,
          active_baseline_id: row.activeBaselineId ?? null,
          created_at: row.createdAt,
          updated_at: row.updatedAt,
          deleted_at: row.deletedAt ?? null,
        }))
      return { items, total: items.length }
    },
  )
}
