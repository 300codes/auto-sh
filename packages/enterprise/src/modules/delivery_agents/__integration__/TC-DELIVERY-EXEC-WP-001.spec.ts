import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { z } from 'zod'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { uploadAttachmentFixture } from '@open-mercato/core/helpers/integration/attachmentsFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { openRoundtrip, readRoundtripConfig, sha256 } from '@open-mercato/core/modules/delivery_os/__integration__/wordpress_manual/manualRoundtrip'

/**
 * TC-DELIVERY-EXEC-WP-001 — automatic OM → WordPress → OM through the delivery_agents worker and Cezar.
 *
 * Opt-in: needs a running app with delivery_agents enabled, DELIVERY_WP_HOST_CONFIG on the app,
 * OM_WP_MANUAL_ROUNDTRIP_CONFIG (owned Studio site tooling, same sitesRoot/stateRoot) here, a logged-in
 * Studio CLI and an agent CLI Cezar can drive. The approved base theme carries the smoke test and the
 * composer lint script; the agent may only edit templates/parts/assets.
 */

const DELIVERY = '/api/delivery_os'
const AGENTS = '/api/delivery_agents'
const lockHeader = 'x-om-ext-optimistic-lock-expected-updated-at'
const THEME_SLUG = 'qa-technical-roundtrip'
const TEST_ID = 'front page AC-001: services section names Design, Build and Hosting'
const entitySchema = z.object({ id: z.uuid(), updatedAt: z.string() })
const attemptSchema = z.object({ attemptId: z.string(), state: z.string(), resultEvidenceId: z.string().nullable().optional(), completionDelivery: z.string().nullable().optional() }).passthrough()

const SMOKE_TEST = `const { test, expect } = require('@playwright/test')
const fs = require('fs')
const path = require('path')

test(${JSON.stringify(TEST_ID)}, () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'templates', 'front-page.html'), 'utf8')
  for (const service of ['Design', 'Build', 'Hosting']) expect(html).toContain(service)
})
`
const COMPOSER = `${JSON.stringify({ name: 'open-mercato/qa-technical-roundtrip', description: 'Delivery QA theme', scripts: { lint: 'php -l functions.php' } }, null, 2)}\n`

