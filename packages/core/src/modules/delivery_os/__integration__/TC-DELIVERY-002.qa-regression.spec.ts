import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { attachDeliveryEvidence, requireDeliveryResource, withDeliveryFixture } from '@open-mercato/core/helpers/integration/deliveryEvidence'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { baselineCreateResponseSchema, baselineListResponseSchema, decisionCreateResponseSchema } from '../api/schemas'
import { draftSpecV1Schema } from '../data/validators'
import { hashCanonical } from '../lib/hash'
import { buildResultManifest } from '../lib/fixtures/builders'

test.describe('TC-DELIVERY-002: manual baseline integrity and decisions', () => {
  for (const inputMode of ['from_brief', 'from_design'] as const) {
    test(`${inputMode}: immutable snapshot, replay and both current decisions gate execution`, async ({}, testInfo) => {
      await withDeliveryFixture(testInfo, async (fixture) => {
        const actor = requireDeliveryResource(fixture.operators.A1)
        const project = await fixture.createProject(actor, inputMode, { inputMode })
        const baseline = await fixture.prepareBaseline(project, { decisions: [] })
        const path = `/api/delivery_os/projects/${project.id}/baselines`
        const readBaselines = async () => baselineListResponseSchema.parse(await readJsonSafe(await fixture.request(actor, 'GET', path)))
        const initial = await readBaselines()
        expect(initial.items).toHaveLength(1)
        const snapshot = initial.items[0]
        expect(snapshot).toMatchObject({ id: baseline.baselineId, source: 'manual', version: 1 })
        expect(hashCanonical(snapshot.content)).toBe(snapshot.contentHash)
        const beforeReplay = await fixture.readProject(project)
        const replay = await fixture.request(actor, 'POST', path, { data: { source: 'manual' }, updatedAt: beforeReplay.updatedAt ?? undefined })
        expect(replay.status()).toBe(200)
        expect(baselineCreateResponseSchema.parse(await readJsonSafe(replay))).toMatchObject({ baselineId: baseline.baselineId, duplicate: true })
        expect((await readBaselines()).items).toHaveLength(1)
        const draft = draftSpecV1Schema.parse(beforeReplay.draftSpec)
        expect((await fixture.request(actor, 'PUT', '/api/delivery_os/projects', {
          data: { id: project.id, draftSpec: { ...draft, architectureSummary: 'Later draft edit does not rewrite the frozen snapshot' } },
          updatedAt: beforeReplay.updatedAt ?? undefined,
        })).status()).toBe(200)
        expect((await readBaselines()).items[0].content).toEqual(snapshot.content)
        expect((await readBaselines()).items[0].contentHash).toBe(snapshot.contentHash)
        const task = await fixture.createTask(project, baseline.baselineId)
        const assertBlocked = async () => {
          const current = await fixture.readTask(actor, task.id)
          const ready = await fixture.request(actor, 'PUT', '/api/delivery_os/tasks', {
            data: { id: task.id, status: 'ready' }, updatedAt: current.updatedAt, expectedStatus: 422,
          })
          expect(ready.status()).toBe(422)
          expect(await readJsonSafe(ready)).toMatchObject({ code: 'baseline_not_approved' })
          const reserve = await fixture.request(actor, 'POST', `/api/delivery_os/tasks/${task.id}/attempts`, {
            data: { mode: 'manual_handoff', baseRevision: { kind: 'git', commitSha: 'a'.repeat(40) } },
            updatedAt: current.updatedAt, idempotencyKey: randomUUID(), expectedStatus: 409,
          })
          expect(reserve.status()).toBe(409)
          expect((await fixture.readTask(actor, task.id)).executionAttempts).toEqual([])
        }
        await assertBlocked()
        await fixture.decideBaseline(project, baseline, 'requirements')
        await assertBlocked()
        await fixture.decideBaseline(project, baseline, 'design', 'rejected')
        await assertBlocked()
        const version = await fixture.readProject(project)
        for (const subject of [{ subjectHash: '0'.repeat(64), subjectVersion: baseline.version }, { subjectHash: baseline.contentHash, subjectVersion: baseline.version + 1 }]) {
          const invalid = await fixture.request(actor, 'POST', `/api/delivery_os/baselines/${baseline.baselineId}/decisions`, {
            data: { kind: 'design', verdict: 'approved', ...subject }, updatedAt: version.updatedAt ?? undefined, expectedStatus: 409,
          })
          expect(invalid.status()).toBe(409)
          expect(await readJsonSafe(invalid)).toMatchObject({ code: 'subject_hash_mismatch' })
        }
        await fixture.decideBaseline(project, baseline, 'design')
        const reserved = await fixture.reserveNeverDispatched(task.id)
        expect(reserved.taskPackage).toMatchObject({ baselineId: baseline.baselineId, baselineHash: snapshot.contentHash })
        const final = await readBaselines()
        expect(final.items[0].content).toEqual(snapshot.content)
        expect(final.items[0].decisions).toHaveLength(3)
        await attachDeliveryEvidence(testInfo, 'immutable-baseline-decision-gates', { inputMode, projectId: project.id, baselineId: baseline.baselineId, contentHash: snapshot.contentHash, decisions: final.items[0].decisions, attemptId: reserved.attemptId, provenance: 'http-fixture' })
      })
    })

    test(`${inputMode}: invalid render bytes hash, foreign attachment and missing content cannot freeze`, async ({}, testInfo) => {
      await withDeliveryFixture(testInfo, async (fixture) => {
        const actor = requireDeliveryResource(fixture.operators.A1)
        const project = await fixture.createProject(actor, inputMode, { inputMode })
        const draft = await fixture.uploadDraft(project)
        const foreignDraft = await fixture.uploadDraft(requireDeliveryResource(fixture.projects.A2))
        const foreign = foreignDraft.screens[0]
        const cases = [
          { name: 'false-hash', code: 'attachment_hash_mismatch', draft: { ...draft, screens: draft.screens.map((screen) => ({ ...screen, sha256: '0'.repeat(64) })) } },
          { name: 'foreign-attachment', code: 'attachment_scope_mismatch', draft: { ...draft, screens: [{ ...draft.screens[0], attachmentId: foreign.attachmentId, sha256: foreign.sha256 }], attachments: [] } },
          { name: 'missing-render', code: 'missing_render', draft: { ...draft, screens: [] } },
          { name: 'missing-ac', code: 'missing_acceptance_criteria', draft: { ...draft, acceptanceCriteria: [], acTestMap: {}, manualChecks: {} } },
        ]
        for (const scenario of cases) {
          const current = await fixture.readProject(project)
          expect((await fixture.request(actor, 'PUT', '/api/delivery_os/projects', {
            data: { id: project.id, draftSpec: scenario.draft }, updatedAt: current.updatedAt ?? undefined,
          })).status()).toBe(200)
          const changed = await fixture.readProject(project)
          const response = await fixture.request(actor, 'POST', `/api/delivery_os/projects/${project.id}/baselines`, {
            data: { source: 'manual' }, updatedAt: changed.updatedAt ?? undefined, expectedStatus: 422,
          })
          const body = await readJsonSafe(response)
          const after = baselineListResponseSchema.parse(await readJsonSafe(await fixture.request(actor, 'GET', `/api/delivery_os/projects/${project.id}/baselines`)))
          await attachDeliveryEvidence(testInfo, scenario.name, { inputMode, status: response.status(), body, baselineCount: after.total })
          expect(response.status()).toBe(422)
          expect(body).toMatchObject({ code: scenario.code })
          expect(after.items).toEqual([])
          expect(await fixture.readProject(project)).toEqual(changed)
        }
      }, { full: true })
    })

    test(`${inputMode}: verified old baseline does not prove the new approved snapshot`, async ({}, testInfo) => {
      await withDeliveryFixture(testInfo, async (fixture) => {
        const actor = requireDeliveryResource(fixture.operators.A1)
        const project = await fixture.createProject(actor, `${inputMode}-baseline-proof`, { inputMode })
        const original = await fixture.prepareBaseline(project)
        const task = await fixture.createTask(project, original.baselineId)
        const reserved = await fixture.reserveNeverDispatched(task.id)
        const manifest = buildResultManifest(reserved.taskPackage)
        expect((await fixture.request(actor, 'POST', `/api/delivery_os/tasks/${task.id}/results`, { data: { attemptId: reserved.attemptId, manifest } })).status()).toBe(201)
        expect((await fixture.request(actor, 'POST', `/api/delivery_os/projects/${project.id}/evidence`, { data: {
          kind: 'review', baselineId: original.baselineId, taskId: task.id, sourceRevision: manifest.resultRevision,
          payload: { verdict: 'approved', summary: 'Synthetic old baseline proof', reviewer: { kind: 'human' } },
        } })).status()).toBe(201)
        const before = await fixture.readProject(project)
        expect(before.progress.proven).toBe(1)
        expect((await fixture.request(actor, 'PUT', '/api/delivery_os/projects', {
          updatedAt: before.updatedAt ?? undefined, data: { id: project.id, draftSpec: { ...before.draftSpec, architectureSummary: 'New baseline with a new scope version' } },
        })).status()).toBe(200)
        const next = await fixture.freezeBaseline(project)
        await fixture.decideBaseline(project, next, 'requirements')
        await fixture.decideBaseline(project, next, 'design')
        const after = await fixture.readProject(project)
        await attachDeliveryEvidence(testInfo, 'old-proof-new-baseline', { projectId: project.id, originalBaselineId: original.baselineId, currentBaselineId: next.baselineId, before: before.progress, after: after.progress, oldTaskId: task.id, oldAttemptId: reserved.attemptId })
        expect(after.activeBaselineId).toBe(next.baselineId)
        expect(after.progress.proven).toBe(0)
        expect((await fixture.readTask(actor, task.id)).baselineId).toBe(original.baselineId)
      })
    })

    test(`${inputMode}: concurrent contradictory decisions accept one current version`, async ({}, testInfo) => {
      await withDeliveryFixture(testInfo, async (fixture) => {
        const actor = requireDeliveryResource(fixture.operators.A1)
        const project = await fixture.createProject(actor, inputMode, { inputMode })
        const baseline = await fixture.prepareBaseline(project, { decisions: [] })
        const current = await fixture.readProject(project)
        const path = `/api/delivery_os/baselines/${baseline.baselineId}/decisions`
        const outcomes = await Promise.allSettled((['approved', 'rejected'] as const).map((verdict) => fixture.request(actor, 'POST', path, {
          data: { kind: 'requirements', verdict, subjectHash: baseline.contentHash, subjectVersion: baseline.version, reason: 'Contradictory fixture decisions with identical version' }, updatedAt: current.updatedAt ?? undefined,
        })))
        const observations = []
        for (const [index, outcome] of outcomes.entries()) {
          if (outcome.status === 'rejected') { observations.push({ index, status: null, body: null }); continue }
          const body = await readJsonSafe(outcome.value)
          if (outcome.value.status() === 201) {
            const created = decisionCreateResponseSchema.parse(body)
            fixture.ledger.retain({ kind: 'decision', id: created.decisionId, tenantId: project.tenantId, organizationId: project.organizationId })
          }
          observations.push({ index, status: outcome.value.status(), body })
        }
        const stored = baselineListResponseSchema.parse(await readJsonSafe(await fixture.request(actor, 'GET', `/api/delivery_os/projects/${project.id}/baselines`)))
        await attachDeliveryEvidence(testInfo, 'concurrent-decisions', { observations, decisions: stored.items[0].decisions, baselineId: baseline.baselineId })
        expect(observations.map((entry) => entry.status).sort()).toEqual([201, 409])
        expect(observations.find((entry) => entry.status === 409)?.body).toMatchObject({ code: 'optimistic_lock_conflict' })
        expect(stored.items[0].decisions).toHaveLength(1)
        const winner = observations.find((entry) => entry.status === 201)
        expect(stored.items[0].decisions[0]).toMatchObject({ verdict: winner?.index === 0 ? 'approved' : 'rejected', subjectHash: baseline.contentHash, subjectVersion: baseline.version })
        expect((await fixture.readProject(project)).activeBaselineId).toBeNull()
      })
    })
  }
})
