import { randomUUID } from 'node:crypto'
import { expect, test, type TestInfo } from '@playwright/test'
import { z } from 'zod'
import {
  createDeliveryFixtureSession,
  readDeliveryFixtureEnvironment,
} from '@open-mercato/core/helpers/integration/deliveryFixtures'
import type { DeliveryCleanupReport } from '@open-mercato/core/helpers/integration/deliveryFixtureLedger'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

type FixtureSession = Awaited<ReturnType<typeof createDeliveryFixtureSession>>

const projectIdsSchema = z.object({ items: z.array(z.object({ id: z.uuid() })) })

function required<Value>(value: Value | undefined): Value {
  if (value === undefined) throw new Error('[internal] Delivery fixture resource was not provisioned')
  return value
}

async function cleanupAndRecord(session: FixtureSession, testInfo: TestInfo, label: string): Promise<DeliveryCleanupReport> {
  const report = await session.ledger.cleanup()
  await testInfo.attach(`${label}-cleanup.json`, {
    body: Buffer.from(JSON.stringify(report, null, 2)),
    contentType: 'application/json',
  })
  await testInfo.attach(`${label}-unmanaged-mutations.json`, {
    body: Buffer.from(JSON.stringify(session.unmanagedMutations, null, 2)),
    contentType: 'application/json',
  })
  expect.soft(session.unmanagedMutations, `${label}: uncertain mutations require environment disposal`).toEqual([])
  expect.soft(report.failures, `${label}: cleanup must report every failed resource`).toEqual([])
  expect.soft(report.resources.every((resource) => resource.state === 'cleaned'), `${label}: no active fixture resources remain`).toBe(true)
  expect.soft(report.physicalCleanup).toBe('pending_environment_disposal')
  const repeated = await session.ledger.cleanup()
  await testInfo.attach(`${label}-cleanup-repeated.json`, {
    body: Buffer.from(JSON.stringify(repeated, null, 2)),
    contentType: 'application/json',
  })
  expect.soft(repeated, `${label}: cleanup must be idempotent`).toEqual(report)
  return report
}

async function finishSessions(sessions: FixtureSession[], testInfo: TestInfo): Promise<void> {
  const failures: Array<{ session: number; stage: 'cleanup' | 'dispose' }> = []
  for (const [index, session] of sessions.entries()) {
    try {
      await cleanupAndRecord(session, testInfo, `teardown-${index}`)
    } catch {
      failures.push({ session: index, stage: 'cleanup' })
    } finally {
      try {
        await session.dispose()
      } catch {
        failures.push({ session: index, stage: 'dispose' })
      }
    }
  }
  await testInfo.attach('fixture-teardown-status.json', {
    body: Buffer.from(JSON.stringify({ failures })),
    contentType: 'application/json',
  })
  expect.soft(failures, 'All fixture sessions must clean up and dispose their request contexts').toEqual([])
}

