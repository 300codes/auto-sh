/** @jest-environment node */

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback?: string) => fallback ?? _key }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => require('./routeTestKit').findMock)
jest.mock('@open-mercato/shared/lib/di/container', () => require('./routeTestKit').containerMock)
jest.mock('@open-mercato/shared/lib/auth/server', () => require('./routeTestKit').authServerMock)
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => require('./routeTestKit').organizationScopeMock)
jest.mock('../../events', () => ({ emitDeliveryOsEvent: jest.fn(async () => undefined) }))

import '@open-mercato/core/modules/delivery_os/commands'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import * as projectsRoute from '../projects/route'
import { GET as PROJECT_DETAIL } from '../projects/[id]/route'
import * as baselinesRoute from '../projects/[id]/baselines/route'
import * as projectTasksRoute from '../projects/[id]/tasks/route'
import * as tasksRoute from '../tasks/route'
import { GET as TASK_DETAIL } from '../tasks/[id]/route'
import { POST as RECONCILE } from '../tasks/[id]/attempts/[attemptId]/reconcile/route'
import { POST as RECORD_EVIDENCE } from '../projects/[id]/evidence/route'
import { POST as DEPLOY } from '../projects/[id]/deploy-decisions/route'
import { POST as RELEASE } from '../projects/[id]/release-decisions/route'
import { GET as REPORT } from '../projects/[id]/report/route'
import { FOREIGN_ORG_ID, STALE_UPDATED_AT, TENANT_ID, ORG_ID, makeDraft } from '../../commands/__tests__/baselineTestKit'
import { emitDeliveryOsEvent } from '../../events'
import type { ResultManifestV1, TaskPackageV1 } from '../../lib/contracts'
import { buildResultManifest } from '../../lib/fixtures/builders'
import { issueTrustedExecution } from '../../lib/trustedExecution'
import { findEnterpriseImports } from '../../__tests__/enterpriseBoundary'
import { BASE_REVISION, UNKNOWN_ATTEMPT_ID } from './attemptRouteKit'
import {
  createProject,
  decide,
  expectStatus,
  exportPackageOn,
  flowAcIds,
  freezeDraftBaseline,
  getPackageOn,
  importResult,
  prepareReadyTask,
  projectVersion,
  readProject,
  reserveOn,
  storedTask,
  taskVersion,
  useScopedProjectList,
  type Flow,
  type Json,
} from './flowHelpers'
import {
  FOREIGN_TENANT_ID,
  apiRequest,
  containerMock,
  expectFrozenError,
  resetRouteState,
  routeParams,
  routeState,
  signInAs,
} from './routeTestKit'

const EVIDENCE_EVENT = 'delivery_os.evidence.recorded'
const EXTERNAL_EVIDENCE = { note: 'Runner host restarted; no process for the attempt', observedAt: '2026-09-19T10:05:00.000Z' }
const FOREIGN_SESSIONS = [
  { label: 'tenant B / org A', tenantId: FOREIGN_TENANT_ID, orgId: ORG_ID },
  { label: 'tenant A / org B', tenantId: TENANT_ID, orgId: FOREIGN_ORG_ID },
  { label: 'tenant B / org B', tenantId: FOREIGN_TENANT_ID, orgId: FOREIGN_ORG_ID },
]

function rowCounts(): Record<string, number> {
  const { store } = routeState
  return {
    projects: store.projects.length,
    baselines: store.baselines.length,
    decisions: store.decisions.length,
    tasks: store.tasks.length,
    evidence: store.evidence.length,
  }
}

function evidenceEvents(): Json[] {
  return jest.mocked(emitDeliveryOsEvent).mock.calls.filter(([eventId]) => eventId === EVIDENCE_EVENT).map(([, payload]) => payload as Json)
}

function attemptsOf(taskId: string): Json[] {
  return storedTask(taskId).executionAttempts as Json[]
}

async function deliverManualResult(flow: Flow, key: string): Promise<{ attemptId: string; manifest: ResultManifestV1; accepted: Json }> {
  const reserved = await expectStatus(await reserveOn(flow.taskId, key), 201)
  const attemptId = reserved.attemptId as string
  const manifest = buildResultManifest(await exportPackageOn(flow.taskId, attemptId))
  const accepted = await expectStatus(await importResult(flow.taskId, { attemptId, manifest }), 201)
  return { attemptId, manifest, accepted }
}