test('automatic WP execution: Cezar edits the owned theme, checks run on frozen bytes, review verifies', async ({ request, page }, testInfo) => {
  const configFile = process.env.OM_WP_MANUAL_ROUNDTRIP_CONFIG
  test.skip(!configFile || process.env.OM_DELIVERY_EXEC_WP_LIVE !== '1', 'not_run: set OM_WP_MANUAL_ROUNDTRIP_CONFIG and OM_DELIVERY_EXEC_WP_LIVE=1 against an app with DELIVERY_WP_HOST_CONFIG')
  expect(testInfo.timeout, 'run with --timeout=3600000').toBeGreaterThanOrEqual(3_600_000)
  expect(testInfo.project.retries, 'owned Studio scenario requires --retries=0').toBe(0)
  const config = await readRoundtripConfig(configFile!)
  const token = await getAuthToken(request, 'admin')
  const tokenScope = z.object({ tenantId: z.uuid(), organizationId: z.uuid() }).parse(getTokenContext(token))
  const call = async (method: string, route: string, expected: number, data?: unknown, headers?: Record<string, string>) => {
    const response = await apiRequest(request, method, route, { token, data, headers })
    const body = (await readJsonSafe<Record<string, unknown>>(response)) ?? {}
    expect(response.status(), `${method} ${route}: ${JSON.stringify(body).slice(0, 400)}`).toBe(expected)
    return body
  }
  const version = async (kind: 'projects' | 'tasks', id: string) => z.string().parse((await call('GET', `${DELIVERY}/${kind}/${id}`, 200)).updatedAt)

  const projectName = `WP automatic execution ${randomUUID()}`
  const project = entitySchema.parse(await call('POST', `${DELIVERY}/projects`, 201, { name: projectName, inputMode: 'from_brief', targetProfileId: 'wordpress-theme', brief: 'Automatic Cezar execution on an owned Studio site.' }))
  const scope = { ...tokenScope, projectId: project.id }
  const fixture = await openRoundtrip(config, scope)
  let attachmentId: string | undefined
  const cleanup: Array<{ resource: string; state: string }> = []
  try {
    const site = await fixture.create()
    const themePath = path.join(config.sitesRoot, fixture.siteId, 'wp-content', 'themes', THEME_SLUG)
    await fs.mkdir(path.join(themePath, 'tests'), { recursive: true })
    await fs.writeFile(path.join(themePath, 'tests', 'smoke.spec.js'), SMOKE_TEST)
    await fs.writeFile(path.join(themePath, 'composer.json'), COMPOSER)
    await fixture.write('seeded-base.json', { tests: sha256(SMOKE_TEST), composer: sha256(COMPOSER) })

    await page.setViewportSize({ width: 1280, height: 800 })
    expect((await page.goto(site.localUrl, { waitUntil: 'load' }))?.ok()).toBe(true)
    const screenshot = await page.screenshot({ fullPage: false })
    const attachment = await uploadAttachmentFixture(request, token, { entityId: 'delivery_os:delivery_project', recordId: project.id, fileName: 'base-reference.png', mimeType: 'image/png', buffer: screenshot })
    attachmentId = attachment.id
    const draftSpec = {
      requirements: [{ id: 'REQ-SERVICES', title: 'Front page presents the studio services' }],
      acceptanceCriteria: [{ id: 'AC-001', requirementId: 'REQ-SERVICES', description: 'The front-page template names the three services: Design, Build and Hosting.' }],
      screens: [{ fileKey: null, nodeId: null, name: 'Owned-site base reference', viewport: { width: 1280, height: 800 }, attachmentId, sha256: sha256(screenshot), capturedAt: new Date().toISOString() }],
      tokens: {}, architectureSummary: 'Owned WP block theme edited by Cezar; checks run on frozen snapshot copies.',
      planSummary: 'One automatic attempt through delivery_agents, then a human-style review.',
      acTestMap: { 'AC-001': [TEST_ID] }, manualChecks: {},
      declaredTests: [{ testId: TEST_ID, file: 'tests/smoke.spec.js' }], attachments: [{ attachmentId, sha256: sha256(screenshot) }],
    }
    await call('PUT', `${DELIVERY}/projects`, 200, { id: project.id, draftSpec }, { [lockHeader]: await version('projects', project.id) })
    const baseline = z.object({ baselineId: z.uuid(), contentHash: z.string(), version: z.number() }).parse(await call('POST', `${DELIVERY}/projects/${project.id}/baselines`, 201, { source: 'manual' }, { [lockHeader]: await version('projects', project.id) }))
    for (const kind of ['requirements', 'design']) {
      await call('POST', `${DELIVERY}/baselines/${baseline.baselineId}/decisions`, 201, { kind, verdict: 'approved', subjectHash: baseline.contentHash, subjectVersion: baseline.version }, { [lockHeader]: await version('projects', project.id) })
    }
    const task = entitySchema.parse(await call('POST', `${DELIVERY}/projects/${project.id}/tasks`, 201, { source: 'manual', baselineId: baseline.baselineId, title: 'Name the three services on the front page', acIds: ['AC-001'], allowedPaths: ['templates/**', 'parts/**', 'assets/**'], dependsOnTaskIds: [] }))
    await call('PUT', `${DELIVERY}/tasks`, 200, { id: task.id, status: 'ready' }, { [lockHeader]: task.updatedAt })

    const base = await fixture.capture()
    const baseRevision = base.snapshot.sourceRevision
    expect(baseRevision.kind).toBe('snapshot')
    const frozenBase = (await fixture.read(base)).artifacts
    expect(Object.keys(frozenBase.theme)).toEqual(expect.arrayContaining(['tests/smoke.spec.js', 'composer.json', 'templates/front-page.html']))
    await fixture.write('base-receipt.json', { receiptId: base.receiptId, baseRevision })

    const execution = await call('POST', `${AGENTS}/tasks/${task.id}/execute`, 202, { idempotencyKey: `exec-${fixture.runId}`, baseRevision }, { [lockHeader]: await version('tasks', task.id) })
    const attemptId = z.string().parse(execution.attemptId)
    await fixture.write('execution.json', execution)

    const deadline = Date.now() + 55 * 60 * 1000
    let attempt: z.infer<typeof attemptSchema> | undefined
    let taskStatus = ''
    while (Date.now() < deadline) {
      const current = await call('GET', `${DELIVERY}/tasks/${task.id}`, 200)
      taskStatus = String(current.status)
      attempt = z.array(attemptSchema).parse(current.executionAttempts ?? []).find((entry) => entry.attemptId === attemptId)
      if (attempt?.resultEvidenceId || ['reconciliation_required', 'cancelled', 'closed'].includes(String(attempt?.state))) break
      await new Promise((resolve) => setTimeout(resolve, 10_000))
    }
    await fixture.write('attempt-after-execution.json', { taskStatus, attempt })
    expect(attempt?.resultEvidenceId, `attempt ${JSON.stringify(attempt)}`).toBeTruthy()
    expect(taskStatus).toBe('awaiting_review')

    const evidence = await call('GET', `${DELIVERY}/projects/${project.id}/evidence/${attempt!.resultEvidenceId}`, 200)
    await fixture.write('result-evidence.json', evidence)
    const reviewed = await call('POST', `${DELIVERY}/projects/${project.id}/evidence`, 201, { baselineId: baseline.baselineId, kind: 'review', taskId: task.id, attemptId, sourceRevision: (evidence as { sourceRevision?: unknown }).sourceRevision, payload: { verdict: 'approved', summary: 'Automatic Cezar execution reviewed: required smoke test and PHP lint passed on frozen bytes.', findings: [], reviewer: { kind: 'agent', ref: 'tc-delivery-exec-wp-001' }, reviewedEvidenceId: attempt!.resultEvidenceId } })
    expect(reviewed.taskStatus).toBe('verified')

    const deliveryDeadline = Date.now() + 5 * 60 * 1000
    let delivery: string | null | undefined
    while (Date.now() < deliveryDeadline) {
      const current = await call('GET', `${DELIVERY}/tasks/${task.id}`, 200)
      delivery = z.array(attemptSchema).parse(current.executionAttempts ?? []).find((entry) => entry.attemptId === attemptId)?.completionDelivery
      if (delivery === 'delivered' || delivery === 'failed') break
      await new Promise((resolve) => setTimeout(resolve, 5_000))
    }
    await fixture.write('outcome.json', { status: 'passed', projectId: project.id, taskId: task.id, attemptId, completionDelivery: delivery ?? null, proofScope: 'automatic Cezar execution on an owned Studio theme with frozen-byte checks; no visual acceptance, Preview or release' })
    expect(delivery).toBe('delivered')
  } finally {
    const failures: string[] = []
    try { await page.close() } catch { failures.push('browser_close_failed') }
    try { await fixture.stop(); cleanup.push({ resource: fixture.siteId, state: 'stopped_retained_for_explicit_disposal' }) } catch { failures.push('owned_site_stop_failed') }
    try {
      await withClient(async (client) => {
        await client.query('BEGIN')
        try {
          const proof = await client.query('select id from delivery_projects where id=$1 and tenant_id=$2 and organization_id=$3 and name=$4 for update', [project.id, scope.tenantId, scope.organizationId, projectName])
          if (proof.rows.length !== 1) throw new Error('[internal] exec_wp_cleanup_scope_mismatch')
          for (const table of ['delivery_release_candidates', 'delivery_evidence', 'delivery_decisions', 'delivery_tasks', 'delivery_baselines']) {
            await client.query(`delete from ${table} where project_id=$1 and tenant_id=$2 and organization_id=$3`, [project.id, scope.tenantId, scope.organizationId])
          }
          await client.query('delete from delivery_projects where id=$1 and tenant_id=$2 and organization_id=$3', [project.id, scope.tenantId, scope.organizationId])
          await client.query('COMMIT')
        } catch (error) { await client.query('ROLLBACK'); throw error }
      })
      cleanup.push({ resource: project.id, state: 'owned_domain_rows_removed_audit_history_retained' })
    } catch { failures.push('owned_project_cleanup_failed') }
    if (attachmentId) {
      const response = await apiRequest(request, 'DELETE', `/api/attachments?id=${attachmentId}`, { token }).catch(() => null)
      cleanup.push({ resource: attachmentId, state: response && [200, 204].includes(response.status()) ? 'deleted' : 'retained' })
    }
    await fixture.write('cleanup.json', { resources: cleanup, failures }).catch(() => undefined)
    expect(failures).toEqual([])
  }
})
