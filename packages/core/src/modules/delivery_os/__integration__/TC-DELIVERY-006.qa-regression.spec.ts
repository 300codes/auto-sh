import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { withDeliveryFixture, requireDeliveryResource, attachDeliveryEvidence } from '@open-mercato/core/helpers/integration/deliveryEvidence'
import { readDeliveryDbCounts } from '@open-mercato/core/helpers/integration/deliveryDbFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { buildResultManifest } from '../lib/fixtures/builders'
import { resultAcceptResponseSchema } from '../api/schemas'
import type { ResultManifestV1 } from '../lib/contracts'

const invalidManifests: Array<{ name: string; status: number; code: string; change: (manifest: ResultManifestV1) => unknown }> = [
  { name: 'malformed manifest', status: 400, code: 'validation_failed', change: (manifest) => ({ ...manifest, checks: 'invalid' }) },
  { name: 'oversized body', status: 413, code: 'payload_too_large', change: (manifest) => ({ ...manifest, padding: 'x'.repeat(8_000_001) }) },
  { name: 'unknown version', status: 422, code: 'unsupported_schema_version', change: (manifest) => ({ ...manifest, schemaVersion: 'delivery.result-manifest/v99' }) },
  { name: 'foreign project', status: 422, code: 'correlation_mismatch', change: (manifest) => ({ ...manifest, projectId: randomUUID() }) },
  { name: 'foreign task', status: 422, code: 'correlation_mismatch', change: (manifest) => ({ ...manifest, taskId: randomUUID() }) },
  { name: 'foreign attempt', status: 422, code: 'correlation_mismatch', change: (manifest) => ({ ...manifest, attemptId: randomUUID() }) },
  { name: 'foreign baseline', status: 422, code: 'baseline_mismatch', change: (manifest) => ({ ...manifest, baselineId: randomUUID() }) },
  { name: 'wrong baseline hash', status: 422, code: 'baseline_mismatch', change: (manifest) => ({ ...manifest, baselineHash: '0'.repeat(64) }) },
  { name: 'wrong base revision', status: 422, code: 'base_revision_mismatch', change: (manifest) => ({ ...manifest, baseRevision: { kind: 'git', commitSha: '0'.repeat(40) }, baseCommit: '0'.repeat(40) }) },
  { name: 'outside paths', status: 422, code: 'path_not_allowed', change: (manifest) => ({ ...manifest, changedPaths: ['package.json'] }) },
  { name: 'unknown test', status: 422, code: 'unknown_test_id', change: (manifest) => ({ ...manifest, checks: manifest.checks.map((check, index) => index === 0 ? { ...check, testId: 'undeclared-test' } : check) }) },
  { name: 'too many paths', status: 413, code: 'payload_too_large', change: (manifest) => ({ ...manifest, changedPaths: Array.from({ length: 501 }, (_value, index) => `src/file-${index}.ts`) }) },
]