async function commandContext(): Promise<CommandRuntimeContext> {
  return {
    container: (await containerMock.createRequestContainer()) as unknown as CommandRuntimeContext['container'],
    auth: routeState.auth,
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
  } as CommandRuntimeContext
}

async function runCommand(commandId: string, input: Json): Promise<Json> {
  const handler = commandRegistry.get(commandId)
  if (!handler) throw new Error(`[internal] command ${commandId} is not registered`)
  return (await handler.execute(input as never, (await commandContext()) as never)) as Json
}

function reconcile(taskId: string, attemptId: string, body: Json): Promise<Response> {
  return RECONCILE(
    apiRequest('POST', `/tasks/${taskId}/attempts/${attemptId}/reconcile`, { body, lock: taskVersion(taskId) }),
    { params: { id: taskId, attemptId } },
  )
}

beforeEach(() => {
  resetRouteState()
  useScopedProjectList()
  jest.mocked(emitDeliveryOsEvent).mockClear()
})

describe('6.2 cross-tenant: two tenants x two organizations', () => {
  it('answers 404 or an empty list on every route from a foreign scope and changes no row', async () => {
    const flow = await prepareReadyTask()
    const { attemptId, manifest, accepted } = await deliverManualResult(flow, 'cross-scope-key')
    const evidenceId = accepted.evidenceId as string
    const projectLock = await projectVersion(flow.projectId)
    const taskLock = taskVersion(flow.taskId)
    const before = rowCounts()

    for (const session of FOREIGN_SESSIONS) {
      signInAs({ tenantId: session.tenantId, orgId: session.orgId })
      const list = await expectStatus(await projectsRoute.GET(apiRequest('GET', '/projects')), 200)
      expect({ session: session.label, total: list.total, items: list.items }).toEqual({ session: session.label, total: 0, items: [] })

      const hidden: Array<[string, () => Promise<Response>]> = [
        ['R3 PUT project', () => projectsRoute.PUT(apiRequest('PUT', '/projects', { body: { id: flow.projectId, name: 'Hijacked' }, lock: null }))],
        ['R4 DELETE project', () => projectsRoute.DELETE(apiRequest('DELETE', `/projects?id=${flow.projectId}`, { lock: null }))],
        ['R5 project detail', () => PROJECT_DETAIL(apiRequest('GET', `/projects/${flow.projectId}`), routeParams(flow.projectId))],
        ['R6 baselines', () => baselinesRoute.GET(apiRequest('GET', `/projects/${flow.projectId}/baselines`), routeParams(flow.projectId))],
        ['R7 new baseline', () => baselinesRoute.POST(apiRequest('POST', `/projects/${flow.projectId}/baselines`, { body: { source: 'manual' }, lock: projectLock }), routeParams(flow.projectId))],
        ['R8 decision', () => decide(flow, 'design', { lock: projectLock })],
        ['R9 tasks', () => projectTasksRoute.GET(apiRequest('GET', `/projects/${flow.projectId}/tasks`), routeParams(flow.projectId))],
        ['R10 new task', () => projectTasksRoute.POST(apiRequest('POST', `/projects/${flow.projectId}/tasks`, { body: { source: 'manual', baselineId: flow.baselineId, title: 'Foreign', acIds: [flowAcIds[0]] } }), routeParams(flow.projectId))],
        ['R11 task detail', () => TASK_DETAIL(apiRequest('GET', `/tasks/${flow.taskId}`), routeParams(flow.taskId))],
        ['R12 PUT task', () => tasksRoute.PUT(apiRequest('PUT', '/tasks', { body: { id: flow.taskId, title: 'Hijacked' }, lock: null }))],
        ['R13 DELETE task', () => tasksRoute.DELETE(apiRequest('DELETE', `/tasks?id=${flow.taskId}`, { lock: null }))],
        ['R14 reserve', () => reserveOn(flow.taskId, 'foreign-key', taskLock)],
        ['R15 package', () => getPackageOn(flow.taskId, attemptId)],
        ['R16 result', () => importResult(flow.taskId, { attemptId, manifest })],
        ['R19 evidence', () => RECORD_EVIDENCE(apiRequest('POST', `/projects/${flow.projectId}/evidence`, { body: { baselineId: flow.baselineId, kind: 'scan', sourceRevision: manifest.resultRevision, payload: { checkId: 'dependency-audit', scanner: 'npm audit', status: 'passed', rawReportHash: 'd'.repeat(64) } } }), routeParams(flow.projectId))],
        ['R20 deploy', () => DEPLOY(apiRequest('POST', `/projects/${flow.projectId}/deploy-decisions`, { body: { baselineId: flow.baselineId, sourceRevision: manifest.resultRevision, verdict: 'approved' }, lock: projectLock }), routeParams(flow.projectId))],
        ['R21 release', () => RELEASE(apiRequest('POST', `/projects/${flow.projectId}/release-decisions`, { body: { deploymentEvidenceId: evidenceId, verdict: 'approved' }, lock: projectLock }), routeParams(flow.projectId))],
        ['R22 report', () => REPORT(apiRequest('GET', `/projects/${flow.projectId}/report`), routeParams(flow.projectId))],
      ]
      for (const [route, call] of hidden) {
        const response = await call()
        expect({ session: session.label, route, status: response.status }).toEqual({ session: session.label, route, status: 404 })
      }

      const neverExisted = await projectsRoute.PUT(apiRequest('PUT', '/projects', { body: { id: UNKNOWN_ATTEMPT_ID, name: 'Hijacked' }, lock: projectLock }))
      const foreign = await projectsRoute.PUT(apiRequest('PUT', '/projects', { body: { id: flow.projectId, name: 'Hijacked' }, lock: projectLock }))
      expect([foreign.status, await foreign.json()]).toEqual([neverExisted.status, await neverExisted.json()])
    }

    signInAs({})
    expect(rowCounts()).toEqual(before)
    expect(routeState.store.projects[0]).toMatchObject({ name: 'Customer portal', deletedAt: null })
    expect(storedTask(flow.taskId)).toMatchObject({ title: 'Service list', status: 'awaiting_review', deletedAt: null })
    expect(attemptsOf(flow.taskId)).toHaveLength(1)
    const own = await expectStatus(await projectsRoute.GET(apiRequest('GET', '/projects')), 200)
    expect((own.items as Json[]).map((item) => item.id)).toEqual([flow.projectId])
  })

  it('ignores tenant and organization values sent in a body or inside a manifest', async () => {
    const created = await createProject({ tenantId: FOREIGN_TENANT_ID, organizationId: FOREIGN_ORG_ID })
    expect(routeState.store.projects.find((row) => row.id === created.id)).toMatchObject({ tenantId: TENANT_ID, organizationId: ORG_ID })

    const flow = await prepareReadyTask()
    const reserved = await expectStatus(await reserveOn(flow.taskId, 'scoped-key'), 201)
    const attemptId = reserved.attemptId as string
    const manifest = { ...buildResultManifest(await exportPackageOn(flow.taskId, attemptId)), tenantId: FOREIGN_TENANT_ID, organizationId: FOREIGN_ORG_ID }
    const body = { attemptId, manifest, tenantId: FOREIGN_TENANT_ID, organizationId: FOREIGN_ORG_ID }
    await expectStatus(await importResult(flow.taskId, body), 201)
    expect(routeState.store.evidence).toHaveLength(1)
    expect(routeState.store.evidence[0]).toMatchObject({ tenantId: TENANT_ID, organizationId: ORG_ID, taskId: flow.taskId })
    expect(evidenceEvents()[0]).toMatchObject({ tenantId: TENANT_ID, organizationId: ORG_ID })

    signInAs({ tenantId: FOREIGN_TENANT_ID, orgId: FOREIGN_ORG_ID })
    expect((await expectStatus(await projectsRoute.GET(apiRequest('GET', '/projects')), 200)).total).toBe(0)
  })
})

