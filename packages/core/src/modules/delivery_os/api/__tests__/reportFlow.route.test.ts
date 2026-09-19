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
import { GET, openApi } from '../projects/[id]/report/route'
import { FOREIGN_ORG_ID, ORG_ID, PROJECT_ID, TENANT_ID } from '../../commands/__tests__/baselineTestKit'
import { createDeliveryOsReportQueries } from '../../commands/reportQueries'
import {
  FLOW_APPROVAL_STAGE_ORDER,
  deliveryReportFlowSectionSchema,
  deliveryReportV1Schema,
  reportGateBlockerSchema,
  type DeliveryReportWithFlow,
  type FlowStageId,
} from '../../lib/contracts'
import { deliveryReportResponseSchema } from '../../lib/reportContracts'
import { hashFlowTemplate } from '../../lib/flowRules'
import { DEFAULT_FLOW_TEMPLATE } from '../../lib/flowTemplates'
import { seedReadyTask } from './attemptRouteKit'
import { EM_WRITE_METHODS, FOREIGN_TENANT_ID, VIEW_ONLY, em, expectFrozenError, apiRequest, resetRouteState, routeParams, routeState, signInAs } from './routeTestKit'

const TEMPLATE_HASH = hashFlowTemplate(DEFAULT_FLOW_TEMPLATE)
const FROZEN_V1_BLOCKER_KINDS = ['revision', 'ac', 'scan', 'deployment', 'deploy_decision']
const CLIENT_STAGES: readonly FlowStageId[] = ['key_visual', 'design_system_ui']

function getReport(projectId: string = PROJECT_ID): Promise<Response> {
  return GET(apiRequest('GET', `/projects/${projectId}/report`), routeParams(projectId))
}

async function readJson(response: Response): Promise<{ status: number; text: string; body: DeliveryReportWithFlow }> {
  const text = await response.text()
  return { status: response.status, text, body: JSON.parse(text) as DeliveryReportWithFlow }
}

function pinStoredProject(snapshot: unknown = DEFAULT_FLOW_TEMPLATE): void {
  Object.assign(routeState.store.projects[0], {
    flowTemplateId: DEFAULT_FLOW_TEMPLATE.templateId,
    flowTemplateVersion: DEFAULT_FLOW_TEMPLATE.version,
    flowTemplateHash: TEMPLATE_HASH,
    flowTemplateSnapshot: snapshot,
  })
}

function idFor(prefix: string, index: number): string {
  return `${prefix.repeat(8)}-${prefix.repeat(4)}-4${prefix.repeat(3)}-8${prefix.repeat(3)}-${prefix.repeat(11)}${index}`
}

function hashFor(index: number): string {
  return String(index).repeat(64)
}

/** Seeds one artifact per approval stage, each bound to its upstream, and approves every one (client stages with an approver). */
function seedApprovedStages(): Array<{ stageId: FlowStageId; artifactId: string; decisionId: string }> {
  const seeded: Array<{ stageId: FlowStageId; artifactId: string; decisionId: string }> = []
  FLOW_APPROVAL_STAGE_ORDER.forEach((stageId, index) => {
    const artifactId = idFor('a', index)
    const decisionId = idFor('d', index)
    const upstream = seeded[index - 1]
    routeState.store.stageArtifacts.push({
      id: artifactId,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      stageId,
      templateHash: TEMPLATE_HASH,
      version: 1,
      contentHash: hashFor(index + 1),
      dependsOn: upstream ? [{ stageId: upstream.stageId, artifactId: upstream.artifactId, version: 1, contentHash: hashFor(index) }] : [],
      createdAt: new Date(`2026-09-19T12:0${index}:00.000Z`),
    })
    routeState.store.stageDecisions.push({
      id: decisionId,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      stageId,
      templateHash: TEMPLATE_HASH,
      artifactId,
      subjectHash: hashFor(index + 1),
      verdict: 'approved',
      decidedAt: new Date(`2026-09-19T12:1${index}:00.000Z`),
      clientApproverName: CLIENT_STAGES.includes(stageId) ? 'Client Owner' : null,
      clientApprovalEvidence: CLIENT_STAGES.includes(stageId) ? 'Recorded approval' : null,
    })
    seeded.push({ stageId, artifactId, decisionId })
  })
  return seeded
}

