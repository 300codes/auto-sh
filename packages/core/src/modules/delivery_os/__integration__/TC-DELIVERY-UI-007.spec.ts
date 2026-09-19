import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { evidenceRecordResponseSchema } from '../api/schemas'
import { evidenceDetailResponseSchema, evidenceListResponseSchema } from '../lib/evidenceReadContracts'
import { setupReportFixture, cleanupReportFixture, reportFixtureHash, reportFixturePng, type ReportFixtureResources } from './helpers/reportReadiness'
import en from '../i18n/en.json' with { type: 'json' }
const labels: Record<string, string> = en

test.describe('TC-DELIVERY-UI-007: scoped source evidence and screenshot bytes', () => {
  test('discovers revisionless screenshots separately, opens real detail and preview, rejects unlinked file', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const resources: ReportFixtureResources = { attachmentIds: [] }
    try {
      const fixture = await setupReportFixture(request, token, resources, 'react-vite')
      const base = `/api/delivery_os/projects/${fixture.projectId}/evidence`
      const created = await apiRequest(request, 'POST', base, { token, data: {
        kind: 'screenshot', baselineId: fixture.baselineId, payload: { attachmentId: fixture.attachmentId, sha256: reportFixtureHash, name: 'Read source fixture', viewport: { width: 1, height: 1 }, capturedAt: new Date().toISOString() },
      } })
      expect(created.status()).toBe(201)
      const evidence = evidenceRecordResponseSchema.parse(await readJsonSafe(created))
      const baselinePage = await apiRequest(request, 'GET', `${base}?${new URLSearchParams({ baselineId: fixture.baselineId, group: 'baseline', limit: '1' })}`, { token })
      expect(baselinePage.status()).toBe(200)
      const sources = evidenceListResponseSchema.parse(await readJsonSafe(baselinePage))
      expect(sources.items.map((row) => row.id)).toContain(evidence.evidenceId)
      expect(sources.items[0].sourceRevision).toBeNull()
      const revisionPage = await apiRequest(request, 'GET', `${base}?${new URLSearchParams({ baselineId: fixture.baselineId, revision: `git:${'a'.repeat(40)}` })}`, { token })
      expect(evidenceListResponseSchema.parse(await readJsonSafe(revisionPage)).items).toEqual([])
      const detailResponse = await apiRequest(request, 'GET', `${base}/${evidence.evidenceId}`, { token })
      expect(detailResponse.status()).toBe(200)
      const detail = evidenceDetailResponseSchema.parse(await readJsonSafe(detailResponse))
      expect(detail.attachments[0]).toMatchObject({ id: fixture.attachmentId, mimeType: 'image/png', available: true })
      const bytes = await apiRequest(request, 'GET', detail.attachments[0].previewUrl!, { token })
      expect(bytes.status()).toBe(200)
      expect(await bytes.body()).toEqual(reportFixturePng)
      expect(bytes.headers()['x-content-type-options']).toBe('nosniff')
      const unlinked = await apiRequest(request, 'GET', `${base}/${evidence.evidenceId}/attachments/${randomUUID()}`, { token })
      expect(unlinked.status()).toBe(404)
      await login(page, 'admin')
      await page.goto(`/backend/delivery/projects/${fixture.projectId}/report`)
      await page.getByRole('button', { name: evidence.evidenceId, exact: true }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog.getByText(evidence.evidenceId, { exact: true })).toBeVisible()
      const preview = dialog.getByRole('img', { name: labels['delivery_os.report.evidence.screenshot'], exact: true })
      await expect(preview).toBeVisible()
      await expect.poll(() => preview.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(1)
      await expect(dialog.getByRole('link', { name: labels['delivery_os.report.evidence.download'], exact: true })).toHaveAttribute('href', /^blob:/)
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
    } finally { await cleanupReportFixture(request, token, resources) }
  })
})
