import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { withDeliveryFixture, requireDeliveryResource, attachDeliveryEvidence } from '@open-mercato/core/helpers/integration/deliveryEvidence'
import { readDeliveryDbCounts } from '@open-mercato/core/helpers/integration/deliveryDbFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { buildResultManifest } from '../lib/fixtures/builders'

const externalEvidence = () => ({ note: 'HTTP fixture only: manual package was never dispatched; no executor process was started', observedAt: new Date().toISOString() })

test.describe('TC-DELIVERY-007: cancel and reconciliation', () => {
  for (const scenario of ['cancel', 'unknown', 'stopped', 'completed'] as const) {
    test(`${scenario} preserves the execution and review gates`, async ({}, testInfo) => {
      await withDeliveryFixture(testInfo, async (fixture) => {
        const project = requireDeliveryResource(fixture.projects.A1)
        const baseline = await fixture.prepareBaseline(project)
        const task = await fixture.createTask(project, baseline.baselineId)
        const reservation = await fixture.reserveNeverDispatched(task.id)
        const manifest = buildResultManifest(reservation.taskPackage)
        const root = `/api/delivery_os/tasks/${task.id}`
        const attemptRoot = `${root}/attempts/${reservation.attemptId}`
        const detail = await fixture.readProject(project)
        const sentinel = { projectId: project.id, tenantId: project.tenantId, organizationId: project.organizationId, runId: fixture.namespace, projectName: detail.name }
        const before = await readDeliveryDbCounts(sentinel, { taskId: task.id })
        if (!before.ok) { await attachDeliveryEvidence(testInfo, 'database-unavailable', before); test.skip(true, `not_run/environment: ${before.reason}`); return }
        try {
          let current = await fixture.readTask(project.actor, task.id)
          if (scenario === 'completed') {
            const missing = await fixture.request(project.actor, 'POST', `${attemptRoot}/reconcile`, { expectedStatus: 422, updatedAt: current.updatedAt, data: { resolution: 'completed', externalEvidence: externalEvidence() } })
            expect(missing.status()).toBe(422)
            expect(await readJsonSafe(missing)).toMatchObject({ code: 'manifest_required' })
            expect(await readDeliveryDbCounts(sentinel, { taskId: task.id })).toEqual(before)
            const completed = await fixture.request(project.actor, 'POST', `${attemptRoot}/reconcile`, { updatedAt: current.updatedAt, data: { resolution: 'completed', externalEvidence: { note: 'Synthetic fixture manifest, not a live executor result', observedAt: new Date().toISOString() }, manifest } })
            expect(completed.status()).toBe(200)
            expect(await readJsonSafe(completed)).toMatchObject({ taskStatus: 'awaiting_review', resolution: 'completed' })
            const after = await readDeliveryDbCounts(sentinel, { taskId: task.id })
            expect(after).toEqual({ ok: true, counts: { ...before.counts, evidence: before.counts.evidence + 1, resultManifests: before.counts.resultManifests + 1 } })
            expect((await fixture.readTask(project.actor, task.id)).status).toBe('awaiting_review')
            await attachDeliveryEvidence(testInfo, 'completed-reconcile', { provenance: 'http-fixture', before, after, attemptId: reservation.attemptId })
            return
          }
          const changed = await fixture.request(project.actor, 'POST', `${attemptRoot}/${scenario !== 'unknown' ? 'cancel' : 'reconcile'}`, {
            updatedAt: current.updatedAt, data: scenario !== 'unknown' ? { reason: 'Fixture cancellation' } : { resolution: 'unknown', externalEvidence: { note: 'Deliberately unknown state for domain fixture; no external executor exists', observedAt: new Date().toISOString() } },
          })
          expect(changed.status()).toBe(200)
          if (scenario !== 'unknown') expect(await readJsonSafe(changed)).toMatchObject({ state: 'cancel_requested', stopConfirmation: 'stop_unconfirmed' })
          else expect(await readJsonSafe(changed)).toMatchObject({ taskStatus: 'blocked', resolution: 'unknown' })
          if (scenario !== 'unknown') {
            const replay = await fixture.request(project.actor, 'POST', `${attemptRoot}/cancel`, { updatedAt: current.updatedAt, data: {} })
            expect(replay.status()).toBe(200)
            expect(await readJsonSafe(replay)).toEqual(await readJsonSafe(changed))
          }
          current = await fixture.readTask(project.actor, task.id)
          const expectedCode = scenario !== 'unknown' ? 'attempt_active' : 'reconciliation_required'
          const reserve = await fixture.request(project.actor, 'POST', `${root}/attempts`, { expectedStatus: 409, updatedAt: current.updatedAt, idempotencyKey: randomUUID(), data: { mode: 'manual_handoff', baseRevision: reservation.taskPackage.baseRevision } })
          expect(reserve.status()).toBe(409)
          expect(await readJsonSafe(reserve)).toMatchObject({ code: expectedCode })
          const archive = await fixture.request(project.actor, 'DELETE', `/api/delivery_os/tasks?id=${task.id}`, { expectedStatus: 409, updatedAt: current.updatedAt })
          expect(archive.status()).toBe(409)
          expect(await readJsonSafe(archive)).toMatchObject({ code: expectedCode })
          const projectBefore = await fixture.readProject(project)
          expect((await fixture.request(project.actor, 'DELETE', `/api/delivery_os/projects?id=${project.id}`, { expectedStatus: 409, updatedAt: projectBefore.updatedAt ?? undefined })).status()).toBe(409)
          const late = await fixture.request(project.actor, 'POST', `${root}/results`, { expectedStatus: 409, data: { attemptId: reservation.attemptId, manifest } })
          expect(late.status()).toBe(409)
          expect(await readJsonSafe(late)).toMatchObject({ code: scenario !== 'unknown' ? 'attempt_cancelled' : 'reconciliation_required' })
          expect(await fixture.readTask(project.actor, task.id)).toEqual(current)
          expect(await readDeliveryDbCounts(sentinel, { taskId: task.id })).toEqual(before)
          const resolution = scenario === 'stopped' ? 'stopped' : 'not_started'
          const released = await fixture.request(project.actor, 'POST', `${attemptRoot}/reconcile`, { updatedAt: current.updatedAt, data: { resolution, externalEvidence: externalEvidence() } })
          expect(released.status()).toBe(200)
          expect(await readJsonSafe(released)).toMatchObject({ taskStatus: 'ready', resolution })
          const resolved = await fixture.readTask(project.actor, task.id)
          expect(resolved.executionAttempts).toEqual([expect.objectContaining({ attemptId: reservation.attemptId, state: 'closed', outcome: scenario === 'unknown' ? 'not_started' : 'cancelled', reconciliation: expect.objectContaining({ resolution }), stopConfirmation: scenario === 'stopped' ? 'stopped' : scenario === 'cancel' ? 'stop_unconfirmed' : null })])
          await attachDeliveryEvidence(testInfo, 'reconcile-gates', { scenario, before, after: await readDeliveryDbCounts(sentinel, { taskId: task.id }), attemptId: reservation.attemptId, resolution, provenance: 'http-fixture' })
          const next = await fixture.reserveNeverDispatched(task.id)
          expect(next.attemptId).not.toBe(reservation.attemptId)
          expect((await fixture.readTask(project.actor, task.id)).executionAttempts).toHaveLength(2)
        } finally {
          const current = await fixture.readTask(project.actor, task.id)
          const attempt = current.executionAttempts.find((entry) => entry.attemptId === reservation.attemptId)
          if (attempt && ['reserved', 'cancel_requested', 'reconciliation_required'].includes(attempt.state) && !attempt.claimedAt && !attempt.dispatchedAt && !attempt.workerRef && !attempt.workflowRef && !attempt.externalRunId) {
            const resolved = await fixture.request(project.actor, 'POST', `${attemptRoot}/reconcile`, { updatedAt: current.updatedAt, data: { resolution: 'not_started', externalEvidence: externalEvidence() } })
            expect(resolved.status(), 'Reconcile owned never-dispatched fixture before cleanup').toBe(200)
          }
        }
      })
    })
  }
})
