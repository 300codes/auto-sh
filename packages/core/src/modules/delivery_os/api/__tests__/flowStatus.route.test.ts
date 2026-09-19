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
import { PUT as PUT_INTAKE } from '../projects/[id]/intake/route'
import { FOREIGN_ORG_ID, ORG_ID, PROJECT_ID, TENANT_ID, catchHttpError, expectFrozenBody } from '../../commands/__tests__/baselineTestKit'
import { createDeliveryOsFlowQueries } from '../../commands/flowQueries'
import { createDeliveryOsReportQueries } from '../../commands/reportQueries'
import { FLOW_APPROVAL_STAGE_ORDER, flowStatusV1Schema, type FlowStageId, type FlowStatusV1 } from '../../lib/contracts'
import { hashFlowTemplate } from '../../lib/flowRules'
import { DEFAULT_FLOW_TEMPLATE } from '../../lib/flowTemplates'
import { loadIntakeFixture } from '../../lib/fixtures/flow/index'
import { seedReadyTask } from './attemptRouteKit'
import { createProject, expectStatus, prepareReadyTask, projectVersion, reserveOn, type Json } from './flowHelpers'
import {
  EM_WRITE_METHODS,
  FOREIGN_TENANT_ID,
  VIEW_ONLY,
  apiRequest,
  em,
  isAllowedBy,
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
    const report = await createDeliveryOsReportQueries(em as never).buildReport(QUERY_SCOPE, PROJECT_ID, { includeFlow: true })
    expect(status.gates.dispatchable.ok).toBe(false)
    expect(status.gates.publishable.ok).toBe(false)
    expect(report.flow?.gate.ok).toBe(false)
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
