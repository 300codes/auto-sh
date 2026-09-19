import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { expect, test, type FrameLocator, type Page, type TestInfo } from '@playwright/test'
import { createWordPressBrowserFixture, type WordPressEditorState } from '@open-mercato/core/helpers/integration/wordpressBrowserFixtures'

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
let fixture: Awaited<ReturnType<typeof createWordPressBrowserFixture>> | undefined

test.use({ trace: 'off', video: 'off', viewport: { width: 1440, height: 1000 } })

test.afterEach(async ({ context }, testInfo) => {
  if (!fixture) return
  let browserCloseFailed = false
  try { await context.close() } catch { browserCloseFailed = true }
  try {
    await fixture.settle()
    if (browserCloseFailed && context.pages().length !== 0) {
      await testInfo.attach('wordpress-native-cleanup', { body: JSON.stringify({ nativeFixtureCleanup: 'not_run', reason: 'browser_close_failed', themeUpdate: 'retained_intentionally' }), contentType: 'application/json' })
      throw new Error('[internal] wordpress_browser_close_unconfirmed')
    }
    let cleanupDiagnosticFailed = false
    try { await checkpoint(testInfo, 'native_cleanup') } catch { cleanupDiagnosticFailed = true }
    const cleanup = await fixture.cleanup()
    try { await checkpoint(testInfo, 'native_cleanup_completed') } catch { cleanupDiagnosticFailed = true }
    await testInfo.attach('wordpress-native-cleanup', { body: JSON.stringify({ nativeFixtureCleanup: cleanup.status, browserCloseFailed, cleanupDiagnosticFailed, themeUpdate: 'retained_intentionally' }), contentType: 'application/json' })
    if (cleanupDiagnosticFailed) throw new Error('[internal] wordpress_cleanup_diagnostic_write_failed')
  } finally { fixture = undefined }
  if (browserCloseFailed) throw new Error('[internal] wordpress_browser_close_failed')
})

async function checkpoint(testInfo: TestInfo, phase: string) {
  const filename = testInfo.outputPath('checkpoint.json')
  await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 })
  await fs.writeFile(filename, JSON.stringify({ phase, observedAt: new Date().toISOString() }), { mode: 0o600 })
}

async function openEditor(page: Page, siteUrl: string, pageId: number, draft = true): Promise<FrameLocator> {
  await page.goto(`${siteUrl}/wp-admin/post.php?post=${pageId}&action=edit`, { waitUntil: 'domcontentloaded' })
  const welcome = page.getByRole('dialog', { name: 'Welcome to the editor', exact: true })
  const ready = draft ? page.getByRole('button', { name: 'Save draft', exact: true }) : page.getByRole('region', { name: 'Editor top bar' }).getByRole('link', { name: 'View Page', exact: true })
  await expect(welcome.or(ready).first()).toBeVisible()
  if (await welcome.isVisible()) { await welcome.getByRole('button', { name: 'Close', exact: true }).click(); await expect(welcome).toBeHidden() }
  await expect(ready).toBeVisible()
  const frame = page.frameLocator('iframe[name="editor-canvas"]')
  await expect(frame.getByRole('document', { name: 'Block: Heading 2', exact: true })).toBeVisible()
  return frame
}
async function setMetaPane(page: Page, expanded: boolean) {
  const button = page.getByRole('button', { name: 'Meta Boxes', exact: true })
  if ((await button.getAttribute('aria-expanded') === 'true') !== expanded) await button.press('Enter')
}
async function settings(page: Page) {
  const button = page.getByRole('button', { name: 'Settings', exact: true })
  if (await button.getAttribute('aria-pressed') !== 'true') await button.click()
}
async function advanced(page: Page) {
  const button = page.getByRole('button', { name: 'Advanced', exact: true })
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click()
}
async function saveDraft(page: Page) {
  const oldNotice = page.getByRole('button', { name: 'Dismiss this notice', exact: true }).filter({ hasText: 'Draft saved.' })
  if (await oldNotice.isVisible()) await oldNotice.click()
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Dismiss this notice', exact: true }).filter({ hasText: 'Draft saved.' })).toBeVisible()
}
async function currentPartState(page: Page) {
  return page.evaluate(() => {
    const wordpress = window as unknown as { wp: { data: { select(store: 'core/editor'): {
      getCurrentPost(): { slug?: string }
      getCurrentPostType(): string
      isEditedPostDirty(): boolean
      isSavingPost(): boolean
      didPostSaveRequestSucceed(): boolean
    } } } }
    const editor = wordpress.wp.data.select('core/editor')
    return { type: editor.getCurrentPostType(), slug: editor.getCurrentPost().slug, dirty: editor.isEditedPostDirty(), saving: editor.isSavingPost(), saveSucceeded: editor.didPostSaveRequestSucceed() }
  })
}
function retained(state: WordPressEditorState) {
  return { page: state.page, nativeContent: state.nativeContent, actorCapabilities: state.actor.capabilities }
}

