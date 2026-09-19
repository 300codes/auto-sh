import { executionAttemptSchema, type ExecutionAttempt } from '@open-mercato/core/modules/delivery_os/lib/contracts'

export const ATTEMPT_BASELINE_ID = '22222222-2222-4222-8222-222222222222'
export const ATTEMPT_HASH = 'a'.repeat(64)

/**
 * Attempts built here are parsed through the published schema, so a test can
 * never assert against a register shape the domain would refuse.
 */
export function buildAttempt(overrides: Partial<ExecutionAttempt> = {}): ExecutionAttempt {
  return executionAttemptSchema.parse({
    attemptId: '31111111-1111-4111-8111-111111111111',
    idempotencyKey: 'delivery-attempt-1',
    payloadHash: ATTEMPT_HASH,
    mode: 'manual_handoff',
    state: 'reserved',
    baselineId: ATTEMPT_BASELINE_ID,
    baselineHash: ATTEMPT_HASH,
    baseRevision: { kind: 'snapshot', contentHash: ATTEMPT_HASH, externalWorkspaceId: 'ws-demo' },
    baseCommit: null,
    reservedAt: '2026-09-19T10:00:00.000Z',
    claimedAt: null,
    workerRef: null,
    externalRunId: null,
    workflowRef: null,
    workflowStepId: null,
    dispatchedAt: null,
    cancellationRequestedAt: null,
    stopConfirmation: null,
    reconciliation: null,
    resultEvidenceId: null,
    completionDelivery: null,
    lastDeliveryError: null,
    closedAt: null,
    outcome: null,
    ...overrides,
  })
}
