import { createHash, randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { uploadAttachmentFixture } from '@open-mercato/core/helpers/integration/attachmentsFixtures'
import { API, caller, cleanupRegistry, createProject, createRegistry, projectVersion, sql } from './flowSpecKit'
import { designImportScreenKey, designImportSessionSchema } from '../lib/designImportContracts'
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

test('UI-003 browser: partial design import survives reload, blocks freeze and completes without losing uploaded renders', async ({ page, request }) => {
  const registry = createRegistry()
  const token = await getAuthToken(request, 'admin')
  const call = caller(request, token)
  try {
    const project = await createProject(call, registry, 'UI-003 session')
    const uploaded = await uploadAttachmentFixture(request, token, { entityId: 'delivery_os:project', recordId: project.id, fileName: 'desktop.png', mimeType: 'image/png', buffer: png })
    registry.attachmentIds.push(uploaded.id)
    const first = { fileKey: 'test-file', nodeId: '1:1', name: 'Desktop screen', viewport: { width: 1440, height: 900 }, figmaVersion: 'v1', attachmentId: uploaded.id, sha256: createHash('sha256').update(png).digest('hex'), capturedAt: new Date().toISOString(), mimeType: 'image/png', sizeBytes: png.length }
    const second = { ...first, name: 'Mobile screen', viewport: { width: 390, height: 844 }, attachmentId: randomUUID() }
    const manifest = { schemaVersion: 'delivery.design-manifest/v1', screens: [first, second], tokens: {} }
    const created = await call('POST', `${API}/projects/${project.id}/design-imports`, { body: { manifest }, lock: project.updatedAt })
    expect(created.status).toBe(201)
    let session = designImportSessionSchema.parse(created.body)
    registry.resourceIds.add(session.id)
    const partial = await call('PUT', `${API}/projects/${project.id}/design-imports/${session.id}`, { body: { renders: [{ key: designImportScreenKey(first), attachmentId: first.attachmentId }] }, lock: session.updatedAt })
    session = designImportSessionSchema.parse(partial.body)
    const freeze = await call('POST', `${API}/projects/${project.id}/baselines`, { body: { source: 'manual' }, lock: await projectVersion(call, project.id) })
    expect(freeze.status).toBe(422)
    expect(freeze.body.details).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'design_import_incomplete' })]))
    await login(page, 'admin')
    await page.context().addCookies([{ name: 'locale', value: 'en', url: new URL(page.url()).origin }])
    await page.goto(`/backend/delivery/projects/${project.id}`)
    await page.reload()
    const progress = page.getByTestId('design-import-progress')
    await expect(progress.getByRole('img', { name: 'Desktop screen' })).toBeVisible()
    await expect(progress.getByRole('button', { name: 'Complete and update draft', exact: true })).toBeDisabled()
    const uploadResponse = page.waitForResponse((response) => response.url().endsWith('/api/attachments') && response.request().method() === 'POST')
    await progress.getByLabel('Upload render', { exact: true }).nth(1).setInputFiles({ name: 'mobile.png', mimeType: 'image/png', buffer: png })
    const uploadBody = await (await uploadResponse).json() as { item: { id: string } }
    registry.attachmentIds.push(uploadBody.item.id)
    await expect(progress.getByRole('img', { name: 'Mobile screen' })).toBeVisible()
    await progress.getByRole('radio').nth(0).check()
    await expect(progress.getByRole('radio').nth(0)).toBeChecked()
    await progress.getByRole('radio').nth(1).check()
    await expect(progress.getByRole('radio').nth(1)).toBeChecked()
    await progress.getByRole('button', { name: 'Complete and update draft', exact: true }).click()
    await expect(page.getByTestId('delivery-draft-design').getByRole('img')).toHaveCount(2)
    const restored = await call('GET', `${API}/projects/${project.id}/design-imports/${session.id}`)
    expect(restored.body.status).toBe('complete')
    expect((await call('PUT', `${API}/projects/${project.id}/design-imports/${session.id}`, { body: { action: 'save' }, lock: session.createdAt })).status).toBe(409)
  } finally {
    if (registry.projectIds.length) await sql('delete from delivery_design_import_sessions where project_id = any($1::uuid[])', [registry.projectIds])
    await cleanupRegistry(request, token, registry)
  }
})