test('TC-DELIVERY-WP-EDITOR-001: native editor changes survive an actual local theme rebuild', async ({ page, context }, testInfo) => {
  test.skip(!process.env.OM_WP_EDITOR_CONFIG, 'not_run/environment: owned WordPress operator configuration is required')
  if (testInfo.timeout < 900_000 || testInfo.project.retries !== 0) throw new Error('[internal] wordpress_editor_requires_cli_timeout_900000_and_retries_0')
  await checkpoint(testInfo, 'native_prepare')
  fixture = await createWordPressBrowserFixture()
  const { report: prepared, credentials } = await fixture.prepare()
  const marker = prepared.actor.login.replace(/-actor$/, '')
  await checkpoint(testInfo, 'first_theme_build')
  const firstBuild = await fixture.updateTheme(`${fixture.input.fixtureId}-before`, 'before')
  await testInfo.attach('wordpress-first-theme-build', { body: JSON.stringify(firstBuild), contentType: 'application/json' })
  await checkpoint(testInfo, 'actor_login')
  const editorUrl = `${fixture.siteUrl}/wp-admin/post.php?post=${prepared.page.id}&action=edit`
  await page.goto(`${fixture.siteUrl}/wp-login.php?redirect_to=${encodeURIComponent(editorUrl)}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('textbox', { name: 'Username or Email Address', exact: true }).fill(credentials.login)
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(credentials.password)
  await page.getByRole('button', { name: 'Log In', exact: true }).click()
  await page.waitForURL(editorUrl)
  for (const pathname of ['/wp-admin/plugins.php', '/wp-admin/users.php']) expect((await context.request.get(`${fixture.siteUrl}${pathname}`)).status()).toBe(403)
  await checkpoint(testInfo, 'native_text_edits')
  let canvas = await openEditor(page, fixture.siteUrl, prepared.page.id)
  await setMetaPane(page, false)
  await canvas.getByRole('document', { name: 'Block: Heading 2', exact: true }).fill('Browser-edited heading')
  await canvas.getByRole('document', { name: 'Block: Paragraph', exact: true }).filter({ hasText: 'Editable native section' }).fill('Browser-edited native section')
  await canvas.getByRole('textbox', { name: 'Button text', exact: true }).fill('Browser-edited CTA')
  await checkpoint(testInfo, 'image_replacement')
  const imageBlock = canvas.getByRole('document', { name: 'Block: Image', exact: true })
  await expect(imageBlock).toBeVisible()
  await imageBlock.focus()
  await settings(page)
  const replacement = prepared.resources.find((resource) => resource.kind === 'replacement')
  expect(replacement?.id).toBeGreaterThan(0)
  const replaceButton = page.getByRole('toolbar', { name: 'Block tools' }).getByRole('button', { name: 'Replace', exact: true })
  await expect(replaceButton).toBeVisible()
  await expect(replaceButton).toBeEnabled()
  await replaceButton.click()
  await page.getByRole('menuitem', { name: 'Open Media Library', exact: true }).click()
  const mediaLibrary = page.getByRole('dialog', { name: 'Select or Upload Media', exact: true })
  await mediaLibrary.getByRole('tab', { name: 'Media Library', exact: true }).click()
  await mediaLibrary.getByRole('searchbox', { name: 'Search media', exact: true }).fill(`${marker}-replacement`)
  await mediaLibrary.getByRole('checkbox', { name: `${marker}-replacement`, exact: true }).click()
  await expect(mediaLibrary.getByRole('textbox', { name: 'File URL:', exact: true })).toHaveValue(new RegExp(`${marker}-replacement\\.png$`))
  await mediaLibrary.getByRole('button', { name: 'Select', exact: true }).click()
  await expect(mediaLibrary).toBeHidden()
  await page.getByRole('textbox', { name: 'Alternative text', exact: true }).fill('Browser-edited image description')
  await page.getByRole('toolbar', { name: 'Block tools' }).getByRole('button', { name: 'Move up', exact: true }).click()
  await checkpoint(testInfo, 'section_add_reorder_delete')
  await canvas.getByRole('document', { name: 'Block: Image', exact: true }).press('Enter')
  await canvas.getByRole('document', { name: 'Empty block; start writing or type forward slash to choose a block', exact: true }).fill('Browser-added section')
  await page.getByRole('toolbar', { name: 'Block tools' }).getByRole('button', { name: 'Paragraph', exact: true }).click()
  await page.getByRole('menu', { name: 'Paragraph', exact: true }).getByRole('menuitem', { name: 'Group', exact: true }).click()
  await page.getByRole('toolbar', { name: 'Block tools' }).getByRole('button', { name: 'Move up', exact: true }).click()
  await advanced(page)
  await page.getByRole('combobox', { name: 'HTML element', exact: true }).selectOption({ label: '<section>' })
  await page.getByRole('toolbar', { name: 'Block tools' }).getByRole('button', { name: 'Options', exact: true }).click()
  await page.getByRole('menu', { name: 'Options', exact: true }).getByRole('menuitem', { name: /^Duplicate / }).click()
  await canvas.getByRole('document', { name: 'Block: Paragraph', exact: true }).filter({ hasText: 'Browser-added section' }).last().fill('Browser-removed section')
  await saveDraft(page)
  await canvas.getByRole('document', { name: 'Block: Paragraph', exact: true }).filter({ hasText: 'Browser-removed section' }).focus()
  await page.getByRole('toolbar', { name: 'Block tools' }).getByRole('button', { name: 'Select parent block: Group', exact: true }).click()
  await page.getByRole('toolbar', { name: 'Block tools' }).getByRole('button', { name: 'Options', exact: true }).click()
  await page.getByRole('menu', { name: 'Options', exact: true }).getByRole('menuitem', { name: /^Delete / }).click()
  await saveDraft(page)
  await expect(canvas.getByRole('document', { name: 'Block: Paragraph', exact: true }).filter({ hasText: 'Browser-removed section' })).toHaveCount(0)
  await canvas.getByRole('document', { name: 'Block: Heading 2', exact: true }).focus()
  await page.getByRole('toolbar', { name: 'Block tools' }).getByRole('button', { name: 'Select parent block: Group', exact: true }).click()
  await advanced(page)
  await page.getByRole('textbox', { name: 'Additional CSS class(es)', exact: true }).fill('p-8')
  await page.getByRole('combobox', { name: 'HTML element', exact: true }).selectOption({ label: '<section>' })
  await checkpoint(testInfo, 'acf_seo_save_draft')
  await setMetaPane(page, true)
  await page.getByRole('textbox', { name: 'Delivery fixture text', exact: true }).fill('Browser-edited ACF value')
  const seo = page.getByRole('region', { name: 'Meta Boxes', exact: true }).getByRole('region', { name: 'Yoast SEO', exact: true })
  await seo.getByRole('combobox', { name: 'SEO title', exact: true }).fill('Browser-edited SEO title')
  await seo.getByRole('combobox', { name: 'Meta description', exact: true }).fill('Browser-edited SEO description')
  await saveDraft(page)
  await checkpoint(testInfo, 'global_styles')
  await page.goto(`${fixture.siteUrl}/wp-admin/site-editor.php`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Styles', exact: true }).click()
  await page.getByRole('button', { name: 'Layout', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Top block spacing', exact: true }).fill('1.5')
  await page.getByRole('spinbutton', { name: 'Top block spacing', exact: true }).press('Tab')
  await page.getByRole('button', { name: 'Review 1 change…', exact: true }).click()
  const styleReview = page.getByRole('dialog', { name: 'Review changes', exact: true })
  await expect(styleReview.getByRole('checkbox')).toHaveCount(1)
  await styleReview.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(styleReview).toBeHidden()
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible()
  await checkpoint(testInfo, 'publish_and_readback')
  canvas = await openEditor(page, fixture.siteUrl, prepared.page.id)
  await page.getByRole('region', { name: 'Editor top bar' }).getByRole('button', { name: 'Publish', exact: true }).click()
  await page.getByRole('region', { name: 'Editor publish' }).getByRole('button', { name: 'Publish', exact: true }).click()
  const viewPage = page.getByRole('region', { name: 'Editor top bar' }).getByRole('link', { name: 'View Page', exact: true })
  await expect(viewPage).toBeVisible()
  const pageUrl = await viewPage.getAttribute('href')
  expect(pageUrl?.startsWith(`${fixture.siteUrl}/`)).toBe(true)
  canvas = await openEditor(page, fixture.siteUrl, prepared.page.id, false)
  await setMetaPane(page, false)
  await checkpoint(testInfo, 'published_navigation_and_parts')
  await canvas.getByRole('document', { name: 'Block: Navigation', exact: true }).click()
  const navigationLabel = canvas.getByRole('textbox', { name: 'Navigation link text', exact: true })
  await navigationLabel.click()
  await navigationLabel.press('ControlOrMeta+A')
  await navigationLabel.pressSequentially('Browser-edited menu')
  await page.getByRole('region', { name: 'Editor top bar' }).getByRole('button', { name: 'Save', exact: true }).click()
  const saveNavigation = page.getByRole('dialog', { name: 'Are you ready to save?', exact: true })
  await expect(saveNavigation.getByRole('checkbox')).toHaveCount(1)
  await expect(saveNavigation.getByRole('checkbox', { name: `${marker}-navigation`, exact: true })).toBeChecked()
  await saveNavigation.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(saveNavigation).toBeHidden()
  for (const kind of ['header', 'footer']) {
    await checkpoint(testInfo, `edit_original_${kind}`)
    canvas = page.frameLocator('iframe[name="editor-canvas"]')
    await canvas.getByRole('document', { name: `Block: ${marker}-${kind}`, exact: true }).click()
    await page.getByRole('toolbar', { name: 'Block tools' }).getByRole('button', { name: 'Edit original', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Editor top bar' }).getByRole('button', { name: `${marker}-${kind} · Template Part`, exact: true })).toBeVisible()
    canvas = page.frameLocator('iframe[name="editor-canvas"]')
    const paragraph = canvas.getByRole('document', { name: 'Block: Paragraph', exact: true })
    await expect(paragraph).toHaveText(`Editable fixture ${kind}`)
    await paragraph.click()
    await paragraph.press('ControlOrMeta+A')
    await paragraph.pressSequentially(`Browser-edited ${kind}`)
    const expectedPart = { type: 'wp_template_part', slug: `${marker}-${kind}` }
    await expect.poll(() => currentPartState(page)).toMatchObject({ ...expectedPart, dirty: true, saving: false })
    const savePart = page.getByRole('region', { name: 'Editor top bar' }).getByRole('button', { name: 'Save', exact: true })
    await expect(savePart).toBeEnabled()
    await savePart.click()
    await expect.poll(() => currentPartState(page)).toMatchObject({ ...expectedPart, dirty: false, saving: false, saveSucceeded: true })
    await testInfo.attach(`wordpress-saved-${kind}`, { body: JSON.stringify(await currentPartState(page)), contentType: 'application/json' })
    await page.getByRole('region', { name: 'Editor top bar' }).getByRole('button', { name: 'Back', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Editor top bar' }).getByRole('link', { name: 'View Page', exact: true })).toBeVisible()
  }
  await page.goto('about:blank')
  const before = await fixture.read()
  await testInfo.attach('wordpress-before-readback', { body: JSON.stringify(retained(before)), contentType: 'application/json' })
  expect(before.page.acf).toBe('Browser-edited ACF value')
  expect(before.page.seoTitle).toBe('Browser-edited SEO title')
  expect(before.page.seoDescription).toBe('Browser-edited SEO description')
  for (const content of ['Browser-edited heading', 'Browser-edited native section', 'Browser-edited CTA', 'Browser-added section', 'Browser-edited image description']) expect(before.page.content).toContain(content)
  expect(before.page.content).not.toContain('Browser-removed section')
  expect(before.page.content).toContain(`\"id\":${replacement!.id}`)
  expect(before.page.content.indexOf('Browser-added section')).toBeLessThan(before.page.content.indexOf('<!-- wp:image'))
  for (const kind of ['header', 'footer']) expect(before.nativeContent[kind]?.content).toContain(`Browser-edited ${kind}`)
  expect(before.nativeContent.navigation?.content).toContain('Browser-edited menu')
  expect(JSON.parse(before.nativeContent.styles!.content).styles.spacing.blockGap).toBe('1.5rem')
  await checkpoint(testInfo, 'second_theme_build_and_retention')
  const secondBuild = await fixture.updateTheme(`${fixture.input.fixtureId}-after`, 'after')
  expect(secondBuild.files[0]?.sha256).not.toBe(firstBuild.files[0]?.sha256)
  expect(secondBuild.cssHash).not.toBe(firstBuild.cssHash)
  const after = await fixture.read()
  expect(retained(after)).toEqual(retained(before))
  canvas = await openEditor(page, fixture.siteUrl, prepared.page.id, false)
  const mainGroup = canvas.getByRole('document', { name: 'Block: Group', exact: true }).filter({ hasText: 'Browser-edited heading' })
  const iframePadding = await mainGroup.evaluate((element) => getComputedStyle(element).paddingTop)
  expect(iframePadding).toBe('32px')
  const iframeStylesheet = await canvas.locator('link#om-delivery-tailwind-css').getAttribute('href')
  expect(new URL(iframeStylesheet!, fixture.siteUrl).searchParams.get('ver')).toBe(secondBuild.cssHash)
  await checkpoint(testInfo, 'frontend_iframe_seo_sitemap')
  const frontend = await context.newPage()
  try {
    const response = await frontend.goto(pageUrl!, { waitUntil: 'domcontentloaded' })
    expect(response?.status()).toBe(200)
    await expect(frontend.getByRole('heading', { name: 'Browser-edited heading', exact: true })).toBeVisible()
    const frontPadding = await frontend.getByRole('main').evaluate((element) => getComputedStyle(element).paddingTop)
    expect(frontPadding).toBe('32px')
    const frontendStylesheet = await frontend.locator('link#om-delivery-tailwind-css').getAttribute('href')
    expect(new URL(frontendStylesheet!, fixture.siteUrl).searchParams.get('ver')).toBe(secondBuild.cssHash)
    await expect(frontend.getByRole('link', { name: 'Browser-edited CTA', exact: true })).toHaveAttribute('href', '#fixture-content')
    const visibleImage = frontend.getByRole('img', { name: 'Browser-edited image description', exact: true })
    await visibleImage.scrollIntoViewIfNeeded()
    await expect.poll(() => visibleImage.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    const image = await visibleImage.evaluate((element) => ({ complete: (element as HTMLImageElement).complete, width: (element as HTMLImageElement).naturalWidth }))
    expect(image.complete).toBe(true); expect(image.width).toBeGreaterThan(0)
    const seoOutput = await frontend.evaluate(() => ({ title: document.title, description: document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content, robots: Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="robots"]')).map((element) => element.content), canonical: document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? null }))
    expect(seoOutput.title).toBe('Browser-edited SEO title')
    expect(seoOutput.description).toBe('Browser-edited SEO description')
    expect(seoOutput.robots.some((value) => value.includes('noindex'))).toBe(true)
    expect(seoOutput.canonical).toBeNull()
    const sitemapIndex = await context.request.get(`${fixture.siteUrl}/sitemap_index.xml`)
    expect(sitemapIndex.status()).toBe(200)
    const sitemapXml = await sitemapIndex.text()
    expect(sitemapXml).toContain('<sitemapindex')
    const sitemapUrls = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]!.replaceAll('&amp;', '&'))
    expect(sitemapUrls.length).toBeLessThanOrEqual(10)
    const sitemapChildren: Array<{ path: string; status: number; containsFixture: boolean }> = []
    for (const url of sitemapUrls) {
      expect(new URL(url).origin).toBe(fixture.siteUrl)
      const response = await context.request.get(url)
      const content = await response.text()
      expect(response.status()).toBe(200)
      sitemapChildren.push({ path: new URL(url).pathname, status: response.status(), containsFixture: content.includes(marker) })
    }
    expect(sitemapChildren.find((entry) => entry.path === '/page-sitemap.xml')?.containsFixture).toBe(true)
    await testInfo.attach('wordpress-editor-retention', { body: JSON.stringify({ schemaVersion: 1, provenance: 'live_browser_fixture_design', fixtureId: fixture.input.fixtureId, siteId: fixture.input.handle.siteId, runtimeIdentity: 'observed_owned_local_site', beforeHash: digest(retained(before)), afterHash: digest(retained(after)), firstBuild, secondBuild, iframePadding, frontPadding, iframeStylesheet, frontendStylesheet, seoOutput, sitemapChildren, canonicalPolicy: 'suppressed_by_observed_Yoast_noindex_guard', media: 'owned_replacement_alt_and_rendering', mediaReplacement: 'passed', sectionAddReorderDelete: 'passed', adminPagesDenied: 'passed', sitemapPrivacy: 'not_provided_by_noindex', designApproval: 'not_evaluated', nativeFixtureCleanup: 'pending_afterEach', themeUpdate: 'retained_intentionally' }), contentType: 'application/json' })
    await frontend.screenshot({ path: testInfo.outputPath('wordpress-desktop.png'), fullPage: true })
    await frontend.setViewportSize({ width: 390, height: 844 })
    await expect(frontend.getByRole('heading', { name: 'Browser-edited heading', exact: true })).toBeVisible()
    await frontend.screenshot({ path: testInfo.outputPath('wordpress-mobile.png'), fullPage: true })
  } finally { await frontend.close() }
})
