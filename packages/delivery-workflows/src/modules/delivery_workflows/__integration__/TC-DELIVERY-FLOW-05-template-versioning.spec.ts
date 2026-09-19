import { randomUUID } from 'node:crypto'
import { test, expect, type Page } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createUserFixture } from '@open-mercato/core/helpers/integration/authFixtures'
import { createOrganizationInDb, setUserAclInDb, withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import { getBuiltInFlowTemplate } from '../../../../../core/src/modules/delivery_os/lib/flowTemplates'
import { caller, cleanupRegistry, createRegistry, createProject, FOREIGN_PASSWORD } from '../../../../../core/src/modules/delivery_os/__integration__/flowSpecKit'
import type { WorkflowDefinition } from '@open-mercato/core/modules/workflows/data/entities'

async function palette(page: Page, command: string) {
  await page.keyboard.press('ControlOrMeta+k')
  const search = page.getByPlaceholder('Search commands…')
  await search.fill(command)
  await expect(page.getByRole('option').filter({ hasText: command }).first()).toBeVisible()
  await page.keyboard.press('Enter')
}

test('FLOW-05: Studio publishes edited semantics; existing and completed projects retain v1', async ({ page, request }) => {
  test.setTimeout(120_000)
  const registry = createRegistry()
  const admin = await getAuthToken(request, 'superadmin')
  const { tenantId } = getTokenScope(await getAuthToken(request, 'admin'))
  const organizationId = await createOrganizationInDb({ tenantId, name: `Flow05 ${randomUUID()}` })
  registry.organizationIds.push(organizationId)
  const email = `flow05-${randomUUID()}@example.com`
  let token: string | null = null
  try {
    const userId = await createUserFixture(request, admin, { email, password: FOREIGN_PASSWORD, organizationId, roles: [] })
    registry.userIds.push(userId)
    await setUserAclInDb({ userId, tenantId, organizations: [organizationId], features: ['delivery_os.*', 'delivery_workflows.*', 'workflows.*'] })
    token = await getAuthToken(request, email, FOREIGN_PASSWORD)
    const call = caller(request, token)
    const workflowId = `flow05-${randomUUID()}`
    const stages = structuredClone(getBuiltInFlowTemplate('delivery-default', 1)!.stages)
    const definition: WorkflowDefinition['definition'] = {
      steps: [{ stepId: 'start', stepName: 'Start', stepType: 'START' }, ...stages.map((stage) => ({
        stepId: stage.stageId, stepName: stage.title,
        stepType: (['scope', 'ux', 'key_visual', 'design_system_ui'].includes(stage.kind) ? 'WAIT_FOR_SIGNAL' : 'USER_TASK') as 'WAIT_FOR_SIGNAL' | 'USER_TASK',
        signalConfig: { signalName: `delivery.stage.${stage.stageId}.approved` }, config: { deliveryStage: stage },
      })), { stepId: 'end', stepName: 'End', stepType: 'END' }],
      transitions: stages.flatMap((stage) => (stage.dependsOn.length ? stage.dependsOn : ['start']).map((fromStepId) => ({
        transitionId: `${fromStepId}-${stage.stageId}`, fromStepId, toStepId: stage.stageId, trigger: 'auto' as const,
      }))).concat([{ transitionId: 'release-end', fromStepId: 'release', toStepId: 'end', trigger: 'auto' }]),
    }
    const created = await call('POST', '/api/workflows/definitions', { body: {
      workflowId, workflowName: 'Flow 05 process', version: 1, enabled: true, metadata: { immutablePolicy: 'delivery' }, definition,
    } })
    expect(created.status).toBe(201)
    const first = created.body.data as { id: string; updatedAt: string; definition: WorkflowDefinition['definition'] }
    const initialSetting = await call('PUT', '/api/delivery_workflows/settings', { body: { workflowId, version: 1 } })
    expect(initialSetting.status).toBe(200)
    const settingVersion = (initialSetting.body.setting as { updatedAt: string }).updatedAt
    const projectA = await createProject(call, registry, 'Flow05 v1')
    await page.request.post('/api/auth/login', { form: { email, password: FOREIGN_PASSWORD } })
    await page.context().addCookies(['om_demo_notice_ack', 'om_cookie_notice_ack'].map((name) => ({ name, value: 'ack', url: process.env.BASE_URL || 'http://localhost:3000' })))
    await page.goto(`/backend/definitions/visual-editor?id=${first.id}`)
    await palette(page, 'Toggle the Code view')
    const editor = page.getByTestId('workflow-code-view-json')
    const edited = JSON.parse(await editor.inputValue()) as WorkflowDefinition['definition']
    const transition = edited.transitions.find((entry) => entry.toStepId === 'implementation')!
    transition.condition = { field: 'implementationAllowed', operator: '=', value: true }
    const scopePolicy = edited.steps.find((entry) => entry.stepId === 'scope')!.config!.deliveryStage as { requiresClientApproval: boolean }
    scopePolicy.requiresClientApproval = true
    const implementation = edited.steps.find((entry) => entry.stepId === 'implementation')!
    implementation.config = { ...implementation.config, toolPolicy: { mode: 'reviewed' } }
    const reviewStage = { ...stages.find((stage) => stage.stageId === 'implementation')!, stageId: 'additional_review', title: 'Additional review', kind: 'qa' }
    edited.steps.push({ stepId: 'additional_review', stepName: 'Additional review', stepType: 'USER_TASK', config: { deliveryStage: reviewStage } })
    const releaseEdge = edited.transitions.find((entry) => entry.toStepId === 'release')!
    releaseEdge.toStepId = 'additional_review'
    edited.transitions.push({ transitionId: 'review-release', fromStepId: 'additional_review', toStepId: 'release', trigger: 'auto' })
    await editor.fill(JSON.stringify(edited, null, 2))
    await page.getByTestId('workflow-code-view-apply').click()
    await page.keyboard.press('Escape')
    await palette(page, 'Save')
    await expect(page.getByRole('button', { name: 'Create version', exact: true })).toBeVisible()
    const publishedResponse = page.waitForResponse((response) => response.url().endsWith(`/definitions/${first.id}/publish`) && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'Create version', exact: true }).click()
    const response = await publishedResponse
    expect(response.status()).toBe(200)
    const published = (await response.json()).data as { id: string; version: number }
    expect(published.version).toBe(2)
    expect((await call('PUT', '/api/delivery_workflows/settings', { lock: settingVersion, body: { workflowId, version: 2 } })).status).toBe(200)
    const projectB = await createProject(call, registry, 'Flow05 v2')
    const bindingA = await call('GET', `/api/delivery_workflows/projects/${projectA.id}/binding`)
    expect(bindingA.status).toBe(200)
    expect(bindingA.body.binding).toMatchObject({ definitionId: first.id, version: 1, studioHref: `/backend/definitions/visual-editor?id=${first.id}` })
    const bindingB = await call('GET', `/api/delivery_workflows/projects/${projectB.id}/binding`)
    expect(bindingB.status).toBe(200)
    expect(bindingB.body.binding).toMatchObject({ definitionId: published.id, version: 2 })
    const bindings = await withClient(async (client) => (await client.query('select project_id, definition_id, version, workflow_instance_id from delivery_workflow_project_bindings where organization_id = $1', [organizationId])).rows)
    expect(bindings.find((row) => row.project_id === projectA.id)?.definition_id).toBe(first.id)
    expect(bindings.find((row) => row.project_id === projectB.id)?.definition_id).toBe(published.id)
    expect(new Set(bindings.map((row) => row.workflow_instance_id)).size).toBe(2)
    await withClient(async (client) => { await client.query("update workflow_instances set status = 'COMPLETED' where id = $1", [bindings.find((row) => row.project_id === projectA.id)?.workflow_instance_id]) })
    expect((await call('PUT', `/api/workflows/definitions/${first.id}`, { lock: first.updatedAt, body: { definition: edited } })).status).toBe(409)
    await page.reload()
    const persistedV1 = await call('GET', `/api/workflows/definitions/${first.id}`)
    expect((persistedV1.body.data as { definition: unknown }).definition).toEqual(first.definition)
    const persistedV2 = await call('GET', `/api/workflows/definitions/${published.id}`)
    expect((persistedV2.body.data as { definition: WorkflowDefinition['definition'] }).definition.transitions.some((entry) => entry.condition?.field === 'implementationAllowed')).toBe(true)
    await page.goto('/backend/settings/delivery-flow')
    await expect(page.locator(`a[href="/backend/definitions/visual-editor?id=${published.id}"]`)).toBeVisible()
  } finally {
    await withClient(async (client) => {
      for (const table of ['workflow_events', 'user_tasks', 'step_instances', 'workflow_branch_instances', 'workflow_instances', 'delivery_workflow_project_bindings', 'delivery_workflows_settings', 'workflow_definition_drafts', 'workflow_definitions']) {
        await client.query(`delete from ${table} where tenant_id = $1 and organization_id = $2`, [tenantId, organizationId])
      }
    })
    await cleanupRegistry(request, token, registry)
  }
})
