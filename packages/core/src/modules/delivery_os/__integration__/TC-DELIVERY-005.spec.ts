import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { withDeliveryFixture, requireDeliveryResource, attachDeliveryEvidence } from '@open-mercato/core/helpers/integration/deliveryEvidence'
import { readDeliveryDbCounts } from '@open-mercato/core/helpers/integration/deliveryDbFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { MAX_EXECUTION_ATTEMPTS, reserveAttemptResponseSchema, taskPackageV1Schema } from '../lib/contracts'

const baseRevision = { kind: 'git', commitSha: 'a'.repeat(40) }

test.describe('TC-DELIVERY-005: reservation concurrency and replay', () => {
  test('concurrent identical keys persist one attempt; replay ignores the stale lock', async ({}, testInfo) => {
    await withDeliveryFixture(testInfo, async (fixture) => {
      const project = requireDeliveryResource(fixture.projects.A1)
      const baseline = await fixture.prepareBaseline(project)
      const task = await fixture.createTask(project, baseline.baselineId)
      const draft = await fixture.readTask(project.actor, task.id)
      expect((await fixture.request(project.actor, 'PUT', '/api/delivery_os/tasks', { data: { id: task.id, status: 'ready' }, updatedAt: draft.updatedAt })).status()).toBe(200)
      const ready = await fixture.readTask(project.actor, task.id)
      const detail = await fixture.readProject(project)
      const sentinel = { projectId: project.id, tenantId: project.tenantId, organizationId: project.organizationId, runId: fixture.namespace, projectName: detail.name }
      const before = await readDeliveryDbCounts(sentinel, { taskId: task.id })
      await attachDeliveryEvidence(testInfo, 'database-before', before)
      if (!before.ok) { test.skip(true, `not_run/environment: ${before.reason}`); return }
      expect(before.counts.attempts).toBe(0)
      const idempotencyKey = randomUUID()
      const data = { mode: 'manual_handoff', baseRevision }
      const path = `/api/delivery_os/tasks/${task.id}/attempts`
      const requests = [randomUUID(), randomUUID()]
      const settled = await Promise.allSettled(requests.map(() => fixture.request(project.actor, 'POST', path, { data, updatedAt: ready.updatedAt, idempotencyKey })))
      const observations: Array<{ localRequestId: string; serverRequestId: string | null; status: number | null; body: unknown; tracking: string }> = []
      for (const [index, result] of settled.entries()) {
        if (result.status === 'rejected') {
          fixture.unmanagedMutations.push({ method: 'POST', path, status: null, ids: [] })
          observations.push({ localRequestId: requests[index], serverRequestId: null, status: null, body: null, tracking: 'transport_error_write_unknown' })
          continue
        }
        const response = result.value
        let body: unknown = null
        let tracking = 'no_successful_reservation'
        try {
          body = await readJsonSafe(response)
          if (response.ok()) {
            const reservation = reserveAttemptResponseSchema.safeParse(body)
            if (!reservation.success) throw new Error('[internal] Successful reservation body cannot be tracked')
            await fixture.trackNeverDispatchedAttempt(task.id, reservation.data.attemptId)
            tracking = 'tracked'
          }
        } catch {
          fixture.unmanagedMutations.push({ method: 'POST', path, status: response.status(), ids: [task.id] })
          tracking = 'response_or_tracking_failed'
        }
        observations.push({ localRequestId: requests[index], serverRequestId: response.headers()['x-request-id'] ?? null, status: response.status(), body, tracking })
      }
      await attachDeliveryEvidence(testInfo, 'concurrent-reserve', observations)
      expect(observations.every((observation) => observation.tracking === 'tracked')).toBe(true)
      expect(observations.map((observation) => observation.status).sort()).toEqual([200, 201])
      const first = reserveAttemptResponseSchema.parse(observations[0].body)
      const second = reserveAttemptResponseSchema.parse(observations[1].body)
      expect(second.attemptId).toBe(first.attemptId)
      const after = await readDeliveryDbCounts(sentinel, { taskId: task.id })
      await attachDeliveryEvidence(testInfo, 'database-after', after)
      expect(after).toEqual({ ok: true, counts: { ...before.counts, attempts: 1 } })
      const persisted = await fixture.readTask(project.actor, task.id)
      expect(persisted.executionAttempts).toHaveLength(1)
      for (const updatedAt of [undefined, ready.updatedAt]) {
        const replay = await fixture.request(project.actor, 'POST', path, { data, idempotencyKey, updatedAt })
        expect(replay.status()).toBe(200)
        expect(reserveAttemptResponseSchema.parse(await readJsonSafe(replay)).attemptId).toBe(first.attemptId)
      }
      const conflict = await fixture.request(project.actor, 'POST', path, { data: { ...data, baseRevision: { kind: 'git', commitSha: 'b'.repeat(40) } }, idempotencyKey, updatedAt: persisted.updatedAt, expectedStatus: 409 })
      expect(conflict.status()).toBe(409)
      expect(await readJsonSafe(conflict)).toMatchObject({ code: 'idempotency_conflict' })
      const active = await fixture.request(project.actor, 'POST', path, { data, idempotencyKey: randomUUID(), updatedAt: persisted.updatedAt, expectedStatus: 409 })
      expect(active.status()).toBe(409)
      expect(await readJsonSafe(active)).toMatchObject({ code: 'attempt_active' })
      const exported = await fixture.request(project.actor, 'GET', first.packageUrl)
      expect(exported.status()).toBe(200)
      expect(taskPackageV1Schema.parse(await readJsonSafe(exported))).toMatchObject({ taskId: task.id, attemptId: first.attemptId, idempotencyKey })
      expect(await fixture.readTask(project.actor, task.id)).toEqual(persisted)
      expect(await readDeliveryDbCounts(sentinel, { taskId: task.id })).toEqual(after)
      expect((await fixture.request(project.actor, 'GET', `/api/delivery_os/tasks/${task.id}/package?attemptId=${randomUUID()}`)).status()).toBe(404)
    })
  })

  test('public reservation rejects automatic mode and missing keys without creating attempts', async ({}, testInfo) => {
    await withDeliveryFixture(testInfo, async (fixture) => {
      const project = requireDeliveryResource(fixture.projects.A1)
      const baseline = await fixture.prepareBaseline(project)
      const task = await fixture.createTask(project, baseline.baselineId)
      const before = await fixture.readTask(project.actor, task.id)
      const path = `/api/delivery_os/tasks/${task.id}/attempts`
      const automatic = await fixture.request(project.actor, 'POST', path, { data: { mode: 'automatic', baseRevision }, idempotencyKey: randomUUID(), updatedAt: before.updatedAt, expectedStatus: 400 })
      expect(automatic.status()).toBe(400)
      expect(await readJsonSafe(automatic)).toMatchObject({ code: 'validation_failed' })
      const spoofed = await fixture.request(project.actor, 'POST', path, {
        data: { mode: 'automatic', baseRevision, trustedExecution: { source: 'delivery_agents', actorUserId: project.actor.userId } },
        idempotencyKey: randomUUID(), updatedAt: before.updatedAt, expectedStatus: 400,
      })
      const spoofedBody = await readJsonSafe(spoofed)
      await attachDeliveryEvidence(testInfo, 'spoofed-trusted-execution', { status: spoofed.status(), body: spoofedBody, taskId: task.id })
      expect(spoofed.status()).toBe(400)
      expect(spoofedBody).toMatchObject({ code: 'validation_failed' })
      const missingKey = await fixture.request(project.actor, 'POST', path, { data: { mode: 'manual_handoff', baseRevision }, updatedAt: before.updatedAt, expectedStatus: 400 })
      expect(missingKey.status()).toBe(400)
      expect(await readJsonSafe(missingKey)).toMatchObject({ code: 'idempotency_key_required' })
      expect(await fixture.readTask(project.actor, task.id)).toEqual(before)
    })
  })

  test('sixteen closed attempts preserve history and reject the seventeenth reservation', async ({}, testInfo) => {
    await withDeliveryFixture(testInfo, async (fixture) => {
      const project = requireDeliveryResource(fixture.projects.A1)
      const baseline = await fixture.prepareBaseline(project)
      const task = await fixture.createTask(project, baseline.baselineId)
      const detail = await fixture.readProject(project)
      const sentinel = { projectId: project.id, tenantId: project.tenantId, organizationId: project.organizationId, runId: fixture.namespace, projectName: detail.name }
      const before = await readDeliveryDbCounts(sentinel, { taskId: task.id })
      await attachDeliveryEvidence(testInfo, 'attempt-limit-before', before)
      if (!before.ok) { test.skip(true, `not_run/environment: ${before.reason}`); return }
      expect(MAX_EXECUTION_ATTEMPTS).toBe(16)
      const path = `/api/delivery_os/tasks/${task.id}/attempts`
      let current = await fixture.readTask(project.actor, task.id)
      expect((await fixture.request(project.actor, 'PUT', '/api/delivery_os/tasks', {
        data: { id: task.id, status: 'ready' }, updatedAt: current.updatedAt,
      })).status()).toBe(200)
      current = await fixture.readTask(project.actor, task.id)
      const reservations: Array<{ attemptId: string; idempotencyKey: string }> = []
      let completedCycles = 0
      try {
        for (let index = 0; index < 16; index += 1) {
          const idempotencyKey = randomUUID()
          const response = await fixture.request(project.actor, 'POST', path, {
            data: { mode: 'manual_handoff', baseRevision }, updatedAt: current.updatedAt, idempotencyKey,
          }).catch(() => {
            fixture.unmanagedMutations.push({ method: 'POST', path, status: null, ids: [task.id] })
            throw new Error('[internal] Reservation transport failed; write outcome remains unknown')
          })
          const body = await readJsonSafe(response)
          if (response.ok()) {
            const tracked = reserveAttemptResponseSchema.safeParse(body)
            if (!tracked.success) {
              fixture.unmanagedMutations.push({ method: 'POST', path, status: response.status(), ids: [task.id] })
            } else {
              await fixture.trackNeverDispatchedAttempt(task.id, tracked.data.attemptId).catch(() => {
                fixture.unmanagedMutations.push({ method: 'POST', path, status: response.status(), ids: [task.id, tracked.data.attemptId] })
                throw new Error('[internal] Reservation could not be tracked for cleanup')
              })
              reservations.push({ attemptId: tracked.data.attemptId, idempotencyKey })
            }
          }
          expect(response.status()).toBe(201)
          const reservation = reserveAttemptResponseSchema.parse(body)
          current = await fixture.readTask(project.actor, task.id)
          const released = await fixture.request(project.actor, 'POST', `${path}/${reservation.attemptId}/reconcile`, {
            updatedAt: current.updatedAt,
            data: { resolution: 'not_started', externalEvidence: { note: 'Bounded history fixture: manual reservation never dispatched', observedAt: new Date().toISOString() } },
          })
          expect(released.status()).toBe(200)
          current = await fixture.readTask(project.actor, task.id)
          expect(current.status).toBe('ready')
          expect(current.executionAttempts).toHaveLength(index + 1)
          completedCycles += 1
        }
        const exhausted = await fixture.request(project.actor, 'POST', path, {
          data: { mode: 'manual_handoff', baseRevision }, updatedAt: current.updatedAt, idempotencyKey: randomUUID(), expectedStatus: 409,
        })
        const exhaustedBody = await readJsonSafe(exhausted)
        const after = await readDeliveryDbCounts(sentinel, { taskId: task.id })
        await attachDeliveryEvidence(testInfo, 'attempt-limit-rejection', { status: exhausted.status(), body: exhaustedBody, before, after })
        expect(exhausted.status()).toBe(409)
        expect(exhaustedBody).toMatchObject({ code: 'attempt_limit_reached' })
        expect(after).toEqual({ ok: true, counts: { ...before.counts, attempts: before.counts.attempts + 16 } })
        expect(await fixture.readTask(project.actor, task.id)).toEqual(current)
        const first = reservations[0]
        const replay = await fixture.request(project.actor, 'POST', path, {
          data: { mode: 'manual_handoff', baseRevision }, idempotencyKey: first.idempotencyKey,
        })
        expect(replay.status()).toBe(200)
        expect(reserveAttemptResponseSchema.parse(await readJsonSafe(replay)).attemptId).toBe(first.attemptId)
        expect(await fixture.readTask(project.actor, task.id)).toEqual(current)
      } finally {
        await attachDeliveryEvidence(testInfo, 'bounded-attempt-history', { taskId: task.id, projectId: project.id, reservations, completedCycles, provenance: 'http-fixture' })
      }
    })
  })
})
