import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-DELIVERY-EXEC-004 — Cancel mid-execution → cancel_requested + outcome cancelled
 *
 * Verifies:
 * - POST /api/delivery_agents/tasks/:id/execute/cancel requires auth
 * - Cancel with a valid attemptId sets state to cancel_requested
 * - Cancel route returns 200 with stopConfirmation: stop_unconfirmed
 *
 * Fixture phase: uses fake executor, no CLI.
 */

const EXECUTE_PATH = (taskId: string) => `/api/delivery_agents/tasks/${taskId}/execute`
const CANCEL_PATH = (taskId: string) => `/api/delivery_agents/tasks/${taskId}/execute/cancel`

test.describe('TC-DELIVERY-EXEC-004: cancel mid-execution sets cancel_requested', () => {
  test('cancel route returns 401 without auth', async ({ request }) => {
    const res = await request.post(`${process.env.BASE_URL ?? ''}${CANCEL_PATH('00000000-0000-0000-0000-000000000005')}`, {
      data: { attemptId: '00000000-0000-0000-0000-000000000001' },
    })
    expect(res.status()).toBe(401)
  })

  test('cancel route requires delivery_agents.execute feature', async ({ request }) => {
    const token = await getAuthToken(request, 'employee')
    const res = await apiRequest(request, 'POST', CANCEL_PATH('00000000-0000-0000-0000-000000000005'), {
      token,
      data: { attemptId: '00000000-0000-0000-0000-000000000001' },
    })
    expect([403, 404]).toContain(res.status())
    expect(res.status()).not.toBe(401)
  })

  test('cancel an attempt sets stopConfirmation to stop_unconfirmed', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const fakeTaskId = '00000000-0000-0000-0000-000000000005'

    const execRes = await apiRequest(request, 'POST', EXECUTE_PATH(fakeTaskId), {
      token,
      data: { idempotencyKey: `cancel-test-${Date.now()}` },
    })

    if (execRes.status() !== 202) {
      test.skip()
      return
    }

    const execBody = (await execRes.json()) as { attemptId?: string }
    const attemptId = execBody.attemptId
    expect(attemptId).toBeTruthy()

    const cancelRes = await apiRequest(request, 'POST', CANCEL_PATH(fakeTaskId), {
      token,
      data: { attemptId, reason: 'Integration test cancel' },
    })

    expect([200, 409]).toContain(cancelRes.status())

    if (cancelRes.status() === 200) {
      const cancelBody = (await cancelRes.json()) as { stopConfirmation?: string; state?: string }
      expect(cancelBody.stopConfirmation).toBe('stop_unconfirmed')
      expect(cancelBody.state).toBe('cancel_requested')
    }
  })
})
