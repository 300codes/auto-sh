import { randomUUID } from 'node:crypto'
import { expect, test, type APIResponse, type TestInfo } from '@playwright/test'
import { z } from 'zod'
import { readDeliveryDbCounts, type DeliveryDbSentinel } from '@open-mercato/core/helpers/integration/deliveryDbFixtures'
import { attachDeliveryEvidence, requireDeliveryResource, withDeliveryFixture } from '@open-mercato/core/helpers/integration/deliveryEvidence'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { baselineCreateResponseSchema, optimisticLockConflictSchema, taskListResponseSchema } from '../api/schemas'
import { deliveryErrorBodySchema } from '../lib/contracts'

async function expectError(response: APIResponse, status: number, code: string): Promise<void> {
  const body = await readJsonSafe(response)
  const safeResponse = z.object({
    code: z.string().optional(),
    details: z.array(z.object({ path: z.string().optional(), code: z.string().optional() })).optional(),
    id: z.uuid().optional(), evidenceId: z.uuid().optional(), attemptId: z.uuid().optional(),
    currentUpdatedAt: z.string().nullable().optional(), expectedUpdatedAt: z.string().nullable().optional(),
  }).safeParse(body)
  await attachDeliveryEvidence(test.info(), `rejection-${randomUUID()}`, {
    expected: { status, code }, actual: { status: response.status(), body: safeResponse.success ? safeResponse.data : null },
  })
  expect(response.status()).toBe(status)
  if (code === 'optimistic_lock_conflict') expect(optimisticLockConflictSchema.parse(body).code).toBe(code)
  else expect(deliveryErrorBodySchema.parse(body).code).toBe(code)
}

async function countsOrSkip(testInfo: TestInfo, sentinel: DeliveryDbSentinel) {
  const result = await readDeliveryDbCounts(sentinel)
  if (!result.ok) {
    await attachDeliveryEvidence(testInfo, 'database-precondition', result)
    test.skip(true, `not_run/environment: ${result.reason}`)
    throw new Error('[internal] Database precondition did not stop the test')
  }
  return result.counts
}