function expectV1GatesUntouched(report: DeliveryReportWithFlow): void {
  for (const gate of [report.gates.publishable, report.gates.releasable]) {
    for (const blocker of gate.blocking) expect(FROZEN_V1_BLOCKER_KINDS).toContain(blocker.kind)
  }
}

beforeEach(() => {
  resetRouteState()
})

describe('GET /projects/:id/report — F15 flow section', () => {
  it('keeps the frozen v1 blocker enum and documents the extended answer schema', () => {
    expect(reportGateBlockerSchema.shape.kind.options).toEqual(FROZEN_V1_BLOCKER_KINDS)
    const response = openApi.methods.GET?.responses?.[0]
    expect(response?.schema).toBe(deliveryReportResponseSchema)
    expect(Object.keys(deliveryReportResponseSchema.shape)).toEqual(expect.arrayContaining([...Object.keys(deliveryReportV1Schema.shape), 'flow', 'currentCandidate']))
  })

  it('preserves the existing legacy report response with null flow and candidate context', async () => {
    seedReadyTask()
    const { status, text, body } = await readJson(await getReport())
    expect(status).toBe(200)
    expect(body).toHaveProperty('flow', null)
    const direct = await createDeliveryOsReportQueries(em as never).buildReport({ tenantId: TENANT_ID, organizationId: ORG_ID }, PROJECT_ID)
    expect(text).toBe(JSON.stringify(direct))
    expect(deliveryReportResponseSchema.safeParse(body).success).toBe(true)
  })

  it('adds the flow section to a pinned project: all stages missing and the stage blockers only inside flow.gate', async () => {
    seedReadyTask()
    pinStoredProject()
    for (const method of EM_WRITE_METHODS) em[method].mockClear()
    signInAs({ features: VIEW_ONLY })
    const { status, body } = await readJson(await getReport())
    expect(status).toBe(200)
    const parsed = deliveryReportResponseSchema.parse(body)
    expect(deliveryReportV1Schema.safeParse(body).success).toBe(true)
    expect(parsed.flow).toEqual({
      template: { templateId: DEFAULT_FLOW_TEMPLATE.templateId, version: DEFAULT_FLOW_TEMPLATE.version, hash: TEMPLATE_HASH },
      stages: FLOW_APPROVAL_STAGE_ORDER.map((stageId) => ({ stageId, currency: 'missing', approvedArtifact: null, decisionId: null, clientApproved: false })),
      gate: { ok: false, blocking: FLOW_APPROVAL_STAGE_ORDER.map((stageId) => ({ kind: 'artifact_missing', stageId, ref: null })) },
    })
    expectV1GatesUntouched(parsed)
    for (const method of EM_WRITE_METHODS) expect(em[method]).not.toHaveBeenCalled()
  })

  it('opens flow.gate once every approval stage is approved and current, with the decision and client flag per stage', async () => {
    seedReadyTask()
    pinStoredProject()
    const seeded = seedApprovedStages()
    const { body } = await readJson(await getReport())
    const flow = deliveryReportFlowSectionSchema.parse(body.flow)
    expect(flow.gate).toEqual({ ok: true, blocking: [] })
    expect(flow.stages).toEqual(
      seeded.map((stage, index) => ({
        stageId: stage.stageId,
        currency: 'approved',
        approvedArtifact: { artifactId: stage.artifactId, version: 1, contentHash: hashFor(index + 1) },
        decisionId: stage.decisionId,
        clientApproved: CLIENT_STAGES.includes(stage.stageId),
      })),
    )
    expectV1GatesUntouched(body)
  })

  it('downgrades dependants to stale in flow.gate when an upstream gets a new version', async () => {
    seedReadyTask()
    pinStoredProject()
    seedApprovedStages()
    routeState.store.stageArtifacts.push({
      id: idFor('a', 9),
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      stageId: 'ux',
      templateHash: TEMPLATE_HASH,
      version: 2,
      contentHash: hashFor(9),
      dependsOn: [{ stageId: 'scope', artifactId: idFor('a', 0), version: 1, contentHash: hashFor(1) }],
      createdAt: new Date('2026-09-19T13:00:00.000Z'),
    })
    const { body } = await readJson(await getReport())
    const flow = deliveryReportFlowSectionSchema.parse(body.flow)
    expect(flow.gate.ok).toBe(false)
    expect(flow.stages.map((stage) => stage.currency)).toEqual(['approved', 'pending', 'stale', 'stale'])
    expect(flow.gate.blocking.map((blocker) => blocker.stageId)).toEqual(expect.arrayContaining(['ux', 'key_visual', 'design_system_ui']))
  })

  it('binds decisionId and clientApproved to the approved version, not to a newer rejected one', async () => {
    seedReadyTask()
    pinStoredProject()
    const seeded = seedApprovedStages()
    routeState.store.stageArtifacts.push({
      id: idFor('a', 8),
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      stageId: 'key_visual',
      templateHash: TEMPLATE_HASH,
      version: 2,
      contentHash: hashFor(8),
      dependsOn: [{ stageId: 'ux', artifactId: seeded[1].artifactId, version: 1, contentHash: hashFor(2) }],
      createdAt: new Date('2026-09-19T13:00:00.000Z'),
    })
    routeState.store.stageDecisions.push({
      id: idFor('e', 8),
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      stageId: 'key_visual',
      templateHash: TEMPLATE_HASH,
      artifactId: idFor('a', 8),
      subjectHash: hashFor(8),
      verdict: 'rejected',
      decidedAt: new Date('2026-09-19T13:10:00.000Z'),
      clientApproverName: null,
    })
    const flow = deliveryReportFlowSectionSchema.parse((await readJson(await getReport())).body.flow)
    const keyVisual = flow.stages.find((stage) => stage.stageId === 'key_visual')
    expect(keyVisual).toEqual({
      stageId: 'key_visual',
      currency: 'rejected',
      approvedArtifact: { artifactId: seeded[2].artifactId, version: 1, contentHash: hashFor(3) },
      decisionId: seeded[2].decisionId,
      clientApproved: true,
    })
    expect(flow.gate.ok).toBe(false)
    expect(flow.gate.blocking).toContainEqual({ kind: 'rejected', stageId: 'key_visual', ref: idFor('e', 8) })
  })

  it('keeps a client stage pending when it was approved without the client approver', async () => {
    seedReadyTask()
    pinStoredProject()
    seedApprovedStages()
    const decision = routeState.store.stageDecisions.find((row) => row.stageId === 'design_system_ui')
    if (!decision) throw new Error('[internal] seeded decision expected')
    decision.clientApproverName = null
    const flow = deliveryReportFlowSectionSchema.parse((await readJson(await getReport())).body.flow)
    expect(flow.stages.find((stage) => stage.stageId === 'design_system_ui')).toEqual({
      stageId: 'design_system_ui',
      currency: 'pending',
      approvedArtifact: null,
      decisionId: null,
      clientApproved: false,
    })
    expect(flow.gate).toEqual({ ok: false, blocking: [{ kind: 'decision_pending', stageId: 'design_system_ui', ref: idFor('a', 3) }] })
  })

  it('fails closed when the pinned snapshot no longer parses instead of looking like a legacy project', async () => {
    seedReadyTask()
    pinStoredProject({ schemaVersion: 'delivery.flow-template/v0' })
    const { status, body } = await readJson(await getReport())
    expect(status).toBe(422)
    expect(body).toMatchObject({ code: 'flow_template_hash_mismatch' })
  })

  it('hides a pinned project of another tenant or organization behind 404', async () => {
    seedReadyTask()
    pinStoredProject()
    for (const session of [{ tenantId: FOREIGN_TENANT_ID }, { orgId: FOREIGN_ORG_ID }]) {
      signInAs(session)
      await expectFrozenError(await getReport(), 404, 'not_found')
    }
  })

  it('preserves the existing in-process report context for pinned projects', async () => {
    seedReadyTask()
    pinStoredProject()
    const queries = createDeliveryOsReportQueries(em as never)
    const scope = { tenantId: TENANT_ID, organizationId: ORG_ID }
    expect(await queries.buildReport(scope, PROJECT_ID)).toHaveProperty('flow.gate.ok', false)
  })
})
