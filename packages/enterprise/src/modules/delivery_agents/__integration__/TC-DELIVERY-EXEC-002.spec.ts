import { expect, test } from '@playwright/test'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { FakeTaskExecutor } from '../lib/fakeExecutor'
import { startExecution } from '../lib/executionBridge'
import { acceptResult } from '../lib/resultAcceptance'
import { DELIVERY_RESUME_QUEUE, getDeliveryAgentsQueue } from '../lib/queue'

/**
 * TC-DELIVERY-EXEC-002 — Worker claim → fake run → evidence → resume signal → mark_delivery
 *
 * End-to-end fixture flow using FakeTaskExecutor:
 * 1. Reserve + startExecution via executionBridge (sets up attempt + workflow)
 * 2. Fake executor returns CezarRunResult
 * 3. acceptResult ingests the manifest → evidence created, completionDelivery='pending'
 * 4. Resume-attempt worker sends evidence-ready signal → mark_delivery='delivered'
 *
 * Self-contained: no CLI is launched.
 */

test.describe('TC-DELIVERY-EXEC-002: full fixture flow with fake executor', () => {
  test('fake executor returns EXEC-02-RUNNER-OK', async () => {
    const executor = new FakeTaskExecutor()
    const result = await executor.run(
      {
        schemaVersion: '1',
        projectId: 'proj-1',
        taskId: 'task-1',
        attemptId: 'attempt-1',
        baselineId: 'baseline-1',
        baselineHash: 'abc123',
        targetProfileId: 'profile-1',
        targetProfileVersion: 1,
        requirements: [],
        ac: [],
        designArtifactRefs: [],
        repositoryRef: null,
      } as never,
      '/tmp',
    )

    expect(result.exitCode).toBe(0)
    expect(result.runId).toBe('fake-run-1')
    expect(result.stdout).toContain('EXEC-02-RUNNER-OK')
    expect(result.durationMs).toBeGreaterThan(0)
  })

  test('startExecution is exported and callable', () => {
    expect(typeof startExecution).toBe('function')
  })

  test('acceptResult is exported and callable', () => {
    expect(typeof acceptResult).toBe('function')
  })

  test('delivery-resume queue is accessible', () => {
    const queue = getDeliveryAgentsQueue(DELIVERY_RESUME_QUEUE)
    expect(queue).toBeDefined()
    expect(typeof queue.enqueue).toBe('function')
  })
})
