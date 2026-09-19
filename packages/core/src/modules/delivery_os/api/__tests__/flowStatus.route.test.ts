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
import { GET, metadata, openApi } from '../projects/[id]/flow/route'
import { POST as PIN } from '../projects/[id]/flow/pin/route'
import { POST as DEPLOY } from '../projects/[id]/deploy-decisions/route'
import { PUT as PUT_INTAKE } from '../projects/[id]/intake/route'
import { PUT as UPDATE_TASK } from '../tasks/route'
import {
  BASELINE_ID,
  FOREIGN_ORG_ID,
  ORG_ID,
  PROJECT_ID,
  TENANT_ID,
  UPDATED_AT,
  catchHttpError,
  expectFrozenBody,
  makeApproval,
  type Row,
} from '../../commands/__tests__/baselineTestKit'
import { createDeliveryOsFlowQueries } from '../../commands/flowQueries'
import { createDeliveryOsReportQueries } from '../../commands/reportQueries'
import {
  FLOW_APPROVAL_STAGE_ORDER,
  FLOW_GATE_DETAIL_CODES,
  flowStatusV1Schema,
  type FlowStageId,
  type FlowStatusV1,
  type SourceRevision,
} from '../../lib/contracts'
import { hashFlowTemplate } from '../../lib/flowRules'
import { DEFAULT_FLOW_TEMPLATE } from '../../lib/flowTemplates'
import { loadIntakeFixture } from '../../lib/fixtures/flow/index'
import { reserve, seedReadyTask } from './attemptRouteKit'
import { createProject, expectStatus, prepareReadyTask, projectVersion, reserveOn, type Json } from './flowHelpers'
import {
  EM_WRITE_METHODS,
  FOREIGN_TENANT_ID,
  VIEW_ONLY,
  apiRequest,
  em,
  isAllowedBy,
  makeTaskRow,
  readBody,
  resetRouteState,
  routeParams,
  routeState,
  signInAs,
} from './routeTestKit'

const SCOPE_HASH = 'a'.repeat(64)
const TEMPLATE_HASH = hashFlowTemplate(DEFAULT_FLOW_TEMPLATE)
const CLIENT_STAGES: readonly FlowStageId[] = ['key_visual', 'design_system_ui']
const QUERY_SCOPE = { tenantId: TENANT_ID, organizationId: ORG_ID }

function getFlow(projectId: string): Promise<Response> {
  return GET(apiRequest('GET', `/projects/${projectId}/flow`), routeParams(projectId))
}

async function readFlow(projectId: string): Promise<FlowStatusV1> {
  return flowStatusV1Schema.parse(await expectStatus(await getFlow(projectId), 200))
}

async function pin(projectId: string): Promise<void> {
  const body = { templateId: DEFAULT_FLOW_TEMPLATE.templateId, templateVersion: DEFAULT_FLOW_TEMPLATE.version }
  await expectStatus(await PIN(apiRequest('POST', `/projects/${projectId}/flow/pin`, { body, lock: await projectVersion(projectId) }), routeParams(projectId)), 201)
}

function seedScopeArtifact(projectId: string): string {
  const id = 'abababab-abab-4bab-8bab-abababababab'
  routeState.store.stageArtifacts.push({
    id,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    projectId,
    stageId: 'scope',
    version: 1,
    contentHash: SCOPE_HASH,
    dependsOn: [],
    createdAt: new Date('2026-09-19T12:00:00.000Z'),
  })
  return id
}

function pinStoredProject(): void {
  Object.assign(routeState.store.projects[0], {
    flowTemplateId: DEFAULT_FLOW_TEMPLATE.templateId,
    flowTemplateVersion: DEFAULT_FLOW_TEMPLATE.version,
    flowTemplateHash: TEMPLATE_HASH,
    flowTemplateSnapshot: DEFAULT_FLOW_TEMPLATE,
  })
}

function stageRowId(prefix: string, index: number): string {
  return `${prefix.repeat(8)}-${prefix.repeat(4)}-4${prefix.repeat(3)}-8${prefix.repeat(3)}-${prefix.repeat(11)}${index}`
}

function stageHash(index: number): string {
  return String(index).repeat(64)
}