test.describe('TC-DELIVERY-FIXTURE-001: isolated fixture lifecycle', () => {
  test('scopes real actors and cleans a reserved manual attempt without changing another fixture', async ({}, testInfo) => {
    const environment = readDeliveryFixtureEnvironment()
    if (!environment.ok) {
      test.skip(true, environment.reason)
      return
    }
    const sessions: FixtureSession[] = []
    const identity = { runId: randomUUID(), testId: testInfo.testId, retry: testInfo.retry }
    try {
      const survivor = await createDeliveryFixtureSession(environment.value, { ...identity, testId: `${identity.testId}-control` })
      sessions.push(survivor)
      const controlProject = await survivor.provisionControl()
      const controlBefore = await survivor.readProject(controlProject)

      const fixture = await createDeliveryFixtureSession(environment.value, identity)
      sessions.unshift(fixture)
      await fixture.provision()
      const scopeA1 = required(fixture.scopes.A1)
      const scopeA2 = required(fixture.scopes.A2)
      const scopeB1 = required(fixture.scopes.B1)
      expect(scopeA1.tenantId).toBe(scopeA2.tenantId)
      expect(scopeA1.tenantId).not.toBe(scopeB1.tenantId)
      expect(new Set([scopeA1.organizationId, scopeA2.organizationId, scopeB1.organizationId]).size).toBe(3)
      const ownedIds = new Set(fixture.ledger.snapshot().map((resource) => resource.id))
      expect(survivor.ledger.snapshot().every((resource) => !ownedIds.has(resource.id))).toBe(true)
      expect(fixture.namespace).not.toBe(survivor.namespace)

      for (const scopeKey of ['A1', 'A2', 'B1'] as const) {
        const actor = required(fixture.operators[scopeKey])
        const project = required(fixture.projects[scopeKey])
        const response = await fixture.request(actor, 'GET', '/api/delivery_os/projects')
        expect(response.status()).toBe(200)
        expect(projectIdsSchema.parse(await readJsonSafe(response)).items.map((item) => item.id)).toEqual([project.id])
        for (const foreignKey of ['A1', 'A2', 'B1'] as const) {
          if (foreignKey === scopeKey) continue
          const foreign = required(fixture.projects[foreignKey])
          expect((await fixture.request(actor, 'GET', `/api/delivery_os/projects/${foreign.id}`)).status()).toBe(404)
        }
        expect((await fixture.request(actor, 'GET', `/api/delivery_os/projects/${controlProject.id}`)).status()).toBe(404)
      }

      const project = required(fixture.projects.A1)
      const baseline = await fixture.prepareBaseline(project)
      const task = await fixture.createTask(project, baseline.baselineId)
      const dependentTask = await fixture.createTask(project, baseline.baselineId, [task.id])
      const reservation = await fixture.reserveNeverDispatched(task.id)
      expect(reservation.taskPackage).toMatchObject({ projectId: project.id, taskId: task.id, baselineId: baseline.baselineId })
      const reservedTask = await fixture.readTask(project.actor, task.id)
      expect(reservedTask.executionAttempts).toEqual([expect.objectContaining({ attemptId: reservation.attemptId, state: 'reserved', mode: 'manual_handoff' })])

      for (const actorName of ['viewer', 'manager', 'approver', 'importer', 'attemptManager', 'reconciler'] as const) {
        const actor = required(fixture.actors[actorName])
        expect((await fixture.request(actor, 'GET', `/api/delivery_os/projects/${project.id}`)).status()).toBe(200)
      }
      expect((await fixture.request(required(fixture.actors.viewer), 'PUT', '/api/delivery_os/projects', {
        data: { id: project.id, name: 'Forbidden fixture mutation' }, expectedStatus: 403,
      })).status()).toBe(403)
      expect((await fixture.request(required(fixture.actors.manager), 'POST', `/api/delivery_os/projects/${project.id}/evidence`, { data: {}, expectedStatus: 403 })).status()).toBe(403)
      expect((await fixture.request(required(fixture.actors.approver), 'POST', `/api/delivery_os/projects/${project.id}/tasks`, { data: { source: 'manual', baselineId: baseline.baselineId, title: 'Forbidden fixture task', acIds: ['AC-001'], allowedPaths: ['src/**'] }, expectedStatus: 403 })).status()).toBe(403)
      expect((await fixture.request(required(fixture.actors.importer), 'GET', reservation.packageUrl)).status()).toBe(403)
      expect((await fixture.request(required(fixture.actors.attemptManager), 'GET', reservation.packageUrl)).status()).toBe(200)
      expect((await fixture.request(required(fixture.actors.reconciler), 'POST', `/api/delivery_os/tasks/${task.id}/attempts`, { data: {}, expectedStatus: 403 })).status()).toBe(403)

      const report = await cleanupAndRecord(fixture, testInfo, 'reserved-attempt')
      expect(report.resources).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'task', id: task.id, state: 'cleaned' }),
        expect.objectContaining({ kind: 'task', id: dependentTask.id, state: 'cleaned' }),
        expect.objectContaining({ kind: 'attachment', state: 'cleaned' }),
      ]))
      expect(report.retainedHistory).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'baseline', id: baseline.baselineId }),
        expect.objectContaining({ kind: 'attempt', id: reservation.attemptId }),
        expect.objectContaining({ kind: 'decision' }),
      ]))
      expect(await survivor.readProject(controlProject)).toEqual(controlBefore)
    } finally {
      await finishSessions(sessions, testInfo)
    }
  })

  test('cleans every registered resource after setup fails midway', async ({}, testInfo) => {
    const environment = readDeliveryFixtureEnvironment()
    if (!environment.ok) {
      test.skip(true, environment.reason)
      return
    }
    const injectedFailure = new Error('[internal] Intentional delivery fixture setup interruption')
    const fixture = await createDeliveryFixtureSession(environment.value, {
      runId: randomUUID(), testId: testInfo.testId, retry: testInfo.retry,
    }, (resource) => {
      if (resource.kind === 'user') throw injectedFailure
    })
    try {
      await expect(fixture.provision()).rejects.toBe(injectedFailure)
      const pending = fixture.ledger.snapshot()
      expect(pending.filter((resource) => resource.kind === 'tenant')).toHaveLength(2)
      expect(pending.filter((resource) => resource.kind === 'organization')).toHaveLength(3)
      expect(pending.filter((resource) => resource.kind === 'role')).toHaveLength(1)
      expect(pending.filter((resource) => resource.kind === 'user')).toHaveLength(1)
      expect(pending.every((resource) => resource.state === 'pending')).toBe(true)
    } finally {
      await finishSessions([fixture], testInfo)
    }
  })
})