test.describe('TC-DELIVERY-006: result validation and durable replay', () => {
  for (const invalid of invalidManifests) {
    test(`rejects ${invalid.name} without persisting evidence`, async ({}, testInfo) => {
      await withDeliveryFixture(testInfo, async (fixture) => {
        const project = requireDeliveryResource(fixture.projects.A1)
        const baseline = await fixture.prepareBaseline(project)
        const task = await fixture.createTask(project, baseline.baselineId)
        const reservation = await fixture.reserveNeverDispatched(task.id)
        const manifest = buildResultManifest(reservation.taskPackage)
        const detail = await fixture.readProject(project)
        const sentinel = { projectId: project.id, tenantId: project.tenantId, organizationId: project.organizationId, runId: fixture.namespace, projectName: detail.name }
        const before = await readDeliveryDbCounts(sentinel, { taskId: task.id })
        if (!before.ok) { await attachDeliveryEvidence(testInfo, 'database-unavailable', before); test.skip(true, `not_run/environment: ${before.reason}`); return }
        const taskBefore = await fixture.readTask(project.actor, task.id)
        const response = await fixture.request(project.actor, 'POST', `/api/delivery_os/tasks/${task.id}/results`, { expectedStatus: invalid.status, data: { attemptId: reservation.attemptId, manifest: invalid.change(manifest) } })
        const body = await readJsonSafe(response)
        const after = await readDeliveryDbCounts(sentinel, { taskId: task.id })
        await attachDeliveryEvidence(testInfo, 'rejected-result', { case: invalid.name, status: response.status(), body, before, after, projectId: project.id, taskId: task.id, attemptId: reservation.attemptId, baselineId: baseline.baselineId, baselineHash: baseline.contentHash })
        expect(response.status()).toBe(invalid.status)
        expect(body).toMatchObject({ code: invalid.code })
        expect(after).toEqual(before)
        expect(await fixture.readTask(project.actor, task.id)).toEqual(taskBefore)
      })
    })
  }

  test('concurrent identical results create one evidence; a changed replay conflicts', async ({}, testInfo) => {
    await withDeliveryFixture(testInfo, async (fixture) => {
      const project = requireDeliveryResource(fixture.projects.A1)
      const baseline = await fixture.prepareBaseline(project)
      const task = await fixture.createTask(project, baseline.baselineId)
      const reservation = await fixture.reserveNeverDispatched(task.id)
      const detail = await fixture.readProject(project)
      const sentinel = { projectId: project.id, tenantId: project.tenantId, organizationId: project.organizationId, runId: fixture.namespace, projectName: detail.name }
      const before = await readDeliveryDbCounts(sentinel, { taskId: task.id })
      if (!before.ok) { await attachDeliveryEvidence(testInfo, 'database-unavailable', before); test.skip(true, `not_run/environment: ${before.reason}`); return }
      const manifest = buildResultManifest(reservation.taskPackage)
      const data = { attemptId: reservation.attemptId, manifest }
      const path = `/api/delivery_os/tasks/${task.id}/results`
      const unknown = await fixture.request(project.actor, 'POST', path, { expectedStatus: 404, data: { ...data, attemptId: randomUUID() } })
      const unknownBody = await readJsonSafe(unknown)
      await attachDeliveryEvidence(testInfo, 'unknown-attempt', { status: unknown.status(), body: unknownBody })
      expect(unknown.status()).toBe(404)
      expect(unknownBody).toMatchObject({ code: 'attempt_not_found' })
      expect(await readDeliveryDbCounts(sentinel, { taskId: task.id })).toEqual(before)
      const requests = [randomUUID(), randomUUID()]
      const outcomes = await Promise.allSettled(requests.map(() => fixture.request(project.actor, 'POST', path, { data })))
      for (const outcome of outcomes) {
        if (outcome.status === 'rejected') fixture.unmanagedMutations.push({ method: 'POST', path, status: null, ids: [task.id, reservation.attemptId] })
      }
      await attachDeliveryEvidence(testInfo, 'result-transport', outcomes.map((outcome, index) => ({ localRequestId: requests[index], transport: outcome.status })))
      expect(outcomes.every((outcome) => outcome.status === 'fulfilled')).toBe(true)
      const responses = outcomes.flatMap((outcome) => outcome.status === 'fulfilled' ? [outcome.value] : [])
      const bodies = await Promise.all(responses.map(readJsonSafe))
      await attachDeliveryEvidence(testInfo, 'concurrent-result', responses.map((response, index) => ({ localRequestId: requests[index], serverRequestId: response.headers()['x-request-id'] ?? null, status: response.status(), body: bodies[index] })))
      expect(responses.map((response) => response.status()).sort()).toEqual([200, 201])
      const parsed = bodies.map((body) => resultAcceptResponseSchema.parse(body))
      expect(parsed[0].evidenceId).toBe(parsed[1].evidenceId)
      expect(parsed.map((body) => body.duplicate).sort()).toEqual([false, true])
      expect(parsed.every((body) => body.taskStatus === 'awaiting_review')).toBe(true)
      const after = await readDeliveryDbCounts(sentinel, { taskId: task.id })
      await attachDeliveryEvidence(testInfo, 'result-counts', { before, after })
      expect(after).toEqual({ ok: true, counts: { ...before.counts, evidence: before.counts.evidence + 1, resultManifests: before.counts.resultManifests + 1 } })
      const replay = await fixture.request(project.actor, 'POST', path, { data })
      expect(replay.status()).toBe(200)
      expect(resultAcceptResponseSchema.parse(await readJsonSafe(replay))).toMatchObject({ duplicate: true, evidenceId: parsed[0].evidenceId })
      const conflict = await fixture.request(project.actor, 'POST', path, { expectedStatus: 409, data: { ...data, manifest: { ...manifest, externalRunId: 'different-fixture-run' } } })
      expect(conflict.status()).toBe(409)
      expect(await readJsonSafe(conflict)).toMatchObject({ code: 'result_conflict' })
      expect(await readDeliveryDbCounts(sentinel, { taskId: task.id })).toEqual(after)
      expect((await fixture.readTask(project.actor, task.id)).status).toBe('awaiting_review')
    })
  })
})
