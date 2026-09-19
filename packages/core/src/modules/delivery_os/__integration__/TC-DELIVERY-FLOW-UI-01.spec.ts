import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { caller, cleanupRegistry, createPinnedProject, createRegistry, API, scopingProposalFixture } from './flowSpecKit'

test('FLOW-01 browser: wizard resumes persisted brief and manual proposal remains a review draft', async ({ page, request }) => {
  const registry = createRegistry()
  const token = await getAuthToken(request, 'admin')
  const call = caller(request, token)
  try {
    const projectId = await createPinnedProject(call, registry, 'FLOW-UI-01')
    await login(page, 'admin')
    await page.context().addCookies([{ name: 'locale', value: 'en', url: new URL(page.url()).origin }])
    await page.goto(`/backend/delivery/projects/${projectId}`)
    await page.getByRole('button', { name: 'Brief and scope', exact: true }).click()
    const wizard = page.getByTestId('delivery-brief-wizard')
    await wizard.locator('[data-crud-field-id="businessGoal"]').getByRole('textbox').fill('A traceable customer quotation process')
    await wizard.locator('[data-crud-field-id="step"]').getByRole('combobox').click()
    await page.getByRole('option', { name: 'Scope conversation', exact: true }).click()
    const saved = page.waitForResponse((response) => response.url().endsWith(`/projects/${projectId}/intake`) && response.request().method() === 'PUT')
    await wizard.getByRole('button', { name: 'Save progress', exact: true }).click()
    expect((await saved).status()).toBe(200)
    await page.reload()
    await expect(wizard.locator('[data-crud-field-id="step"]').getByRole('combobox')).toHaveText('Scope conversation')
    const proposal = { ...scopingProposalFixture(), projectId }
    await wizard.locator('[data-crud-field-id="proposal"]').getByRole('textbox').fill(JSON.stringify(proposal))
    await wizard.getByLabel('Also save this Scope as a draft for separate review', { exact: true }).check()
    await wizard.getByRole('button', { name: 'Import proposal', exact: true }).click()
    await expect(wizard.getByText(proposal.manifestId, { exact: true })).toBeVisible()
    const flow = await call('GET', `${API}/projects/${projectId}/flow`)
    expect(flow.body.pendingApprovals).toEqual(expect.arrayContaining([expect.objectContaining({ stageId: 'scope' })]))
    const decisions = await call('GET', `${API}/projects/${projectId}/stages/scope/decisions`)
    expect(decisions.body.items).toEqual([])
    const intake = await call('GET', `${API}/projects/${projectId}/intake`)
    expect(intake.body.intake).toMatchObject({ step: 'scoping', brief: { businessGoal: 'A traceable customer quotation process' } })
  } finally { await cleanupRegistry(request, token, registry) }
})
