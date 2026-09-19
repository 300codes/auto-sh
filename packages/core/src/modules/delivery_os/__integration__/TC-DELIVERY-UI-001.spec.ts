import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { projectCreateResponseSchema, projectDetailSchema } from '../api/schemas'

test('TC-DELIVERY-UI-001: project detail reads its scoped API and survives reload without enterprise', async ({ page, request }) => {
  const token = await getAuthToken(request, 'admin')
  const name = `Delivery UI ${randomUUID()}`
  const brief = 'Self-contained project detail integration fixture'
  let projectId: string | null = null
  try {
    const created = await apiRequest(request, 'POST', '/api/delivery_os/projects', {
      token,
      data: { name, brief, inputMode: 'from_brief', targetProfileId: 'react-vite', targetProfileVersion: 1 },
    })
    expect(created.ok()).toBeTruthy()
    projectId = projectCreateResponseSchema.parse(await readJsonSafe(created)).id
    await login(page, 'admin')
    const detailResponse = page.waitForResponse((response) =>
      response.url().endsWith(`/api/delivery_os/projects/${projectId}`) && response.request().method() === 'GET',
    )
    await page.goto(`/backend/delivery/projects/${projectId}`)
    expect((await detailResponse).status()).toBe(200)
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
    await expect(page.getByText(brief, { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  } finally {
    if (projectId) {
      const response = await apiRequest(request, 'GET', `/api/delivery_os/projects/${projectId}`, { token })
      expect(response.ok()).toBeTruthy()
      const detail = projectDetailSchema.parse(await readJsonSafe(response))
      expect(detail.updatedAt).toBeTruthy()
      const deleted = await apiRequest(request, 'DELETE', `/api/delivery_os/projects?id=${projectId}`, {
        token,
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: detail.updatedAt! },
      })
      expect(deleted.ok()).toBeTruthy()
    }
  }
})