function seedApprovedStages(): void {
  FLOW_APPROVAL_STAGE_ORDER.forEach((stageId, index) => {
    const artifactId = stageRowId('a', index)
    const upstreamStageId = FLOW_APPROVAL_STAGE_ORDER[index - 1]
    routeState.store.stageArtifacts.push({
      id: artifactId,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      stageId,
      version: 1,
      contentHash: stageHash(index + 1),
      dependsOn: upstreamStageId ? [{ stageId: upstreamStageId, artifactId: stageRowId('a', index - 1), version: 1, contentHash: stageHash(index) }] : [],
      createdAt: new Date(`2026-09-19T12:0${index}:00.000Z`),
    })
    routeState.store.stageDecisions.push({
      id: stageRowId('d', index),
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      stageId,
      artifactId,
      subjectHash: stageHash(index + 1),
      verdict: 'approved',
      decidedAt: new Date(`2026-09-19T12:1${index}:00.000Z`),
      clientApproverName: CLIENT_STAGES.includes(stageId) ? 'Client Owner' : null,
    })
  })
}

function seedApprovedProjectWithCorruptTemplateRef(): void {
  seedReadyTask()
  pinStoredProject()
  seedApprovedStages()
  routeState.store.projects[0].flowTemplateHash = ''
}

function expectNoWrites(): void {
  for (const method of EM_WRITE_METHODS) expect(em[method]).not.toHaveBeenCalled()
}

beforeEach(() => {
  resetRouteState()
})