test.describe('TC-DELIVERY-004: existing v1 optimistic locks and task guards', () => {
  test('project updates and archive reject stale versions and accept the current version', async ({}, testInfo) => {
    await withDeliveryFixture(testInfo, async (fixture) => {
      const project = requireDeliveryResource(fixture.projects.A1)
      const initial = await fixture.readProject(project)
      const staleVersion = requireDeliveryResource(initial.updatedAt ?? undefined)
      const sentinel = { projectId: project.id, tenantId: project.tenantId, organizationId: project.organizationId, runId: fixture.namespace, projectName: initial.name }
      const beforeCounts = await countsOrSkip(testInfo, sentinel)
      expect((await fixture.request(project.actor, 'PUT', '/api/delivery_os/projects', {
        data: { id: project.id, brief: 'A current edit' }, updatedAt: staleVersion,
      })).status()).toBe(200)
      const current = await fixture.readProject(project)
      expect(current.updatedAt).not.toBe(staleVersion)
      await expectError(await fixture.request(project.actor, 'PUT', '/api/delivery_os/projects', {
        data: { id: project.id, brief: 'A stale edit' }, updatedAt: staleVersion, expectedStatus: 409,
      }), 409, 'optimistic_lock_conflict')
      await expectError(await fixture.request(project.actor, 'DELETE', `/api/delivery_os/projects?id=${project.id}`, {
        updatedAt: staleVersion, expectedStatus: 409,
      }), 409, 'optimistic_lock_conflict')
      expect(await fixture.readProject(project)).toEqual(current)
      expect(await countsOrSkip(testInfo, sentinel)).toEqual(beforeCounts)
      expect((await fixture.request(project.actor, 'GET', '/api/delivery_os/projects?pageSize=101', { expectedStatus: 400 })).status()).toBe(400)
      expect((await fixture.request(project.actor, 'DELETE', `/api/delivery_os/projects?id=${project.id}`, {
        updatedAt: requireDeliveryResource(current.updatedAt ?? undefined),
      })).status()).toBe(200)
      const archived = await fixture.readProject(project)
      expect(archived.archivedAt).not.toBeNull()
      await attachDeliveryEvidence(testInfo, 'project-locks', { projectId: project.id, staleVersion, currentVersion: current.updatedAt, archivedAt: archived.archivedAt, beforeCounts, afterCounts: await countsOrSkip(testInfo, sentinel) })
    })
  })

  test('task CRUD preserves state on stale versions, invalid paths, foreign references and invalid transitions', async ({}, testInfo) => {
    await withDeliveryFixture(testInfo, async (fixture) => {
      const project = requireDeliveryResource(fixture.projects.A1)
      const baseline = await fixture.prepareBaseline(project)
      const task = await fixture.createTask(project, baseline.baselineId)
      const dependant = await fixture.createTask(project, baseline.baselineId, [task.id])
      const initialProject = await fixture.readProject(project)
      const sentinel = { projectId: project.id, tenantId: project.tenantId, organizationId: project.organizationId, runId: fixture.namespace, projectName: initialProject.name }
      const beforeCounts = await countsOrSkip(testInfo, sentinel)
      expect((await fixture.request(project.actor, 'PUT', '/api/delivery_os/tasks', {
        data: { id: task.id, title: 'Updated fixture task' }, updatedAt: task.updatedAt,
      })).status()).toBe(200)
      const current = await fixture.readTask(project.actor, task.id)
      expect(current.title).toBe('Updated fixture task')
      expect(current.updatedAt).not.toBe(task.updatedAt)
      await expectError(await fixture.request(project.actor, 'PUT', '/api/delivery_os/tasks', {
        data: { id: task.id, title: 'Stale title' }, updatedAt: task.updatedAt, expectedStatus: 409,
      }), 409, 'optimistic_lock_conflict')
      await expectError(await fixture.request(project.actor, 'DELETE', `/api/delivery_os/tasks?id=${task.id}`, {
        updatedAt: task.updatedAt, expectedStatus: 409,
      }), 409, 'optimistic_lock_conflict')
      const invalidEdits = [
        { data: { status: 'verified' }, status: 409, code: 'invalid_transition' },
        { data: { acIds: ['AC-unknown'] }, status: 422, code: 'unknown_ac' },
        { data: { dependsOnTaskIds: [dependant.id] }, status: 422, code: 'cycle' },
        { data: { dependsOnTaskIds: [randomUUID()] }, status: 422, code: 'foreign_dependency' },
        { data: { allowedPaths: ['private/**'] }, status: 422, code: 'path_not_allowed' },
      ]
      for (const invalid of invalidEdits) {
        await expectError(await fixture.request(project.actor, 'PUT', '/api/delivery_os/tasks', {
          data: { id: task.id, ...invalid.data }, updatedAt: current.updatedAt, expectedStatus: invalid.status,
        }), invalid.status, invalid.code)
        expect(await fixture.readTask(project.actor, task.id)).toEqual(current)
      }
      await expectError(await fixture.request(project.actor, 'DELETE', `/api/delivery_os/tasks?id=${task.id}`, { updatedAt: current.updatedAt, expectedStatus: 422 }), 422, 'foreign_dependency')
      await expectError(await fixture.request(project.actor, 'POST', `/api/delivery_os/projects/${project.id}/tasks`, {
        data: { source: 'manual', baselineId: randomUUID(), title: 'Foreign baseline', acIds: ['AC-001'] },
        expectedStatus: 422,
      }), 422, 'foreign_reference')
      expect(await countsOrSkip(testInfo, sentinel)).toEqual(beforeCounts)
      const listed = await fixture.request(project.actor, 'GET', `/api/delivery_os/projects/${project.id}/tasks`)
      expect(listed.status()).toBe(200)
      expect(taskListResponseSchema.parse(await readJsonSafe(listed)).items.map((item) => item.id).sort()).toEqual([task.id, dependant.id].sort())
      const child = await fixture.readTask(project.actor, dependant.id)
      expect((await fixture.request(project.actor, 'DELETE', `/api/delivery_os/tasks?id=${dependant.id}`, { updatedAt: child.updatedAt })).status()).toBe(200)
      expect((await fixture.request(project.actor, 'DELETE', `/api/delivery_os/tasks?id=${task.id}`, { updatedAt: current.updatedAt })).status()).toBe(200)
      expect((await fixture.readTask(project.actor, task.id)).archivedAt).not.toBeNull()
      await attachDeliveryEvidence(testInfo, 'task-locks-and-domain-guards', { projectId: project.id, taskId: task.id, dependantId: dependant.id, beforeCounts, afterCounts: await countsOrSkip(testInfo, sentinel), invalidEdits: invalidEdits.map(({ status, code }) => ({ status, code })) })
    })
  })

  test('baseline, decision, reserve, cancel and reconcile enforce their parent or task version', async ({}, testInfo) => {
    await withDeliveryFixture(testInfo, async (fixture) => {
      const project = requireDeliveryResource(fixture.projects.A1)
      const initialProject = await fixture.readProject(project)
      const baseline = await fixture.prepareBaseline(project)
      const task = await fixture.createTask(project, baseline.baselineId)
      const reservation = await fixture.reserveNeverDispatched(task.id)
      const projectBefore = await fixture.readProject(project)
      const taskBefore = await fixture.readTask(project.actor, task.id)
      const sentinel = { projectId: project.id, tenantId: project.tenantId, organizationId: project.organizationId, runId: fixture.namespace, projectName: projectBefore.name }
      const beforeCounts = await countsOrSkip(testInfo, sentinel)
      const routes = [
        { name: 'baseline', path: `/api/delivery_os/projects/${project.id}/baselines`, stale: requireDeliveryResource(initialProject.updatedAt ?? undefined), data: { source: 'manual' } },
        { name: 'decision', path: `/api/delivery_os/baselines/${baseline.baselineId}/decisions`, stale: requireDeliveryResource(initialProject.updatedAt ?? undefined), data: { kind: 'requirements', verdict: 'approved', subjectHash: baseline.contentHash, subjectVersion: baseline.version } },
        { name: 'reserve', path: `/api/delivery_os/tasks/${task.id}/attempts`, stale: task.updatedAt, idempotencyKey: randomUUID(), data: { mode: 'manual_handoff', baseRevision: reservation.taskPackage.baseRevision } },
        { name: 'cancel', path: `/api/delivery_os/tasks/${task.id}/attempts/${reservation.attemptId}/cancel`, stale: task.updatedAt, data: { reason: 'A rejected stale cancellation' } },
        { name: 'reconcile', path: `/api/delivery_os/tasks/${task.id}/attempts/${reservation.attemptId}/reconcile`, stale: task.updatedAt, data: { resolution: 'not_started', externalEvidence: { note: 'Fixture never dispatched the attempt', observedAt: new Date().toISOString() } } },
      ]
      for (const route of routes) {
        await test.step(`${route.name}: missing and stale lock`, async () => {
          await expectError(await fixture.request(project.actor, 'POST', route.path, {
            data: route.data, idempotencyKey: route.idempotencyKey, expectedStatus: 428,
          }), 428, 'optimistic_lock_required')
          await expectError(await fixture.request(project.actor, 'POST', route.path, {
            data: route.data, idempotencyKey: route.idempotencyKey, updatedAt: route.stale, expectedStatus: 409,
          }), 409, 'optimistic_lock_conflict')
        })
      }
      expect(await fixture.readProject(project)).toEqual(projectBefore)
      expect(await fixture.readTask(project.actor, task.id)).toEqual(taskBefore)
      const afterCounts = await countsOrSkip(testInfo, sentinel)
      expect(afterCounts).toEqual(beforeCounts)
      await expectError(await fixture.request(project.actor, 'DELETE', `/api/delivery_os/projects?id=${project.id}`, {
        updatedAt: projectBefore.updatedAt ?? undefined, expectedStatus: 409,
      }), 409, 'attempt_active')
      await attachDeliveryEvidence(testInfo, 'required-parent-and-task-locks', { projectId: project.id, taskId: task.id, attemptId: reservation.attemptId, baselineId: baseline.baselineId, beforeCounts, afterCounts, routes: routes.map(({ name }) => name) })
    })
  })

  test('a new unapproved baseline cannot ready or reserve a task using previous approvals', async ({}, testInfo) => {
    await withDeliveryFixture(testInfo, async (fixture) => {
      const project = requireDeliveryResource(fixture.projects.A1)
      await fixture.prepareBaseline(project)
      const approved = await fixture.readProject(project)
      expect((await fixture.request(project.actor, 'PUT', '/api/delivery_os/projects', {
        data: { id: project.id, draftSpec: { ...approved.draftSpec, architectureSummary: 'Changed scope requires a new approval' } },
        updatedAt: approved.updatedAt ?? undefined,
      })).status()).toBe(200)
      const changed = await fixture.readProject(project)
      const response = await fixture.request(project.actor, 'POST', `/api/delivery_os/projects/${project.id}/baselines`, {
        data: { source: 'manual' }, updatedAt: changed.updatedAt ?? undefined,
      })
      expect(response.status()).toBe(201)
      const baseline = baselineCreateResponseSchema.parse(await readJsonSafe(response))
      fixture.ledger.retain({ kind: 'baseline', id: baseline.baselineId, tenantId: project.tenantId, organizationId: project.organizationId })
      const task = await fixture.createTask(project, baseline.baselineId)
      const before = await fixture.readTask(project.actor, task.id)
      const sentinel = { projectId: project.id, tenantId: project.tenantId, organizationId: project.organizationId, runId: fixture.namespace, projectName: changed.name }
      const beforeCounts = await countsOrSkip(testInfo, sentinel)
      await expectError(await fixture.request(project.actor, 'PUT', '/api/delivery_os/tasks', {
        data: { id: task.id, status: 'ready' }, updatedAt: before.updatedAt, expectedStatus: 422,
      }), 422, 'baseline_not_approved')
      await expectError(await fixture.request(project.actor, 'POST', `/api/delivery_os/tasks/${task.id}/attempts`, {
        data: { mode: 'manual_handoff', baseRevision: { kind: 'git', commitSha: '0'.repeat(40) } },
        updatedAt: before.updatedAt, idempotencyKey: randomUUID(), expectedStatus: 409,
      }), 409, 'task_not_ready')
      expect(await fixture.readTask(project.actor, task.id)).toEqual(before)
      const afterCounts = await countsOrSkip(testInfo, sentinel)
      expect(afterCounts).toEqual(beforeCounts)
      expect((await fixture.readProject(project)).activeBaselineId).toBe(approved.activeBaselineId)
      await attachDeliveryEvidence(testInfo, 'unapproved-baseline-gate', { projectId: project.id, oldBaselineId: approved.activeBaselineId, newBaselineId: baseline.baselineId, baselineHash: baseline.contentHash, beforeCounts, afterCounts })
    })
  })
})