describe('6.2 stale approval', () => {
  it('answers 409 for an outdated lock header and for an outdated subjectHash, and records no decision', async () => {
    const v1 = await freezeDraftBaseline()
    await expectStatus(await decide(v1, 'requirements', { lock: await projectVersion(v1.projectId) }), 201)
    const stale = await decide(v1, 'design', { lock: STALE_UPDATED_AT })
    expect([stale.status, (await stale.json()).code]).toEqual([409, 'optimistic_lock_conflict'])
    expect(routeState.store.decisions).toHaveLength(1)

    const changedDraft = makeDraft({ architectureSummary: 'Scope change: the service list also shows opening hours.' })
    await expectStatus(
      await projectsRoute.PUT(apiRequest('PUT', '/projects', { body: { id: v1.projectId, draftSpec: changedDraft }, lock: await projectVersion(v1.projectId) })),
      200,
    )
    const v2 = await expectStatus(
      await baselinesRoute.POST(
        apiRequest('POST', `/projects/${v1.projectId}/baselines`, { body: { source: 'manual' }, lock: await projectVersion(v1.projectId) }),
        routeParams(v1.projectId),
      ),
      201,
    )
    expect(v2.contentHash).not.toBe(v1.contentHash)
    const v2Flow = { ...v1, baselineId: v2.baselineId as string, version: v2.version as number, contentHash: v2.contentHash as string }
    const decisionsBefore = routeState.store.decisions.length
    await expectFrozenError(
      await decide(v2Flow, 'requirements', { lock: await projectVersion(v1.projectId), subjectHash: v1.contentHash }),
      409,
      'subject_hash_mismatch',
    )
    expect(routeState.store.decisions).toHaveLength(decisionsBefore)
    expect((await readProject(v1.projectId)).activeBaselineId).toBeNull()
  })
})