describe('GET /projects/:id/flow (F6)', () => {
  it('requires projects.view and documents GET only', () => {
    expect(isAllowedBy(metadata, 'GET', VIEW_ONLY)).toBe(true)
    expect(isAllowedBy(metadata, 'GET', [])).toBe(false)
    expect(Object.keys(openApi.methods)).toEqual(['GET'])
  })

  it('answers a legacy project with template null, open gates and the informational blocker, without writing', async () => {
    const created = await createProject()
    const projectId = created.id as string
    for (const method of EM_WRITE_METHODS) em[method].mockClear()
    const status = await readFlow(projectId)
    expect(status).toMatchObject({
      projectId,
      template: null,
      intakeStep: null,
      currentStageId: null,
      stages: [],
      pendingApprovals: [],
      gates: { dispatchable: { ok: true, blocking: [] }, publishable: { ok: true, blocking: [] } },
      nextAction: { kind: 'none', stageId: null },
    })
    expect(status.blockers.map((blocker) => blocker.kind)).toEqual(['template_not_pinned'])
    expectNoWrites()
  })

  it('asks a legacy project with an intake draft to pin a template', async () => {
    const created = await createProject({ targetProfileId: 'wordpress-theme' })
    const projectId = created.id as string
    const { projectId: _projectId, proposals: _proposals, ...draft } = loadIntakeFixture()
    const intake = { ...draft, step: 'scoping', brief: { ...draft.brief, materials: [] } }
    const lock = (routeState.store.projects[0].createdAt as Date).toISOString()
    await expectStatus(await PUT_INTAKE(apiRequest('PUT', `/projects/${projectId}/intake`, { body: intake, lock }), routeParams(projectId)), 200)
    const status = await readFlow(projectId)
    expect(status.intakeStep).toBe('scoping')
    expect(status.nextAction).toEqual({ kind: 'pin_template', stageId: null })
    expect(status.gates.dispatchable.ok).toBe(true)
  })

  it('lists a readable active attempt as a blocker', async () => {
    const flow = await prepareReadyTask()
    await expectStatus(await reserveOn(flow.taskId, 'flow-status-key'), 201)
    const status = await readFlow(flow.projectId)
    expect(status.blockers.map((blocker) => blocker.kind)).toEqual(['template_not_pinned', 'attempt_active'])
  })

  it('derives a pinned project: four missing stages close both gates, a new Scope artifact becomes the pending approval', async () => {
    const created = await createProject({ targetProfileId: 'wordpress-theme' })
    const projectId = created.id as string
    await pin(projectId)
    const empty = await readFlow(projectId)
    expect(empty.template).toMatchObject({ templateId: DEFAULT_FLOW_TEMPLATE.templateId, version: DEFAULT_FLOW_TEMPLATE.version })
    expect(empty.stages.filter((stage) => stage.currency !== null).map((stage) => stage.currency)).toEqual(['missing', 'missing', 'missing', 'missing'])
    expect(empty.gates.dispatchable.ok).toBe(false)
    expect(empty.gates.publishable.ok).toBe(false)
    expect(empty.nextAction).toEqual({ kind: 'create_artifact', stageId: 'scope' })

    const artifactId = seedScopeArtifact(projectId)
    const pending = await readFlow(projectId)
    expect(pending.pendingApprovals).toEqual([expect.objectContaining({ stageId: 'scope', artifactId, contentHash: SCOPE_HASH, version: 1 })])
    expect(pending.nextAction).toEqual({ kind: 'approve_stage', stageId: 'scope' })
    const versions = ['2026-09-19T12:00:00.000Z', (routeState.store.projects[0].updatedAt as Date).toISOString()].sort()
    expect(pending.updatedAt).toBe(versions[1])
  })

  it('fails closed when the pinned snapshot no longer parses', async () => {
    const created = await createProject({ targetProfileId: 'wordpress-theme' })
    const projectId = created.id as string
    await pin(projectId)
    routeState.store.projects[0].flowTemplateSnapshot = { broken: true }
    const status = await readFlow(projectId)
    expect(status.template).not.toBeNull()
    expect(status.gates.dispatchable.ok).toBe(false)
    expect(status.gates.publishable.blocking.map((blocker) => blocker.stageId)).toEqual([...FLOW_APPROVAL_STAGE_ORDER])
    expect(status.nextAction.kind).toBe('none')
  })

  it('fails closed like the F15 report when the snapshot parses but the pinned template ref is corrupt', async () => {
    seedReadyTask()
    pinStoredProject()
    seedApprovedStages()
    const intact = await readFlow(PROJECT_ID)
    expect(intact.gates.dispatchable.ok).toBe(true)
    expect(intact.gates.publishable.ok).toBe(true)

    routeState.store.projects[0].flowTemplateHash = ''
    const status = await readFlow(PROJECT_ID)
    expect(status.template).toBeNull()
    expect(status.gates.dispatchable.ok).toBe(false)
    expect(status.gates.publishable.ok).toBe(false)
    expect(status.gates.publishable.blocking.map((blocker) => blocker.stageId)).toEqual([...FLOW_APPROVAL_STAGE_ORDER])
    expect(status.nextAction.kind).toBe('none')
  })

  it('reads the corrupt-ref project through the DI flow status and the F15 report without writing', async () => {
    seedApprovedProjectWithCorruptTemplateRef()
    const before = structuredClone(routeState.store)
    for (const method of EM_WRITE_METHODS) em[method].mockClear()
    const status = await createDeliveryOsFlowQueries(em as never).flowStatus(PROJECT_ID, QUERY_SCOPE)
    const reportError = await catchHttpError(() => createDeliveryOsReportQueries(em as never).buildReport(QUERY_SCOPE, PROJECT_ID))
    expect(status.gates.dispatchable.ok).toBe(false)
    expect(status.gates.publishable.ok).toBe(false)
    expect({ status: reportError.status, code: reportError.body.code }).toEqual({ status: 422, code: 'flow_template_hash_mismatch' })
    expectNoWrites()
    expect(routeState.writes).toBe(0)
    expect(routeState.store).toEqual(before)
  })

  it('hides a project of another organization from the DI flow status behind 404', async () => {
    seedReadyTask()
    pinStoredProject()
    const error = await catchHttpError(() =>
      createDeliveryOsFlowQueries(em as never).flowStatus(PROJECT_ID, { tenantId: TENANT_ID, organizationId: FOREIGN_ORG_ID }),
    )
    expectFrozenBody(error, 404, 'not_found')
  })

  it('keeps an archived project readable', async () => {
    const created = await createProject()
    routeState.store.projects[0].deletedAt = new Date()
    expect((await readFlow(created.id as string)).template).toBeNull()
  })

  it.each([
    ['tenant', { tenantId: FOREIGN_TENANT_ID }],
    ['organization', { orgId: FOREIGN_ORG_ID }],
  ])('hides a project of another %s behind 404', async (_label, foreign) => {
    const created = await createProject()
    signInAs(foreign)
    const response = await getFlow(created.id as string)
    const body: Json = await readBody(response)
    expect({ status: response.status, code: body.code }).toEqual({ status: 404, code: 'not_found' })
  })

  it('answers the DI service with the same document as the route', async () => {
    const created = await createProject({ targetProfileId: 'wordpress-theme' })
    const projectId = created.id as string
    await pin(projectId)
    const viaRoute = await readFlow(projectId)
    const viaDi = await createDeliveryOsFlowQueries(em as never).flowStatus(projectId, { tenantId: TENANT_ID, organizationId: ORG_ID })
    expect(viaDi).toEqual(viaRoute)
    await expect(createDeliveryOsFlowQueries(em as never).flowStatus(projectId, { tenantId: '', organizationId: ORG_ID })).rejects.toThrow('[internal]')
  })
})

