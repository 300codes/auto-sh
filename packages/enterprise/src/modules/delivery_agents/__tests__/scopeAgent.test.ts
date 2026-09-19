const projectRead = jest.fn()
const intakeRead = jest.fn()
const command = jest.fn()
jest.mock('@open-mercato/core/modules/delivery_os/commands/shared', () => ({ requireScopedProject: (...args: unknown[]) => projectRead(...args), findScopedIntake: (...args: unknown[]) => intakeRead(...args), DELIVERY_INTAKE_RESOURCE_KIND: 'delivery_os.intake' }))
jest.mock('@open-mercato/core/modules/delivery_os/api/routeSupport', () => ({ executeDeliveryCommand: (...args: unknown[]) => command(...args) }))
import { applyAclFeatureOverrides, resetModuleContractOverridesForTests } from '@open-mercato/shared/modules/overrides'
import { scopeAgent } from '../ai-agents'
import { importScopeInput, importScopeTool, readScopeTool } from '../ai-tools'
import { loadScopingProposalFixture } from '@open-mercato/core/modules/delivery_os/lib/fixtures/flow'
import type { McpToolContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
const proposal = loadScopingProposalFixture()
const project = { id: proposal.projectId, name: 'Scope project', brief: null, targetProfileId: 'wordpress-theme', targetProfileVersion: 1, createdAt: new Date('2026-09-19T10:00:00.000Z') }
const ctx = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222', userId: '33333333-3333-4333-8333-333333333333', userFeatures: ['delivery_agents.*', 'delivery_os.*'], isSuperAdmin: false, container: { resolve: () => ({ fork: () => ({}) }) } } as unknown as McpToolContext
const input = { proposal, intakeUpdatedAt: project.createdAt.toISOString() }
beforeEach(() => { projectRead.mockReset(); intakeRead.mockReset(); command.mockReset(); projectRead.mockResolvedValue(project); intakeRead.mockResolvedValue(null); command.mockResolvedValue({ blocked: null, result: { duplicate: false, manifestHash: 'a'.repeat(64) } }) })
test('agent exposes only typed read/proposal tools with runtime confirmation and cannot approve or dispatch', () => {
  expect(scopeAgent.allowedTools).toEqual([readScopeTool.name, importScopeTool.name])
  expect(scopeAgent.mutationPolicy).toBe('confirm-required')
  expect(scopeAgent.readOnly).toBe(false)
  expect(importScopeTool.isMutation).toBe(true)
  expect(importScopeInput.safeParse({ proposal: { projectId: proposal.projectId }, intakeUpdatedAt: input.intakeUpdatedAt }).success).toBe(false)
})
test('read scopes all core service calls and fails closed without organization or required feature', async () => {
  const loaded = await readScopeTool.handler({ projectId: project.id }, ctx)
  expect(loaded.project.targetProfileId).toBe('wordpress-theme')
  expect(projectRead).toHaveBeenCalledWith(expect.anything(), project.id, { tenantId: ctx.tenantId, organizationId: ctx.organizationId })
  await expect(readScopeTool.handler({ projectId: project.id }, { ...ctx, organizationId: null })).rejects.toThrow('[internal]')
  await expect(readScopeTool.handler({ projectId: project.id }, { ...ctx, userFeatures: ['delivery_os.projects.view'] })).rejects.toThrow('[internal]')
})
test('no handler write occurs without confirmation; confirmation imports only intake through mutation guards with its own token', async () => {
  await expect(importScopeTool.handler(input, ctx)).rejects.toThrow('confirmed pending action')
  expect(command).not.toHaveBeenCalled()
  const result = await importScopeTool.handler(input, { ...ctx, approvedPendingActionId: 'confirmed-action' })
  expect(result.requiresStageReview).toBe(true)
  expect(result.proposal).toEqual(proposal)
  expect(command).toHaveBeenCalledTimes(1)
  const [runtime, scope, operation] = command.mock.calls[0]
  expect(operation.commandId).toBe('delivery_os.intake.import_proposal')
  expect(operation.body).toEqual({ proposal })
  expect(runtime.request.headers.get('x-om-ext-optimistic-lock-expected-updated-at')).toBe(input.intakeUpdatedAt)
  expect(scope).toEqual({ tenantId: ctx.tenantId, organizationId: ctx.organizationId })
})
test('approval preview captures the intake version and full proposal; mutation guards remain binding after confirmation', async () => {
  const preview = await importScopeTool.loadBeforeRecord!(input, ctx)
  expect(preview?.recordVersion).toBe(project.createdAt.toISOString())
  expect(preview?.after).toEqual({ proposal })
  command.mockResolvedValue({ blocked: new Response(null, { status: 409 }) })
  await expect(importScopeTool.handler(input, { ...ctx, approvedPendingActionId: 'confirmed-action' })).rejects.toThrow('blocked by a mutation guard')
})

test('removed features deny even unrestricted AI subjects before any scoped read', async () => {
  applyAclFeatureOverrides({ 'delivery_agents.scope': null })
  try {
    await expect(readScopeTool.handler({ projectId: project.id }, { ...ctx, isSuperAdmin: true, userFeatures: ['*'] })).rejects.toThrow('[internal]')
    expect(projectRead).not.toHaveBeenCalled()
  } finally {
    resetModuleContractOverridesForTests()
  }
})