describe('6.2 duplicate callback', () => {
  it('keeps one evidence row, answers duplicate and re-emits the event with completionDelivery pending; another manifest is 409', async () => {
    const flow = await prepareReadyTask()
    const trustedExecution = issueTrustedExecution(routeState.auth?.sub as string)
    const reservation = await runCommand('delivery_os.attempts.reserve', {
      taskId: flow.taskId, idempotencyKey: `delivery-agents:${flow.taskId}:1`, mode: 'automatic', baseRevision: BASE_REVISION, trustedExecution,
    })
    const ids = { taskId: flow.taskId, attemptId: reservation.attemptId as string }
    await runCommand('delivery_os.attempts.claim', { ...ids, workerRef: 'delivery-agents-worker-1', trustedExecution })
    await runCommand('delivery_os.attempts.link_workflow', { ...ids, workflowRef: 'wf-instance-7', workflowStepId: 'wait-for-result', dispatched: true, trustedExecution })
    const manifest = buildResultManifest(await exportPackageOn(flow.taskId, ids.attemptId))

    const first = await expectStatus(await importResult(flow.taskId, { attemptId: ids.attemptId, manifest }), 201)
    const replay = await expectStatus(await importResult(flow.taskId, { attemptId: ids.attemptId, manifest }), 200)
    expect(first).toMatchObject({ duplicate: false, taskStatus: 'awaiting_review' })
    expect(replay).toMatchObject({ duplicate: true, evidenceId: first.evidenceId })
    expect(routeState.store.evidence).toHaveLength(1)
    expect(evidenceEvents()).toEqual([
      expect.objectContaining({ evidenceId: first.evidenceId, duplicate: false, completionDelivery: 'pending' }),
      expect.objectContaining({ evidenceId: first.evidenceId, duplicate: true, completionDelivery: 'pending' }),
    ])

    const other = { ...manifest, externalRunId: 'another-run' }
    await expectFrozenError(await importResult(flow.taskId, { attemptId: ids.attemptId, manifest: other }), 409, 'result_conflict')
    expect(routeState.store.evidence).toHaveLength(1)
    expect(attemptsOf(flow.taskId)).toHaveLength(1)
  })
})

