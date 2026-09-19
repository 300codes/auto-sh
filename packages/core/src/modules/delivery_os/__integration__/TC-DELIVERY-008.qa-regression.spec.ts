import { expect, test } from '@playwright/test'
import { attachDeliveryEvidence, requireDeliveryResource, withDeliveryFixture } from '@open-mercato/core/helpers/integration/deliveryEvidence'
import { readDeliveryDbCounts } from '@open-mercato/core/helpers/integration/deliveryDbFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { buildResultManifest } from '../lib/fixtures/builders'
import { evidenceRecordResponseSchema } from '../api/schemas'

test.describe('TC-DELIVERY-008: review requires current complete proof', () => {
  for (const scenario of ['failed', 'not_run', 'missing', 'wrong_revision', 'manual_agent'] as const) {
    test(`cannot approve ${scenario} evidence`, async ({}, testInfo) => {
      await withDeliveryFixture(testInfo, async (fixture) => {
        const project = requireDeliveryResource(fixture.projects.A1)
        const baseline = await fixture.prepareBaseline(project)
        const task = await fixture.createTask(project, baseline.baselineId)
        if (scenario === 'manual_agent') {
          expect((await fixture.request(project.actor, 'PUT', '/api/delivery_os/tasks', { updatedAt: task.updatedAt, data: { id: task.id, acIds: ['AC-003'] } })).status()).toBe(200)
        }
        const reservation = await fixture.reserveNeverDispatched(task.id)
        const manifest = buildResultManifest(reservation.taskPackage, scenario === 'failed' || scenario === 'not_run' ? { checkStatus: scenario } : {})
        if (scenario === 'missing' || scenario === 'manual_agent') manifest.checks = []
        const imported = await fixture.request(project.actor, 'POST', `/api/delivery_os/tasks/${task.id}/results`, { data: { attemptId: reservation.attemptId, manifest } })
        const importBody = await readJsonSafe(imported)
        await attachDeliveryEvidence(testInfo, 'review-input', { scenario, manifest, status: imported.status(), body: importBody, provenance: 'synthetic-executor-over-http' })
        expect(imported.status()).toBe(201)
        const detail = await fixture.readProject(project)
        const sentinel = { projectId: project.id, tenantId: project.tenantId, organizationId: project.organizationId, runId: fixture.namespace, projectName: detail.name }
        const before = await readDeliveryDbCounts(sentinel, { taskId: task.id })
        if (!before.ok) { await attachDeliveryEvidence(testInfo, 'database-unavailable', before); test.skip(true, `not_run/environment: ${before.reason}`); return }
        const expectedStatus = scenario === 'manual_agent' ? 400 : 422
        const response = await fixture.request(project.actor, 'POST', `/api/delivery_os/projects/${project.id}/evidence`, {
          expectedStatus,
          data: { kind: 'review', baselineId: baseline.baselineId, taskId: task.id, sourceRevision: scenario === 'wrong_revision' ? { kind: 'git', commitSha: '0'.repeat(40) } : manifest.resultRevision,
            payload: { verdict: 'approved', summary: 'Negative QA fixture', reviewer: { kind: scenario === 'manual_agent' ? 'agent' : 'human' }, ...(scenario === 'manual_agent' ? { manualCheckId: 'MC-visual-001' } : {}) } },
        })
        const body = await readJsonSafe(response)
        const after = await readDeliveryDbCounts(sentinel, { taskId: task.id })
        await attachDeliveryEvidence(testInfo, 'refused-review', { scenario, status: response.status(), body, before, after })
        expect(response.status()).toBe(expectedStatus)
        expect(body).toMatchObject({ code: scenario === 'manual_agent' ? 'validation_failed' : 'missing_required_tests' })
        expect(after).toEqual(before)
        expect((await fixture.readTask(project.actor, task.id)).status).toBe('awaiting_review')
      })
    })
  }

  test('exhausted correction budget blocks another execution', async ({}, testInfo) => {
    await withDeliveryFixture(testInfo, async (fixture) => {
      const project = requireDeliveryResource(fixture.projects.A1)
      const initial = await fixture.readProject(project)
      expect((await fixture.request(project.actor, 'PUT', '/api/delivery_os/projects', { updatedAt: initial.updatedAt ?? undefined, data: { id: project.id, limits: { ...initial.limits, maxCorrectionRounds: 0 } } })).status()).toBe(200)
      const baseline = await fixture.prepareBaseline(project)
      const task = await fixture.createTask(project, baseline.baselineId)
      const reservation = await fixture.reserveNeverDispatched(task.id)
      const manifest = buildResultManifest(reservation.taskPackage)
      expect((await fixture.request(project.actor, 'POST', `/api/delivery_os/tasks/${task.id}/results`, { data: { attemptId: reservation.attemptId, manifest } })).status()).toBe(201)
      const reviewed = await fixture.request(project.actor, 'POST', `/api/delivery_os/projects/${project.id}/evidence`, { data: { kind: 'review', baselineId: baseline.baselineId, taskId: task.id, sourceRevision: manifest.resultRevision, payload: { verdict: 'changes_requested', summary: 'No correction budget remains', reviewer: { kind: 'human' } } } })
      const body = await readJsonSafe(reviewed)
      await attachDeliveryEvidence(testInfo, 'correction-limit-review', { status: reviewed.status(), body })
      expect(reviewed.status()).toBe(201)
      expect(evidenceRecordResponseSchema.parse(body).taskStatus).toBe('blocked')
      const blocked = await fixture.readTask(project.actor, task.id)
      expect(blocked.statusReason).toBe('correction_limit_reached')
      const refused = await fixture.request(project.actor, 'POST', `/api/delivery_os/tasks/${task.id}/attempts`, { expectedStatus: 409, updatedAt: blocked.updatedAt, idempotencyKey: `${fixture.namespace}-after-limit`, data: { mode: 'manual_handoff', baseRevision: manifest.resultRevision } })
      expect(refused.status()).toBe(409)
      expect(await readJsonSafe(refused)).toMatchObject({ code: 'task_not_ready' })
      expect(await fixture.readTask(project.actor, task.id)).toEqual(blocked)
    })
  })
})