const DRAFT_TASK_ID = '7c7c7c7c-7777-4777-8777-777777777778'
const REVISION: SourceRevision = { kind: 'git', commitSha: '687670c20c93d6a60c2ab494419ec38636cf0a8c' }
const RAW_HASH = 'd'.repeat(64)
const STAGE_DETAIL_PATH = /^stages\.(scope|ux|key_visual|design_system_ui)$/

function evidenceRow(kind: string, payload: unknown, sequence: number): Row {
  return {
    id: `eeeeeeee-eeee-4eee-8eee-${String(sequence).padStart(12, '0')}`,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    baselineId: BASELINE_ID,
    taskId: null,
    kind,
    sourceRevision: REVISION,
    payload,
    rawReportHash: RAW_HASH,
    createdAt: new Date(Date.UTC(2026, 8, 19, 10, 0, sequence)),
  }
}

function seedGreenEvidence(): void {
  const content = routeState.store.baselines[0].content as { acTestMap: Record<string, string[]> }
  const check = (acId: string) => ({
    checkId: 'unit-tests',
    testId: content.acTestMap[acId][0],
    status: 'passed',
    sourceRevision: REVISION,
    acIds: [],
    rawReportHash: RAW_HASH,
  })
  routeState.store.evidence.push(
    evidenceRow('test', { rawReportHash: RAW_HASH, checks: [check('AC-001'), check('AC-002')] }, 1),
    evidenceRow('scan', { checkId: 'dependency-audit', scanner: 'npm audit', status: 'passed', rawReportHash: RAW_HASH }, 2),
  )
}

function seedPinnedProjectWithClosedGate(): void {
  seedReadyTask()
  pinStoredProject()
  const baseline = routeState.store.baselines[0]
  routeState.store.decisions.push(
    makeApproval(baseline as never, 'requirements') as unknown as Row,
    makeApproval(baseline as never, 'design') as unknown as Row,
  )
  routeState.store.tasks.push(makeTaskRow({ id: DRAFT_TASK_ID, baselineId: BASELINE_ID }))
  seedGreenEvidence()
}

async function expectFlowGateRefusal(response: Response): Promise<void> {
  const body = await expectStatus(response, 422)
  expect(body.code).toBe('baseline_not_approved')
  const details = body.details as Array<{ path: string; code: string }>
  expect(details.length).toBeGreaterThan(0)
  for (const detail of details) {
    expect(detail.path).toMatch(STAGE_DETAIL_PATH)
    expect(FLOW_GATE_DETAIL_CODES).toContain(detail.code)
  }
}

describe('frozen v1 routes on a pinned project without approved stages (C21, UA-48)', () => {
  it('refuses task ready and attempt reserve with 422 baseline_not_approved and stage details, and the deploy decision without a release candidate', async () => {
    seedPinnedProjectWithClosedGate()
    const projectLock = (routeState.store.projects[0].updatedAt as Date).toISOString()

    await expectFlowGateRefusal(
      await UPDATE_TASK(apiRequest('PUT', '/tasks', { body: { id: DRAFT_TASK_ID, status: 'ready' }, lock: UPDATED_AT })),
    )
    await expectFlowGateRefusal(await reserve({ key: 'flow-gate-v1-edge' }))
    const deploy = await expectStatus(
      await DEPLOY(
        apiRequest('POST', `/projects/${PROJECT_ID}/deploy-decisions`, {
          body: { baselineId: BASELINE_ID, sourceRevision: REVISION, verdict: 'approved' },
          lock: projectLock,
        }),
        routeParams(PROJECT_ID),
      ),
      422,
    )
    expect(deploy.code).toBe('release_candidate_required')

    expect(routeState.store.tasks.map((task) => task.status)).toEqual(['ready', 'draft'])
    expect(routeState.store.tasks[0].executionAttempts).toEqual([])
    expect(routeState.store.decisions.filter((decision) => decision.kind === 'deploy')).toEqual([])
  })
})