describe('6.2 restart with an unknown attempt', () => {
  it('blocks reserve and archive after reconcile unknown and never starts the executor again', async () => {
    const flow = await prepareReadyTask()
    const executor = jest.fn((_taskPackage: TaskPackageV1) => {
      throw new Error('[internal] worker process killed')
    })
    const runIfReserved = async (response: Response): Promise<number> => {
      const body = await expectStatus(response, response.status)
      if (response.status === 201) {
        const taskPackage = await exportPackageOn(flow.taskId, body.attemptId as string)
        expect(() => executor(taskPackage)).toThrow('worker process killed')
      }
      return response.status
    }

    expect(await runIfReserved(await reserveOn(flow.taskId, 'restart-key'))).toBe(201)
    expect(executor).toHaveBeenCalledTimes(1)
    const attemptId = attemptsOf(flow.taskId)[0].attemptId as string

    const reconciled = await expectStatus(await reconcile(flow.taskId, attemptId, { resolution: 'unknown', externalEvidence: EXTERNAL_EVIDENCE }), 200)
    expect(reconciled).toMatchObject({ resolution: 'unknown', taskStatus: 'blocked' })

    await expectFrozenError(await reserveOn(flow.taskId, 'restart-key-2'), 409, 'reconciliation_required')
    const replayed = await reserveOn(flow.taskId, 'restart-key')
    expect((await replayed.clone().json()).attemptId).toBe(attemptId)
    expect(await runIfReserved(replayed)).toBe(200)
    const archiveTask = await tasksRoute.DELETE(apiRequest('DELETE', `/tasks?id=${flow.taskId}`, { lock: taskVersion(flow.taskId) }))
    await expectFrozenError(archiveTask, 409, 'reconciliation_required')
    const archiveProject = await projectsRoute.DELETE(apiRequest('DELETE', `/projects?id=${flow.projectId}`, { lock: await projectVersion(flow.projectId) }))
    await expectFrozenError(archiveProject, 409, 'reconciliation_required')

    expect(executor).toHaveBeenCalledTimes(1)
    expect(attemptsOf(flow.taskId)).toHaveLength(1)
    expect(storedTask(flow.taskId)).toMatchObject({ status: 'blocked', statusReason: 'reconciliation_required', deletedAt: null })
    expect(routeState.store.projects[0].deletedAt).toBeNull()
    expect(routeState.store.evidence).toHaveLength(0)
  })
})

describe('6.2 manual_handoff with enterprise modules disabled', () => {
  const ENTERPRISE_FLAGS = ['OM_ENABLE_ENTERPRISE_MODULES', 'OM_ENABLE_ENTERPRISE_MODULES_SSO', 'OM_ENABLE_ENTERPRISE_MODULES_SECURITY', 'OM_ENABLE_ENTERPRISE_MODULES_AGENTS']

  it('registers delivery_os from core and no enterprise module when the enterprise flags are off', () => {
    const saved = ENTERPRISE_FLAGS.map((flag) => [flag, process.env[flag]] as const)
    for (const flag of ENTERPRISE_FLAGS) delete process.env[flag]
    try {
      jest.isolateModules(() => {
        const { enabledModules } = require('../../../../../../../apps/mercato/src/modules') as { enabledModules: Array<{ id: string; from?: string }> }
        expect(enabledModules).toContainEqual(expect.objectContaining({ id: 'delivery_os', from: '@open-mercato/core' }))
        expect(enabledModules.filter((entry) => entry.from === '@open-mercato/enterprise')).toEqual([])
        expect(enabledModules.map((entry) => entry.id)).not.toContain('agent_orchestrator')
      })
    } finally {
      for (const [flag, value] of saved) if (value !== undefined) process.env[flag] = value
    }
    expect(findEnterpriseImports([require.resolve('../../__tests__/module-registration.test.ts')])).toEqual([])
  })

  it('completes project → decisions → ready → reserve → package → result → progress without enterprise', async () => {
    const flow = await prepareReadyTask()
    expect((await readProject(flow.projectId)).activeBaselineId).toBe(flow.baselineId)
    const { attemptId, accepted } = await deliverManualResult(flow, 'manual-key')
    expect(accepted).toMatchObject({ duplicate: false, taskStatus: 'awaiting_review' })
    expect(attemptsOf(flow.taskId)[0]).toMatchObject({ attemptId, mode: 'manual_handoff' })
    expect(routeState.store.evidence).toHaveLength(1)
    expect(routeState.store.evidence[0]).toMatchObject({ source: 'manual', attemptId, baselineId: flow.baselineId })
    expect(routeState.store.decisions.map((decision) => decision.kind)).toEqual(['requirements', 'design'])
    await expectFrozenError(await getPackageOn(flow.taskId, UNKNOWN_ATTEMPT_ID), 404, 'attempt_not_found')
    const detail = await readProject(flow.projectId)
    expect(detail.status).toBe('in_progress')
    expect(detail.progress).toMatchObject({ proven: 0, total: flowAcIds.length, unit: 'ac' })
  })
})
