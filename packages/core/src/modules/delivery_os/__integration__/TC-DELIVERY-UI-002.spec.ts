import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { fillControlledInput } from '@open-mercato/core/helpers/integration/ui'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { projectDetailSchema } from '../api/schemas'

const LIST_PATH = '/backend/delivery/projects'

/**
 * TC-DELIVERY-UI-002: the manual operator flow, proven by walking it.
 *
 * Self-contained: the project is created through the UI and archived again in
 * `finally`, so the run needs no demo data and leaves none behind.
 *
 * Assertions avoid translated copy wherever a structural hook exists, so the
 * spec does not depend on the environment locale. The one place it cannot —
 * the archive row action — is matched by its destructive styling, not its label.
 *
 * Scope note: a project with an ACTIVE baseline and tasks is NOT created here.
 * That fixture belongs to OSS-02/QA-02 (see `handoff.md`), so the task-selection
 * and requirements/design paths stay covered by the component tests.
 */
async function findProjectIdByName(
  request: APIRequestContext,
  token: string,
  name: string,
): Promise<string | null> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/delivery_os/projects?search=${encodeURIComponent(name)}&pageSize=10&includeArchived=true`,
    { token },
  )
  if (!response.ok()) return null
  const body = await readJsonSafe(response) as { items?: Array<{ id?: string; name?: string }> } | null
  return body?.items?.find((item) => item.name === name)?.id ?? null
}

async function archiveViaApi(request: APIRequestContext, token: string, projectId: string): Promise<void> {
  const detailResponse = await apiRequest(request, 'GET', `/api/delivery_os/projects/${projectId}`, { token })
  if (!detailResponse.ok()) return
  const detail = projectDetailSchema.parse(await readJsonSafe(detailResponse))
  if (detail.archivedAt) return
  expect(detail.updatedAt, 'the project must expose a version before it can be archived safely').toBeTruthy()
  await apiRequest(request, 'DELETE', `/api/delivery_os/projects?id=${projectId}`, {
    token,
    headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: detail.updatedAt! },
  })
}

async function openListFromNavigation(page: Page): Promise<void> {
  await page.goto('/backend')
  const navLink = page.locator(`a[href="${LIST_PATH}"]`).first()
  await expect(navLink, 'the Delivery group must register a sidebar entry for the project list').toBeAttached({
    timeout: 15_000,
  })
  await navLink.scrollIntoViewIfNeeded().catch(() => undefined)
  await navLink.click({ timeout: 10_000 })
  await page.waitForURL(`**${LIST_PATH}`, { timeout: 15_000 })
}

test('TC-DELIVERY-UI-002: an operator walks the manual flow from the sidebar to the archived project', async ({ page, request }) => {
  const token = await getAuthToken(request, 'admin')
  const name = `Delivery UI-02 ${randomUUID()}`
  const brief = 'Self-contained manual-flow fixture for TC-DELIVERY-UI-002'
  let projectId: string | null = null

  try {
    await login(page, 'admin')

    // 1. Reach the module through the navigation, not through a pasted URL.
    await openListFromNavigation(page)

    // 2. Create the project with the form and land on its detail screen.
    await page.locator(`a[href="${LIST_PATH}/create"]`).first().click()
    await page.waitForURL(`**${LIST_PATH}/create`, { timeout: 15_000 })
    await fillControlledInput(page.locator('[data-crud-field-id="name"] input').first(), name)
    await fillControlledInput(page.locator('[data-crud-field-id="brief"] textarea').first(), brief)

    const createResponse = page.waitForResponse((response) =>
      response.url().includes('/api/delivery_os/projects')
      && response.request().method() === 'POST',
    )
    await page.locator('button[type="submit"]').first().click()
    expect((await createResponse).status()).toBe(201)
    await page.waitForURL(new RegExp(`${LIST_PATH}/[0-9a-f-]{36}`), { timeout: 15_000 })
    projectId = page.url().split('/').pop()?.split('?')[0] ?? null
    expect(projectId, 'the form must redirect to the created project').toBeTruthy()

    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()

    // 3. All four sections render, and their empty states are three DIFFERENT
    //    statements — no baseline, no tasks, no evidence read endpoint.
    const requirements = page.getByTestId('delivery-requirements-section')
    const design = page.getByTestId('delivery-design-section')
    const tasks = page.getByTestId('delivery-tasks-section')
    const evidence = page.getByTestId('delivery-evidence-section')
    for (const section of [requirements, design, tasks, evidence]) {
      await expect(section).toBeVisible({ timeout: 15_000 })
    }

    // Compare the empty-state NODES, not whole sections: section headings differ
    // on their own, so comparing sections would pass even if all three empty
    // states said exactly the same thing — and that distinction is the point.
    const noBaselineNode = page.getByTestId('delivery-requirements-section-empty')
    const noTasksNode = page.getByTestId('delivery-tasks-empty')
    const evidenceNotice = page.getByTestId('delivery-evidence-list-unavailable')
    for (const node of [noBaselineNode, noTasksNode, evidenceNotice]) {
      await expect(node).toBeVisible({ timeout: 15_000 })
    }
    const noBaselineText = (await noBaselineNode.innerText()).trim()
    const noTasksText = (await noTasksNode.innerText()).trim()
    const noEvidenceEndpointText = (await evidenceNotice.innerText()).trim()
    for (const text of [noBaselineText, noTasksText, noEvidenceEndpointText]) {
      expect(text.length).toBeGreaterThan(0)
    }
    expect(noBaselineText).not.toBe(noTasksText)
    expect(noTasksText).not.toBe(noEvidenceEndpointText)
    expect(noBaselineText).not.toBe(noEvidenceEndpointText)

    // A project without acceptance criteria shows no percentage at all.
    await expect(page.getByTestId('delivery-evidence-percent')).toHaveText('—')

    // 4. Find the project again from the list search. The search box is
    //    debounced, so wait for the filtered response before touching the table.
    await page.goto(LIST_PATH)
    const searchResponse = page.waitForResponse((response) =>
      response.url().includes('/api/delivery_os/projects?') && response.url().includes('search='),
    )
    await fillControlledInput(page.getByRole('searchbox', { name: 'Search projects by name' }), name)
    await searchResponse
    const projectLinkSelector = `a[href="${LIST_PATH}/${projectId}"]`
    const projectLink = page.locator(projectLinkSelector).first()
    await expect(projectLink).toBeVisible({ timeout: 15_000 })

    // 5. Archive it from the list, through the confirmation dialog. The trigger is
    //    scoped to the row that holds THIS project's link — `.first()` on the page
    //    would archive whatever row happens to be on top, which in a shared tenant
    //    means destroying someone else's record.
    const projectRow = page.locator('tr', { has: page.locator(projectLinkSelector) })
    await expect(projectRow).toHaveCount(1, { timeout: 15_000 })
    const rowActionsTrigger = projectRow.getByRole('button', { name: /open actions/i }).first()
    await rowActionsTrigger.click({ timeout: 10_000 })
    const archiveItem = page.locator('[role="menu"] [role="menuitem"].text-destructive').first()
    await expect(archiveItem).toBeVisible({ timeout: 10_000 })

    const deleteResponse = page.waitForResponse((response) =>
      response.url().includes('/api/delivery_os/projects')
      && response.request().method() === 'DELETE',
    )
    await archiveItem.click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    await dialog.getByRole('button').last().click()

    const archived = await deleteResponse
    expect(archived.status()).toBe(200)
    expect(archived.url(), 'the DELETE must target this project, not another row').toContain(projectId!)
    expect(
      archived.request().headers()[OPTIMISTIC_LOCK_HEADER_NAME],
      'the archive request must carry the record version',
    ).toBeTruthy()

    await expect(projectLink).toHaveCount(0, { timeout: 15_000 })
  } finally {
    const cleanupId = projectId ?? (await findProjectIdByName(request, token, name))
    if (cleanupId) await archiveViaApi(request, token, cleanupId)
  }
})
