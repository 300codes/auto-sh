import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { API, caller, cleanupRegistry, createPinnedProject, createRegistry, recordArtifact, scopeArtifact } from './flowSpecKit'

test('FLOW-02 browser: client proof binds a decision to one version and history is read-only', async ({ page, request }) => {
  const registry = createRegistry()
  const token = await getAuthToken(request, 'admin')
  const call = caller(request, token)
  try {
    const projectId = await createPinnedProject(call, registry, 'FLOW-UI-02')
    const first = await recordArtifact(call, projectId, scopeArtifact(projectId, 'Reviewed scope'))
    await login(page, 'admin')
    await page.context().addCookies([{ name: 'locale', value: 'en', url: new URL(page.url()).origin }])
    await page.goto(`/backend/delivery/projects/${projectId}?stage=scope#delivery-stage-scope`)
    const stage = page.getByTestId('delivery-stage-scope')
    await stage.getByRole('button', { name: "Record client's decision", exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.locator('[data-crud-field-id="approverName"]').getByRole('textbox').fill('Customer decision maker')
    await dialog.locator('[data-crud-field-id="evidenceReference"]').getByRole('textbox').fill('Customer email approving reviewed scope')
    const response = page.waitForResponse((item) => item.url().includes(`/stages/scope/decisions`) && item.request().method() === 'POST')
    await dialog.locator('[data-crud-field-id="evidenceReference"]').getByRole('textbox').press('Control+Enter')
    expect((await response).status()).toBe(201)
    const decisions = await call('GET', `${API}/projects/${projectId}/stages/scope/decisions`)
    expect(decisions.body.items).toEqual([expect.objectContaining({ artifactId: first.artifactId, subjectHash: first.contentHash, clientApproval: expect.objectContaining({ approverName: 'Customer decision maker' }) })])
    await recordArtifact(call, projectId, scopeArtifact(projectId, 'New scope requiring another decision'))
    await page.reload()
    await stage.getByRole('button', { name: 'Version 1', exact: true }).click()
    await expect(stage.getByRole('button', { name: "Record client's decision", exact: true })).toHaveCount(0)
    await expect(stage.getByText('Customer decision maker', { exact: false })).toBeVisible()
    await stage.getByRole('button', { name: 'Version 2', exact: true }).click()
    await stage.getByRole('button', { name: "Record client's decision", exact: true }).click()
    await dialog.locator('[data-crud-field-id="verdict"]').getByRole('combobox').click()
    await page.getByRole('option', { name: 'Rejected', exact: true }).click()
    await dialog.locator('[data-crud-field-id="reason"]').getByRole('textbox').fill('Clarify the scope boundaries')
    await dialog.getByRole('button', { name: 'Save progress', exact: true }).click()
    await expect(stage.getByText('Clarify the scope boundaries', { exact: true })).toBeVisible()
  } finally { await cleanupRegistry(request, token, registry) }
})
