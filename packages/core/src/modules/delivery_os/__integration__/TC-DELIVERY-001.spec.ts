import { createHash, randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { z } from 'zod'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { readDeliveryDbCounts } from '@open-mercato/core/helpers/integration/deliveryDbFixtures'
import { attachDeliveryEvidence, requireDeliveryResource, withDeliveryFixture } from '@open-mercato/core/helpers/integration/deliveryEvidence'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { buildResultManifest } from '../lib/fixtures/builders'
import { evidenceRecordResponseSchema } from '../api/schemas'

const projectListSchema = z.object({ items: z.array(z.object({ id: z.uuid() })) })

type RouteCase = {
  id: string
  method: string
  path: string
  data?: unknown
  updatedAt?: string
  idempotencyKey?: string
}

test('TC-DELIVERY-001: R1–R19 enforce authentication, features and tenant/organization scope without writes', async ({ request }, testInfo) => {
  await withDeliveryFixture(testInfo, async (fixture) => {
    const project = requireDeliveryResource(fixture.projects.A1)
    const baseline = await fixture.prepareBaseline(project)
    const task = await fixture.createTask(project, baseline.baselineId)
    const reservation = await fixture.reserveNeverDispatched(task.id)
    const projectBefore = await fixture.readProject(project)
    const taskBefore = await fixture.readTask(project.actor, task.id)
    const scope = { tenantId: project.tenantId, organizationId: project.organizationId }
    const noFeatures = await fixture.createActor(scope, 'no-features', [])
    const wildcard = await fixture.createActor(scope, 'wildcard', ['delivery_os.*'])
    const viewer = requireDeliveryResource(fixture.actors.viewer)
    const sentinel = {
      projectId: project.id, tenantId: project.tenantId, organizationId: project.organizationId,
      runId: fixture.namespace, projectName: projectBefore.name,
    }
    const before = await readDeliveryDbCounts(sentinel)
    if (!before.ok) {
      await attachDeliveryEvidence(testInfo, 'database-precondition', before)
      test.skip(true, `not_run/environment: ${before.reason}`)
      return
    }
    const routes: RouteCase[] = [
      { id: 'R1', method: 'GET', path: '/api/delivery_os/projects' },
      { id: 'R2', method: 'POST', path: '/api/delivery_os/projects', data: { name: `${fixture.namespace}-denied`, inputMode: 'from_brief', targetProfileId: 'react-vite', targetProfileVersion: 1 } },
      { id: 'R3', method: 'PUT', path: '/api/delivery_os/projects', data: { id: project.id, brief: 'Denied edit' }, updatedAt: projectBefore.updatedAt ?? undefined },
      { id: 'R4', method: 'DELETE', path: `/api/delivery_os/projects?id=${project.id}`, updatedAt: projectBefore.updatedAt ?? undefined },
      { id: 'R5', method: 'GET', path: `/api/delivery_os/projects/${project.id}` },
      { id: 'R6', method: 'GET', path: `/api/delivery_os/projects/${project.id}/baselines` },
      { id: 'R7', method: 'POST', path: `/api/delivery_os/projects/${project.id}/baselines`, data: { source: 'manual' }, updatedAt: projectBefore.updatedAt ?? undefined },
      { id: 'R8', method: 'POST', path: `/api/delivery_os/baselines/${baseline.baselineId}/decisions`, data: { kind: 'requirements', verdict: 'approved', subjectHash: baseline.contentHash, subjectVersion: baseline.version }, updatedAt: projectBefore.updatedAt ?? undefined },
      { id: 'R9', method: 'GET', path: `/api/delivery_os/projects/${project.id}/tasks` },
      { id: 'R10', method: 'POST', path: `/api/delivery_os/projects/${project.id}/tasks`, data: { source: 'manual', baselineId: baseline.baselineId, title: 'Denied task', acIds: ['AC-001'] } },
      { id: 'R11', method: 'GET', path: `/api/delivery_os/tasks/${task.id}` },
      { id: 'R12', method: 'PUT', path: '/api/delivery_os/tasks', data: { id: task.id, title: 'Denied edit' }, updatedAt: taskBefore.updatedAt },
      { id: 'R13', method: 'DELETE', path: `/api/delivery_os/tasks?id=${task.id}`, updatedAt: taskBefore.updatedAt },
      { id: 'R14', method: 'POST', path: `/api/delivery_os/tasks/${task.id}/attempts`, data: { mode: 'manual_handoff', baseRevision: reservation.taskPackage.baseRevision }, updatedAt: taskBefore.updatedAt, idempotencyKey: randomUUID() },
      { id: 'R15', method: 'GET', path: reservation.packageUrl },
      { id: 'R16', method: 'POST', path: `/api/delivery_os/tasks/${task.id}/results`, data: { attemptId: reservation.attemptId, manifest: buildResultManifest(reservation.taskPackage) } },
      { id: 'R17', method: 'POST', path: `/api/delivery_os/tasks/${task.id}/attempts/${reservation.attemptId}/cancel`, data: { reason: 'Denied cancellation' }, updatedAt: taskBefore.updatedAt },
      { id: 'R18', method: 'POST', path: `/api/delivery_os/tasks/${task.id}/attempts/${reservation.attemptId}/reconcile`, data: { resolution: 'not_started', externalEvidence: { note: 'Fixture has never dispatched this attempt', observedAt: new Date().toISOString() } }, updatedAt: taskBefore.updatedAt },
      { id: 'R19', method: 'POST', path: `/api/delivery_os/projects/${project.id}/evidence`, data: { kind: 'scan', baselineId: baseline.baselineId, sourceRevision: reservation.taskPackage.baseRevision, payload: { checkId: 'dependency-audit', scanner: 'fixture', status: 'not_run', rawReportHash: '0'.repeat(64) } } },
    ]
    const observations: Array<{ route: string; check: string; status: number }> = []
    for (const route of routes) {
      await test.step(`${route.id}: unauthenticated and missing feature`, async () => {
        const anonymous = await request.fetch(new URL(route.path, fixture.environment.baseUrl).href, {
          method: route.method, data: route.data, maxRedirects: 0,
          headers: {
            ...(route.updatedAt ? { [OPTIMISTIC_LOCK_HEADER_NAME]: route.updatedAt } : {}),
            ...(route.idempotencyKey ? { 'Idempotency-Key': route.idempotencyKey } : {}),
          },
        })
        observations.push({ route: route.id, check: 'unauthenticated', status: anonymous.status() })
        expect.soft(anonymous.status(), `${route.id}: anonymous access`).toBe(401)
        const deniedActor = route.method === 'GET' && route.id !== 'R15' ? noFeatures : viewer
        const denied = await fixture.request(deniedActor, route.method, route.path, { ...route, expectedStatus: 403 })
        observations.push({ route: route.id, check: 'missing-feature', status: denied.status() })
        expect.soft(denied.status(), `${route.id}: feature guard`).toBe(403)
      })
    }
    for (const foreignKey of ['A2', 'B1'] as const) {
      const foreignActor = requireDeliveryResource(fixture.operators[foreignKey])
      const foreignProject = requireDeliveryResource(fixture.projects[foreignKey])
      const listed = await fixture.request(foreignActor, 'GET', '/api/delivery_os/projects')
      expect(listed.status()).toBe(200)
      expect(projectListSchema.parse(await readJsonSafe(listed)).items.map((item) => item.id)).toEqual([foreignProject.id])
      for (const route of routes.filter((route) => route.id !== 'R1' && route.id !== 'R2')) {
        const versionedCrud = ['R3', 'R4', 'R12', 'R13'].includes(route.id)
        const expectedStatus = versionedCrud ? 409 : 404
        const response = await fixture.request(foreignActor, route.method, route.path, { ...route, expectedStatus })
        observations.push({ route: route.id, check: `foreign-${foreignKey}`, status: response.status() })
        expect.soft(response.status(), `${route.id}: foreign ${foreignKey} record`).toBe(expectedStatus)
        if (versionedCrud) {
          expect.soft(await readJsonSafe(response)).toMatchObject({
            code: 'optimistic_lock_conflict', currentUpdatedAt: route.updatedAt, expectedUpdatedAt: route.updatedAt,
          })
          const withoutVersion = await fixture.request(foreignActor, route.method, route.path, { ...route, updatedAt: undefined, expectedStatus: 404 })
          observations.push({ route: route.id, check: `foreign-${foreignKey}-without-version`, status: withoutVersion.status() })
          expect.soft(withoutVersion.status()).toBe(404)
        }
      }
      const invalidSelection = await fixture.request(project.actor, 'GET', `/api/delivery_os/projects/${project.id}`, {
        selectedOrganizationId: foreignProject.organizationId, expectedStatus: 422,
      })
      const selectionBody = await readJsonSafe(invalidSelection)
      observations.push({ route: 'R5', check: `invalid-selection-${foreignKey}`, status: invalidSelection.status() })
      expect.soft(invalidSelection.status()).toBe(422)
      expect.soft(selectionBody).toMatchObject({ code: 'organization_selection_invalid' })
    }
    for (const forbidden of [
      { actor: requireDeliveryResource(fixture.actors.attemptManager), route: requireDeliveryResource(routes.find((route) => route.id === 'R18')) },
      { actor: requireDeliveryResource(fixture.actors.reconciler), route: requireDeliveryResource(routes.find((route) => route.id === 'R17')) },
    ]) {
      const response = await fixture.request(forbidden.actor, forbidden.route.method, forbidden.route.path, { ...forbidden.route, expectedStatus: 403 })
      observations.push({ route: forbidden.route.id, check: 'attempt-feature-split', status: response.status() })
      expect.soft(response.status()).toBe(403)
    }
    for (const route of routes.filter((route) => route.method === 'GET')) {
      const response = await fixture.request(wildcard, route.method, route.path)
      observations.push({ route: route.id, check: 'wildcard-read', status: response.status() })
      expect.soft(response.status(), `${route.id}: wildcard grant`).toBe(200)
      if (route.id === 'R1' && response.status() === 200) {
        expect(projectListSchema.parse(await readJsonSafe(response)).items.map((item) => item.id)).toEqual([project.id])
      }
    }
    expect(await fixture.readProject(project)).toEqual(projectBefore)
    expect(await fixture.readTask(project.actor, task.id)).toEqual(taskBefore)
    const after = await readDeliveryDbCounts(sentinel)
    await attachDeliveryEvidence(testInfo, 'acl-scope-matrix', { before, after, observations, provenance: 'http-fixture-v1' })
    expect(after).toEqual(before)
    const foreignProject = requireDeliveryResource(fixture.projects.B1)
    const foreignBefore = await fixture.readProject(foreignProject)
    const spoofed = await fixture.request(wildcard, 'PUT', '/api/delivery_os/projects', {
      data: {
        id: project.id, brief: 'Wildcard mutation control', projectId: foreignProject.id,
        tenantId: foreignProject.tenantId, organizationId: foreignProject.organizationId,
      },
      updatedAt: projectBefore.updatedAt ?? undefined, expectedStatus: 403,
    })
    expect(spoofed.status()).toBe(403)
    expect(await fixture.readProject(project)).toEqual(projectBefore)
    expect(await fixture.readProject(foreignProject)).toEqual(foreignBefore)
    const updated = await fixture.request(wildcard, 'PUT', '/api/delivery_os/projects', {
      data: { id: project.id, brief: 'Wildcard mutation control' },
      updatedAt: projectBefore.updatedAt ?? undefined,
    })
    expect(updated.status()).toBe(200)
    expect((await fixture.readProject(project)).brief).toBe('Wildcard mutation control')
    expect(await fixture.readProject(foreignProject)).toEqual(foreignBefore)
    const report = { provenance: 'fixture', status: 'not_run', reason: 'scanner_not_executed' }
    const rawReportHash = createHash('sha256').update(JSON.stringify(report, null, 2)).digest('hex')
    await attachDeliveryEvidence(testInfo, 'scan-control-report', report)
    const evidence = await fixture.request(requireDeliveryResource(fixture.actors.importer), 'POST', `/api/delivery_os/projects/${project.id}/evidence`, {
      data: {
        kind: 'scan', baselineId: baseline.baselineId, sourceRevision: reservation.taskPackage.baseRevision,
        payload: { checkId: 'dependency-audit', scanner: 'fixture', status: 'not_run', rawReportHash },
      },
    })
    expect(evidence.status()).toBe(201)
    const recorded = evidenceRecordResponseSchema.parse(await readJsonSafe(evidence))
    fixture.ledger.retain({ kind: 'evidence', id: recorded.evidenceId, ...scope })
    expect(recorded.duplicate).toBe(false)
    expect(await fixture.readTask(project.actor, task.id)).toEqual(taskBefore)
    const afterControl = await readDeliveryDbCounts(sentinel)
    expect(afterControl).toEqual({ ok: true, counts: { ...before.counts, evidence: before.counts.evidence + 1 } })
    await attachDeliveryEvidence(testInfo, 'scope-spoof-and-evidence-control', { projectId: project.id, foreignProjectId: foreignProject.id, rawReportHash, evidenceId: recorded.evidenceId, afterControl, provenance: 'http-fixture-not-run-scan' })
  }, { full: true })
})
