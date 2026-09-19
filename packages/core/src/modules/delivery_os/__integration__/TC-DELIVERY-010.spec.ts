import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { attachDeliveryEvidence, requireDeliveryResource, withDeliveryFixture } from '@open-mercato/core/helpers/integration/deliveryEvidence'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { buildResultManifest } from '../lib/fixtures/builders'
import { evidenceRecordResponseSchema, resultAcceptResponseSchema } from '../api/schemas'

test.describe('TC-DELIVERY-010: OSS manual lifecycle', () => {
  for (const requestChanges of [false, true]) {
    test(requestChanges ? 'keeps correction history and reviews the new result' : 'only reviewed proof unlocks the dependent task', async ({}, testInfo) => {
      test.skip(process.env.OM_DELIVERY_QA_OSS_ONLY !== 'verified', 'not_run/environment: runner must record the actual server module registry without enterprise')
      await withDeliveryFixture(testInfo, async (fixture) => {
        const project = requireDeliveryResource(fixture.projects.A1)
        const baseline = await fixture.prepareBaseline(project)
        const task = await fixture.createTask(project, baseline.baselineId)
        const dependent = await fixture.createTask(project, baseline.baselineId, [task.id])
        const initial = await fixture.readTask(project.actor, dependent.id)
        expect((await fixture.request(project.actor, 'PUT', '/api/delivery_os/tasks', { updatedAt: initial.updatedAt, data: { id: dependent.id, status: 'ready' } })).status()).toBe(200)
        const dependentReady = await fixture.readTask(project.actor, dependent.id)
        const blocked = await fixture.request(project.actor, 'POST', `/api/delivery_os/tasks/${dependent.id}/attempts`, { expectedStatus: 409, updatedAt: dependentReady.updatedAt, idempotencyKey: randomUUID(), data: { mode: 'manual_handoff', baseRevision: { kind: 'git', commitSha: 'a'.repeat(40) } } })
        expect(blocked.status()).toBe(409)
        expect(await readJsonSafe(blocked)).toMatchObject({ code: 'dependency_not_verified' })
        const history: Array<{ attemptId: string; resultEvidenceId: string; reviewEvidenceId: string; verdict: string }> = []
        let previousReview: unknown
        for (let round = 0; round < (requestChanges ? 2 : 1); round += 1) {
          const reservation = await fixture.reserveNeverDispatched(task.id)
          const beforeExport = await fixture.readTask(project.actor, task.id)
          expect((await fixture.request(project.actor, 'GET', reservation.packageUrl)).status()).toBe(200)
          expect(await fixture.readTask(project.actor, task.id)).toEqual(beforeExport)
          const manifest = buildResultManifest(reservation.taskPackage)
          const result = await fixture.request(project.actor, 'POST', `/api/delivery_os/tasks/${task.id}/results`, { data: { attemptId: reservation.attemptId, manifest } })
          const resultBody = await readJsonSafe(result)
          await attachDeliveryEvidence(testInfo, `round-${round}-result`, { status: result.status(), body: resultBody, taskPackage: reservation.taskPackage, manifest, provenance: 'synthetic-executor-over-http' })
          expect(result.status()).toBe(201)
          const accepted = resultAcceptResponseSchema.parse(resultBody)
          expect(accepted.taskStatus).toBe('awaiting_review')
          const stillWaiting = await fixture.readTask(project.actor, dependent.id)
          expect(stillWaiting.status).toBe('ready')
          const premature = await fixture.request(project.actor, 'POST', `/api/delivery_os/tasks/${dependent.id}/attempts`, { expectedStatus: 409, updatedAt: stillWaiting.updatedAt, idempotencyKey: randomUUID(), data: { mode: 'manual_handoff', baseRevision: manifest.resultRevision } })
          const prematureBody = await readJsonSafe(premature)
          await attachDeliveryEvidence(testInfo, `round-${round}-dependent-blocked`, { status: premature.status(), body: prematureBody })
          expect(premature.status()).toBe(409)
          expect(prematureBody).toMatchObject({ code: 'dependency_not_verified' })
          if (previousReview) {
            const old = await fixture.request(project.actor, 'POST', `/api/delivery_os/projects/${project.id}/evidence`, { expectedStatus: 422, data: previousReview })
            await attachDeliveryEvidence(testInfo, 'old-review-replay', { status: old.status(), body: await readJsonSafe(old) })
            expect(old.status()).toBe(422)
            expect((await fixture.readTask(project.actor, task.id)).status).toBe('awaiting_review')
          }
          const verdict = requestChanges && round === 0 ? 'changes_requested' : 'approved'
          const review = { kind: 'review', baselineId: baseline.baselineId, taskId: task.id, attemptId: reservation.attemptId, sourceRevision: manifest.resultRevision, payload: { verdict, summary: `Synthetic QA review round ${round}`, reviewer: { kind: 'human' }, reviewedEvidenceId: accepted.evidenceId } }
          const reviewed = await fixture.request(project.actor, 'POST', `/api/delivery_os/projects/${project.id}/evidence`, { data: review })
          const reviewBody = await readJsonSafe(reviewed)
          await attachDeliveryEvidence(testInfo, `round-${round}-review`, { status: reviewed.status(), body: reviewBody })
          expect(reviewed.status()).toBe(201)
          const recorded = evidenceRecordResponseSchema.parse(reviewBody)
          expect(recorded.taskStatus).toBe(verdict === 'approved' ? 'verified' : 'changes_requested')
          history.push({ attemptId: reservation.attemptId, resultEvidenceId: accepted.evidenceId, reviewEvidenceId: recorded.evidenceId, verdict })
          const replay = await fixture.request(project.actor, 'POST', `/api/delivery_os/projects/${project.id}/evidence`, { data: review })
          expect(replay.status()).toBe(200)
          expect(evidenceRecordResponseSchema.parse(await readJsonSafe(replay))).toMatchObject({ duplicate: true, evidenceId: recorded.evidenceId })
          previousReview = review
        }
        const final = await fixture.readTask(project.actor, task.id)
        expect(final.status).toBe('verified')
        expect(final.executionAttempts.map((attempt) => attempt.attemptId)).toEqual(history.map((entry) => entry.attemptId))
        const next = await fixture.reserveNeverDispatched(dependent.id)
        expect(next.taskPackage.taskId).toBe(dependent.id)
        await attachDeliveryEvidence(testInfo, 'oss-lifecycle', { projectId: project.id, taskId: task.id, baselineId: baseline.baselineId, baselineHash: baseline.contentHash, history, dependentTaskId: dependent.id, provenance: 'http-fixture', liveExecutor: false })
      })
    })
  }
})
