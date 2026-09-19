/** @jest-environment node */
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ translate: (_key: string, fallback?: string) => fallback ?? _key }) }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => require('./routeTestKit').findMock)
jest.mock('@open-mercato/shared/lib/di/container', () => require('./routeTestKit').containerMock)
jest.mock('@open-mercato/shared/lib/auth/server', () => require('./routeTestKit').authServerMock)
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => require('./routeTestKit').organizationScopeMock)
jest.mock('../../events', () => ({ emitDeliveryOsEvent: jest.fn(async () => undefined) }))
import '@open-mercato/core/modules/delivery_os/commands'
import { POST as MATERIALIZE, metadata } from '../projects/[id]/flow/baseline/route'
import { POST as FREEZE } from '../projects/[id]/baselines/route'
import { apiRequest, resetRouteState, routeParams, routeState, signInAs } from './routeTestKit'
import { expectStatus, projectVersion } from './flowHelpers'
import { createPinnedProject, scopeArtifact, designArtifact, recordArtifact, approveStage, type ArtifactRef } from './stageRouteKit'
import { draftAttachmentRows, makeDraft } from '../../commands/__tests__/baselineTestKit'
import { FLOW_APPROVAL_STAGE_ORDER, type StageArtifactDependency, type StageArtifactV1 } from '../../lib/contracts'

beforeEach(() => resetRouteState())

it('materializes approved stages over HTTP and freezes a binding without fabricating technical approvals', async () => {
  const projectId = await createPinnedProject()
  const draft = makeDraft()
  routeState.store.attachments.push(...draftAttachmentRows(draft))
  const deps: StageArtifactDependency[] = []
  for (const stageId of FLOW_APPROVAL_STAGE_ORDER) {
    let artifact = stageId === 'scope' ? scopeArtifact(projectId) : designArtifact(projectId, stageId, [...deps])
    if (artifact.stageId === 'design_system_ui') artifact = { ...artifact, content: { ...artifact.content, screens: draft.screens } } as StageArtifactV1
    const ref: ArtifactRef = await recordArtifact(projectId, artifact)
    await approveStage(projectId, stageId, ref, `approve-${stageId}`, ['key_visual', 'design_system_ui'].includes(stageId) ? { clientApproval: { approverName: 'Client', approverRole: null, evidence: { kind: 'meeting', reference: 'Review', attachment: null, recordedAt: new Date().toISOString() } } } : {})
    deps.push({ stageId, ...ref })
  }
  const lock = await projectVersion(projectId)
  const result = await expectStatus(await MATERIALIZE(apiRequest('POST', '/flow/baseline', { body: {}, lock }), routeParams(projectId)), 200)
  expect(result.stageRefs).toEqual(deps)
  expect(routeState.store.decisions).toHaveLength(0)
  expect(routeState.store.baselines).toHaveLength(0)
  const baseline = await expectStatus(await FREEZE(apiRequest('POST', '/baselines', { body: { source: 'manual' }, lock: String(result.projectUpdatedAt) }), routeParams(projectId)), 201)
  expect(routeState.store.flowBaselineBindings).toEqual([expect.objectContaining({ baselineId: baseline.baselineId, stageRefs: deps })])
  expect(routeState.store.decisions).toHaveLength(0)
  await expectStatus(await MATERIALIZE(apiRequest('POST', '/flow/baseline', { body: {}, lock }), routeParams(projectId)), 409)
})

it('fails closed for unapproved flow, missing project version and foreign scope', async () => {
  expect(metadata.POST.requireFeatures).toEqual(['delivery_os.flow.manage'])
  const projectId = await createPinnedProject()
  await expectStatus(await MATERIALIZE(apiRequest('POST', '/flow/baseline', { body: {} }), routeParams(projectId)), 428)
  await expectStatus(await MATERIALIZE(apiRequest('POST', '/flow/baseline', { body: {}, lock: await projectVersion(projectId) }), routeParams(projectId)), 422)
  signInAs({ orgId: '99999999-9999-4999-8999-999999999999' })
  await expectStatus(await MATERIALIZE(apiRequest('POST', '/flow/baseline', { body: {}, lock: new Date().toISOString() }), routeParams(projectId)), 404)
})
