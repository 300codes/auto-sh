import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { z } from 'zod'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { uploadAttachmentFixture } from '@open-mercato/core/helpers/integration/attachmentsFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { taskPackageV1Schema } from '../../lib/contracts'
import { mapRoundtripResult, openRoundtrip, readRoundtripConfig, sha256, smokeTestIds } from './manualRoundtrip'

const API = '/api/delivery_os'
const lockHeader = 'x-om-ext-optimistic-lock-expected-updated-at'
const entitySchema = z.object({ id: z.uuid(), updatedAt: z.string() })

test('manual WP snapshot → OSS correction → verified, technical frozen-byte checks only', async ({ request, page }, testInfo) => {
  const configFile = process.env.OM_WP_MANUAL_ROUNDTRIP_CONFIG
  test.skip(!configFile, 'not_run: explicit private OM_WP_MANUAL_ROUNDTRIP_CONFIG is required')
  expect(testInfo.timeout, 'run this opt-in scenario with --timeout=1800000').toBeGreaterThanOrEqual(1800000)
  expect(testInfo.project.retries, 'owned Studio scenario requires --retries=0').toBe(0)
  const config = await readRoundtripConfig(configFile!)
  expect(process.env.DATABASE_URL, 'fixture cleanup requires the same private DB as the app').toBeTruthy()
  expect(process.env.BASE_URL, 'explicit target app is required').toBeTruthy()
  const token = await getAuthToken(request, 'admin')
  const tokenScope = z.object({ tenantId: z.uuid(), organizationId: z.uuid() }).parse(getTokenContext(token))
  let cleanupStarted = false
  const call = async (method: string, route: string, expected: number, data?: unknown, headers?: Record<string, string>) => {
    if (cleanupStarted) throw new Error('[internal] wordpress_roundtrip_closing')
    const response = await apiRequest(request, method, route, { token, data, headers })
    expect(response.status(), `${method} ${route}`).toBe(expected)
    return (await readJsonSafe<Record<string, unknown>>(response)) ?? {}
  }
  const version = async (kind: 'projects' | 'tasks', id: string) => {
    const row = await call('GET', `${API}/${kind}/${id}`, 200)
    return z.string().parse(row.updatedAt)
  }
  const projectName = `WP manual technical ${randomUUID()}`
  const project = entitySchema.parse(await call('POST', `${API}/projects`, 201, { name: projectName, inputMode: 'from_brief', targetProfileId: 'wordpress-theme', brief: 'Two technical frozen-byte ACs; not a visual design acceptance or a release.' }))
  const scope = { ...tokenScope, projectId: project.id }
  let fixture: Awaited<ReturnType<typeof openRoundtrip>> | undefined
  let siteCreationAttempted = false
  let attachmentId: string | undefined
  const cleanup: Array<{ resource: string; state: string }> = []
  try {
    await withClient(async client => {
      const proof = await client.query('select id from delivery_projects where id=$1 and tenant_id=$2 and organization_id=$3 and name=$4', [project.id, scope.tenantId, scope.organizationId, projectName])
      expect(proof.rows).toHaveLength(1)
    })
    fixture = await openRoundtrip(config, scope)
    await fixture.write('runner.json', { timeout: testInfo.timeout, retries: testInfo.project.retries, retry: testInfo.retry, proofScope: 'technical frozen-byte checks only' })
    siteCreationAttempted = true
    const site = await fixture.create()
    await page.setViewportSize({ width: 1280, height: 800 })
    const response = await page.goto(site.localUrl, { waitUntil: 'load' })
    expect(response?.ok()).toBe(true)
    expect(new URL(page.url()).origin).toBe(new URL(site.localUrl).origin)
    const screenshot = await page.screenshot({ fullPage: false })
    await fs.writeFile(path.join(fixture.directory, 'initial-technical-reference.png'), screenshot, { mode: 0o600 })
    const attachment = await uploadAttachmentFixture(request, token, { entityId: 'delivery_os:delivery_project', recordId: project.id, fileName: 'initial-technical-reference.png', mimeType: 'image/png', buffer: screenshot })
    attachmentId = attachment.id
    const imageHash = sha256(screenshot)
    const draftSpec = {
      requirements: [{ id: 'REQ-TECH', title: 'Frozen WordPress theme technical correctness' }],
      acceptanceCriteria: [
        { id: 'AC-001', requirementId: 'REQ-TECH', description: 'Frozen front-page template contains a native paragraph with this attempt marker.' },
        { id: 'AC-002', requirementId: 'REQ-TECH', description: 'Every captured theme PHP file passes php -l; functions.php exists.' },
      ],
      screens: [{ fileKey: null, nodeId: null, name: 'Initial owned-site technical reference; no visual acceptance criterion', viewport: { width: 1280, height: 800 }, attachmentId, sha256: imageHash, capturedAt: new Date().toISOString() }],
      tokens: {}, architectureSummary: 'Owned WP block theme; checks execute on immutable snapshot copies.',
      planSummary: 'Two manual attempts and an automated technical review. No FLOW, worker, deployment or visual quality proof.',
      acTestMap: { 'AC-001': [smokeTestIds[0]], 'AC-002': [smokeTestIds[1]] }, manualChecks: {},
      declaredTests: smokeTestIds.map(testId => ({ testId, file: 'tests/frozen-smoke.cjs' })), attachments: [{ attachmentId, sha256: imageHash }],
    }
    await call('PUT', `${API}/projects`, 200, { id: project.id, draftSpec }, { [lockHeader]: await version('projects', project.id) })
    const baseline = z.object({ baselineId: z.uuid(), contentHash: z.string(), version: z.number() }).parse(await call('POST', `${API}/projects/${project.id}/baselines`, 201, { source: 'manual' }, { [lockHeader]: await version('projects', project.id) }))
    for (const kind of ['requirements', 'design']) await call('POST', `${API}/baselines/${baseline.baselineId}/decisions`, 201, { kind, verdict: 'approved', subjectHash: baseline.contentHash, subjectVersion: baseline.version }, { [lockHeader]: await version('projects', project.id) })
    const task = entitySchema.parse(await call('POST', `${API}/projects/${project.id}/tasks`, 201, { source: 'manual', baselineId: baseline.baselineId, title: 'Frozen-byte technical checks and correction', acIds: ['AC-001', 'AC-002'], allowedPaths: ['templates/**', 'assets/**'] }))
    await call('PUT', `${API}/tasks`, 200, { id: task.id, status: 'ready' }, { [lockHeader]: task.updatedAt })
    let base = await fixture.capture()
    const attempts: string[] = []
    for (const round of [1, 2] as const) {
      const marker = `wp-roundtrip-${fixture.runId}-${round}`
      const reserved = z.object({ attemptId: z.uuid() }).parse(await call('POST', `${API}/tasks/${task.id}/attempts`, 201, { mode: 'manual_handoff', baseRevision: base.snapshot.sourceRevision }, { [lockHeader]: await version('tasks', task.id), 'Idempotency-Key': `${fixture.runId}-${round}` }))
      attempts.push(reserved.attemptId)
      const taskPackage = taskPackageV1Schema.parse(await call('GET', `${API}/tasks/${task.id}/package?attemptId=${reserved.attemptId}`, 200))
      await fixture.write(`attempt-${round}-package.json`, taskPackage)
      await fixture.update(base, marker)
      const result = await fixture.capture()
      if (result.snapshot.sourceRevision.kind !== 'snapshot' || base.snapshot.sourceRevision.kind !== 'snapshot') throw new Error('[internal] wordpress_roundtrip_snapshot_required')
      expect(result.snapshot.sourceRevision.contentHash).not.toBe(base.snapshot.sourceRevision.contentHash)
      await fixture.write(`attempt-${round}-receipts.json`, { base, result })
      const frozenBase = (await fixture.read(base)).artifacts
      const frozenResult = (await fixture.read(result)).artifacts
      const checks = await fixture.checks(marker, frozenResult, taskPackage)
      const manifest = mapRoundtripResult(taskPackage, scope, frozenBase, frozenResult, checks, `${fixture.runId}-${round}`)
      await fixture.write(`attempt-${round}-manifest.json`, manifest)
      const imported = await call('POST', `${API}/tasks/${task.id}/results`, 201, { attemptId: reserved.attemptId, manifest })
      expect(imported.taskStatus).toBe('awaiting_review')
      const verdict = round === 1 ? 'changes_requested' : 'approved'
      const reviewed = await call('POST', `${API}/projects/${project.id}/evidence`, 201, { baselineId: baseline.baselineId, kind: 'review', taskId: task.id, attemptId: reserved.attemptId, sourceRevision: manifest.resultRevision, payload: { verdict, summary: round === 1 ? 'Technical checks passed; exercise correction by requesting a new attempt marker and fresh checks.' : 'Both technical ACs passed on the corrected final snapshot. No visual or release acceptance.', findings: [], reviewer: { kind: 'agent', ref: 'manual-roundtrip-technical-harness' } } })
      expect(reviewed.taskStatus).toBe(round === 1 ? 'changes_requested' : 'verified')
      await fixture.write(`attempt-${round}-api-outcome.json`, { attemptId: reserved.attemptId, resultRevision: manifest.resultRevision, imported, reviewed })
      base = result
    }
    expect(new Set(attempts).size).toBe(2)
    expect((await call('GET', `${API}/tasks/${task.id}`, 200)).status).toBe('verified')
    await fixture.write('outcome.json', { status: 'passed', proofScope: 'manual technical correction roundtrip only', projectId: project.id, taskId: task.id, attempts, finalRevision: base.snapshot.sourceRevision })
  } finally {
    cleanupStarted = true
    const failures: string[] = []
    let projectRemoved = false
    try { await page.close() } catch { failures.push('browser_close_failed') }
    if (fixture && siteCreationAttempted) {
      try { await fixture.stop(); cleanup.push({ resource: fixture.siteId, state: 'stopped_retained_for_explicit_disposal' }) }
      catch { failures.push('owned_site_stop_failed'); cleanup.push({ resource: fixture.siteId, state: 'reconciliation_required' }) }
    }
    try {
      await withClient(async client => {
        await client.query('BEGIN')
        try {
          const proof = await client.query('select id from delivery_projects where id=$1 and tenant_id=$2 and organization_id=$3 and name=$4 for update', [project.id, scope.tenantId, scope.organizationId, projectName])
          if (proof.rows.length !== 1) throw new Error('[internal] wordpress_roundtrip_cleanup_scope_mismatch')
          for (const table of ['delivery_release_candidates', 'delivery_flow_stage_decisions', 'delivery_flow_stage_artifacts', 'delivery_intakes', 'delivery_evidence', 'delivery_decisions', 'delivery_tasks', 'delivery_baselines']) await client.query(`delete from ${table} where project_id=$1 and tenant_id=$2 and organization_id=$3`, [project.id, scope.tenantId, scope.organizationId])
          await client.query('delete from delivery_projects where id=$1 and tenant_id=$2 and organization_id=$3', [project.id, scope.tenantId, scope.organizationId])
          await client.query('COMMIT')
        } catch (error) { await client.query('ROLLBACK'); throw error }
      })
      projectRemoved = true
      cleanup.push({ resource: project.id, state: 'owned_domain_rows_removed_audit_history_retained' })
    } catch { failures.push('owned_project_cleanup_failed') }
    if (attachmentId && projectRemoved) {
      try {
        const response = await apiRequest(request, 'DELETE', `/api/attachments?id=${attachmentId}`, { token })
        expect([200, 204]).toContain(response.status())
        cleanup.push({ resource: attachmentId, state: 'deleted' })
      } catch { failures.push('owned_attachment_cleanup_failed') }
    } else if (attachmentId) {
      cleanup.push({ resource: attachmentId, state: 'retained_project_cleanup_incomplete' })
    }
    const report = { resources: cleanup, failures, physicalSiteCleanup: 'pending_explicit_disposal', noLiveProofUnlessScenarioPassed: true }
    if (fixture) await fixture.write('cleanup.json', report)
    await testInfo.attach('manual-roundtrip-cleanup', { body: JSON.stringify(report), contentType: 'application/json' })
    expect(failures, 'cleanup failed; inspect private ledger before retry').toEqual([])
  }
})
