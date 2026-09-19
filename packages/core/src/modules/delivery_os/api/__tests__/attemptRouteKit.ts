import { POST as RESERVE } from '../tasks/[id]/attempts/route'
import { GET as PACKAGE } from '../tasks/[id]/package/route'
import { BASELINE_ID, UPDATED_AT, makeBaseline, makeProject, type Row } from '../../commands/__tests__/baselineTestKit'
import type { TaskPackageV1 } from '../../lib/contracts'
import { TASK_ID, apiRequest, makeTaskRow, readBody, routeParams, routeState } from './routeTestKit'

export const IDEMPOTENCY_KEY = 'reserve-key-001'
export const BASE_REVISION = { kind: 'git', commitSha: '687670c20c93d6a60c2ab494419ec38636cf0a8c' }
export const RESERVE_BODY = { mode: 'manual_handoff', baseRevision: BASE_REVISION }
export const UNKNOWN_ATTEMPT_ID = '3d3d3d3d-3333-4333-8333-333333333333'

export function seedReadyTask(overrides: Row = {}): Row {
  const task = makeTaskRow({ status: 'ready', baselineId: BASELINE_ID, ...overrides })
  routeState.store.projects.push(makeProject({ activeBaselineId: BASELINE_ID }) as unknown as Row)
  routeState.store.baselines.push(makeBaseline() as unknown as Row)
  routeState.store.tasks.push(task)
  return task
}

export function reserve(
  options: { key?: string | null; body?: unknown; lock?: string | Date | null; taskId?: string } = {},
): Promise<Response> {
  const key = options.key === undefined ? IDEMPOTENCY_KEY : options.key
  const taskId = options.taskId ?? TASK_ID
  return RESERVE(
    apiRequest('POST', `/tasks/${taskId}/attempts`, {
      body: options.body ?? RESERVE_BODY,
      lock: options.lock === undefined ? UPDATED_AT : options.lock,
      headers: key === null ? {} : { 'Idempotency-Key': key },
    }),
    routeParams(taskId),
  )
}

export async function reserveAttemptId(): Promise<string> {
  const response = await reserve()
  if (response.status !== 201) throw new Error(`[internal] fixture reservation answered ${response.status}`)
  return (await readBody(response)).attemptId as string
}

export function getPackage(attemptId: string | null, taskId: string = TASK_ID): Promise<Response> {
  const query = attemptId === null ? '' : `?attemptId=${attemptId}`
  return PACKAGE(apiRequest('GET', `/tasks/${taskId}/package${query}`), routeParams(taskId))
}

export async function exportPackage(attemptId: string): Promise<TaskPackageV1> {
  const response = await getPackage(attemptId)
  if (response.status !== 200) throw new Error(`[internal] fixture package export answered ${response.status}`)
  return (await response.json()) as TaskPackageV1
}
