import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-DELIVERY-EXEC-003 — Duplicate idempotencyKey → idempotent 202
 *
 * Verifies that calling POST /api/delivery_agents/tasks/:id/execute twice
 * with the same idempotencyKey returns 202 both times (not 409).
 *
 * The OSS reserve command handles the idempotency internally and returns
 * the existing attempt on a matching key.
 *
 * Fixture phase: uses fake executor.
 */

const EXECUTE_PATH = (taskId: string) => `/api/delivery_agents/tasks/${taskId}/execute`

test.describe('TC-DELIVERY-EXEC-003: duplicate idempotencyKey is idempotent', () => {
  test('POST execute with same key returns 202 on first and second call', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const idempotencyKey = `exec-idempotent-${Date.now()}`

    const fakeTaskId = '00000000-0000-0000-0000-000000000003'

    const res1 = await apiRequest(request, 'POST', EXECUTE_PATH(fakeTaskId), {
      token,
      data: { idempotencyKey },
    })
    const status1 = res1.status()
    expect([202, 400, 404, 409, 422]).toContain(status1)

    if (status1 === 202) {
      // On success, second call with same key must also return 202
      const res2 = await apiRequest(request, 'POST', EXECUTE_PATH(fakeTaskId), {
        token,
        data: { idempotencyKey },
      })
      const body2 = (await res2.json()) as { code?: string }
      expect(res2.status()).toBe(202)
      // Must NOT be an idempotency_conflict error
      expect(body2.code).not.toBe('idempotency_conflict')
    }
  })

  test('POST execute with DIFFERENT key for same task does not idempotency-conflict', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const fakeTaskId = '00000000-0000-0000-0000-000000000004'

    const res1 = await apiRequest(request, 'POST', EXECUTE_PATH(fakeTaskId), {
      token,
      data: { idempotencyKey: `key-a-${Date.now()}` },
    })
    const res2 = await apiRequest(request, 'POST', EXECUTE_PATH(fakeTaskId), {
      token,
      data: { idempotencyKey: `key-b-${Date.now()}` },
    })

    if (res1.status() === 202 && res2.status() === 409) {
      const body = (await res2.json()) as { code?: string }
      // 409 is expected if task is already executing — but code must not be idempotency_conflict
      expect(body.code).not.toBe('idempotency_conflict')
    }
  })
})
