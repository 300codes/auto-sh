import { reconcileAttempt, recordAttemptResult, requestCancellation, reserveAttempt } from '../attempts'
import { type ExecutionAttempt, type ResultManifestV1, type TaskPackageV1 } from '../contracts'
import {
  loadBaselineContentFixture,
  loadNegativeDeliveryFixtures,
  loadResultManifestFixture,
  loadTaskPackageFixture,
} from '../fixtures'
import { hashCanonical } from '../hash'
import { getTargetProfile } from '../targetProfiles'
import {
  MAX_RESULT_ARTIFACTS,
  MAX_RESULT_ARTIFACT_BYTES,
  MAX_RESULT_CHANGED_PATHS,
  MAX_RESULT_CHECKS,
  MAX_RESULT_TOTAL_ARTIFACT_BYTES,
  RESULT_ACCEPTANCE_CHECKS,
  checkChangedPathsAllowed,
  checkResultChecks,
  checkResultSizeLimits,
  collectArtifactReferences,
  evaluateResultAcceptance,
  type ResultAcceptanceInput,
  type ResultAcceptanceOutcome,
} from '../resultAcceptance'

const NOW = '2026-09-19T10:00:00.000Z'
const ACTOR_ID = '88888888-8888-4888-8888-888888888888'
const EVIDENCE_ID = '6b6b6b6b-6666-4666-8666-666666666666'

function reserve(taskPackage: TaskPackageV1): ExecutionAttempt {
  const result = reserveAttempt([], {
    idempotencyKey: taskPackage.idempotencyKey,
    payload: { mode: 'manual_handoff', baseRevision: taskPackage.baseRevision },
    mode: 'manual_handoff',
    baselineId: taskPackage.baselineId,
    baselineHash: taskPackage.baselineHash,
    baseRevision: taskPackage.baseRevision,
    now: NOW,
    newAttemptId: taskPackage.attemptId,
  })
  if (!result.ok) throw new Error('[internal] fixture reservation failed')
  return result.attempt
}

function reconcile(attempt: ExecutionAttempt, resolution: 'completed' | 'unknown' | 'stopped'): ExecutionAttempt {
  const result = reconcileAttempt([attempt], {
    attemptId: attempt.attemptId,
    resolution,
    note: 'Checked the runner',
    observedAt: NOW,
    actorUserId: ACTOR_ID,
    now: NOW,
  })
  if (!result.ok) throw new Error('[internal] fixture reconciliation failed')
  return result.attempt
}

function cancel(attempt: ExecutionAttempt): ExecutionAttempt {
  const result = requestCancellation([attempt], { attemptId: attempt.attemptId, now: NOW })
  if (!result.ok) throw new Error('[internal] fixture cancellation failed')
  return result.attempt
}

function declaredTestIds(): string[] {
  return loadBaselineContentFixture().declaredTests.map((test) => test.testId)
}

function manifestWith(change: (manifest: ResultManifestV1) => void, variant: 'git' | 'snapshot' = 'git'): ResultManifestV1 {
  const manifest = loadResultManifestFixture(variant)
  change(manifest)
  return manifest
}

function detailsOf(outcome: ResultAcceptanceOutcome): Array<{ path?: string; code: string }> {
  return outcome.ok ? [] : outcome.body.details.map((detail) => ({ path: detail.path, code: detail.code }))
}

function inputFor(variant: 'git' | 'snapshot' = 'git', overrides: Partial<ResultAcceptanceInput> = {}): ResultAcceptanceInput {
  const taskPackage = loadTaskPackageFixture(variant)
  return {
    manifestRaw: loadResultManifestFixture(variant),
    task: { id: taskPackage.taskId, allowedPaths: taskPackage.allowedPaths },
    attempt: reserve(taskPackage),
    taskPackage: { ok: true, taskPackage, declaredTestIds: declaredTestIds() },
    existingResult: null,
    ...overrides,
  }
}

function expectFailure(outcome: ResultAcceptanceOutcome, status: number, code: string): void {
  expect(outcome.ok).toBe(false)
  if (outcome.ok) return
  expect(outcome.status).toBe(status)
  expect(outcome.body.code).toBe(code)
}

function negative(name: string): unknown {
  const fixture = loadNegativeDeliveryFixtures().find((entry) => entry.name === name)
  if (!fixture) throw new Error(`[internal] missing negative fixture ${name}`)
  return fixture.document
}

describe('evaluateResultAcceptance', () => {
  it('accepts the published manifest for the published package', () => {
    const outcome = evaluateResultAcceptance(inputFor())
    expect(outcome.ok && outcome.outcome).toBe('accept')
    if (!outcome.ok || outcome.outcome !== 'accept') return
    expect(outcome.manifestHash).toBe(hashCanonical(loadResultManifestFixture()))
  })

  it('rejects an unknown schemaVersion before anything else', () => {
    const manifestRaw = { ...loadResultManifestFixture(), schemaVersion: 'delivery.result-manifest/v2' }
    expectFailure(evaluateResultAcceptance(inputFor('git', { manifestRaw, attempt: undefined })), 422, 'unsupported_schema_version')
  })

  it('does not accept another document type as a result', () => {
    expectFailure(evaluateResultAcceptance(inputFor('git', { manifestRaw: loadTaskPackageFixture() })), 422, 'unsupported_schema_version')
  })

  it.each(['result-manifest.missing-check-fields', 'result-manifest.status-skipped'])('rejects the schema fixture %s', (name) => {
    const outcome = evaluateResultAcceptance(inputFor('git', { manifestRaw: negative(name) }))
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.status).toBe(400)
  })

  it('answers attempt_not_found for a missing attempt', () => {
    expectFailure(evaluateResultAcceptance(inputFor('git', { attempt: undefined })), 404, 'attempt_not_found')
  })

  it('ignores tenant and organization keys inside the manifest', () => {
    const manifestRaw = { ...loadResultManifestFixture(), tenantId: 'other-tenant', organizationId: 'other-org' }
    const outcome = evaluateResultAcceptance(inputFor('git', { manifestRaw }))
    expect(outcome.ok && outcome.outcome).toBe('accept')
    if (!outcome.ok || outcome.outcome !== 'accept') return
    expect(outcome.manifestHash).toBe(hashCanonical(loadResultManifestFixture()))
    expect('tenantId' in outcome.manifest).toBe(false)
  })

  describe('idempotency runs before the attempt gate', () => {
    const storedHash = hashCanonical(loadResultManifestFixture())
    const existingResult = { evidenceId: EVIDENCE_ID, payloadHash: storedHash }

    function received(): ExecutionAttempt {
      const base = inputFor().attempt
      if (!base) throw new Error('[internal] missing attempt')
      const recorded = recordAttemptResult([base], { attemptId: base.attemptId, evidenceId: EVIDENCE_ID, externalRunId: 'run-1' })
      if (!recorded.ok) throw new Error('[internal] fixture record failed')
      return recorded.attempt
    }

    it('returns duplicate for the identical manifest on an attempt that already has the result', () => {
      const outcome = evaluateResultAcceptance(inputFor('git', { attempt: received(), existingResult }))
      expect(outcome).toEqual({ ok: true, outcome: 'duplicate', evidenceId: EVIDENCE_ID, manifestHash: storedHash })
    })

    it('duplicate beats attempt_closed and a package that can no longer be built', () => {
      const closed: ExecutionAttempt = { ...received(), state: 'closed', closedAt: NOW, outcome: 'result_accepted' }
      const brokenPackage = evaluateResultAcceptance(inputFor('git', { attempt: undefined })) as { ok: false; status: number; body: never }
      const outcome = evaluateResultAcceptance(inputFor('git', { attempt: closed, existingResult, taskPackage: brokenPackage }))
      expect(outcome.ok && outcome.outcome).toBe('duplicate')
    })

    it('answers result_conflict for different content', () => {
      const manifestRaw = { ...loadResultManifestFixture(), externalRunId: 'another-run' }
      expectFailure(evaluateResultAcceptance(inputFor('git', { manifestRaw, attempt: received(), existingResult })), 409, 'result_conflict')
    })

    it('answers result_conflict when a manifest of another attempt targets an attempt with a result', () => {
      const manifestRaw = negative('result-manifest.foreign-attempt')
      expectFailure(evaluateResultAcceptance(inputFor('git', { manifestRaw, attempt: received(), existingResult })), 409, 'result_conflict')
    })

    it('answers attempt_closed when the attempt has a result but no stored evidence was found', () => {
      expectFailure(evaluateResultAcceptance(inputFor('git', { attempt: received() })), 409, 'attempt_closed')
    })
  })

  describe('result gate', () => {
    it('rejects a late result after a cancellation request', () => {
      const attempt = cancel(reserve(loadTaskPackageFixture()))
      expectFailure(evaluateResultAcceptance(inputFor('git', { attempt })), 409, 'attempt_cancelled')
    })

    it('rejects a result for an attempt closed as cancelled', () => {
      const attempt = reconcile(cancel(reserve(loadTaskPackageFixture())), 'stopped')
      expect(attempt.outcome).toBe('cancelled')
      expectFailure(evaluateResultAcceptance(inputFor('git', { attempt })), 409, 'attempt_cancelled')
    })

    it('rejects a result while the external run is unknown', () => {
      const attempt = reconcile(reserve(loadTaskPackageFixture()), 'unknown')
      expectFailure(evaluateResultAcceptance(inputFor('git', { attempt })), 409, 'reconciliation_required')
    })

    it('accepts after a completed reconciliation of an unknown or cancel-requested attempt', () => {
      const unknownThenCompleted = reconcile(reconcile(reserve(loadTaskPackageFixture()), 'unknown'), 'completed')
      expect(unknownThenCompleted.state).toBe('reconciliation_required')
      expect(evaluateResultAcceptance(inputFor('git', { attempt: unknownThenCompleted })).ok).toBe(true)
      const cancelledThenCompleted = reconcile(cancel(reserve(loadTaskPackageFixture())), 'completed')
      expect(cancelledThenCompleted.state).toBe('cancel_requested')
      expect(evaluateResultAcceptance(inputFor('git', { attempt: cancelledThenCompleted })).ok).toBe(true)
    })
  })

  describe('correlation', () => {
    it('surfaces a package build failure only after the gate', () => {
      const failure = { ok: false as const, status: 422, body: { error: 'Stored baseline content does not match its hash', code: 'hash_mismatch' as const, details: [] } }
      expectFailure(evaluateResultAcceptance(inputFor('git', { taskPackage: failure })), 422, 'hash_mismatch')
    })

    it.each(['result-manifest.foreign-attempt', 'result-manifest.foreign-task'])('rejects %s with correlation_mismatch', (name) => {
      expectFailure(evaluateResultAcceptance(inputFor('git', { manifestRaw: negative(name) })), 422, 'correlation_mismatch')
    })

    it('rejects a wrong baseline hash', () => {
      const manifestRaw = { ...loadResultManifestFixture(), baselineHash: 'f'.repeat(64) }
      expectFailure(evaluateResultAcceptance(inputFor('git', { manifestRaw })), 422, 'baseline_mismatch')
    })

    it('rejects a wrong base commit', () => {
      const commitSha = 'b'.repeat(40)
      const manifestRaw = { ...loadResultManifestFixture(), baseRevision: { kind: 'git', commitSha }, baseCommit: commitSha }
      expectFailure(evaluateResultAcceptance(inputFor('git', { manifestRaw })), 422, 'base_revision_mismatch')
    })

    it('rejects a wrong profile version', () => {
      const manifestRaw = { ...loadResultManifestFixture(), targetProfileVersion: 2 }
      expectFailure(evaluateResultAcceptance(inputFor('git', { manifestRaw })), 422, 'correlation_mismatch')
    })

    it('rejects a snapshot result for react-vite with revision_kind_mismatch', () => {
      const manifestRaw = negative('result-manifest.snapshot-for-react')
      expectFailure(evaluateResultAcceptance(inputFor('git', { manifestRaw })), 422, 'revision_kind_mismatch')
    })

    it('accepts a snapshot result for wordpress-theme', () => {
      const outcome = evaluateResultAcceptance(inputFor('snapshot'))
      expect(outcome.ok && outcome.outcome).toBe('accept')
    })
  })

  describe('changed paths', () => {
    it('accepts changed paths inside the allowed paths, by directory and by exact file', () => {
      const manifest = manifestWith((draft) => {
        draft.changedPaths = ['src/deep/nested/File.tsx', 'index.html']
      })
      const taskPackage = loadTaskPackageFixture()
      const outcome = evaluateResultAcceptance(
        inputFor('git', { manifestRaw: manifest, task: { id: taskPackage.taskId, allowedPaths: ['src/**', 'index.html'] } }),
      )
      expect(outcome.ok && outcome.outcome).toBe('accept')
    })

    it('accepts a result without changed paths', () => {
      const outcome = evaluateResultAcceptance(inputFor('git', { manifestRaw: manifestWith((draft) => { draft.changedPaths = [] }) }))
      expect(outcome.ok && outcome.outcome).toBe('accept')
    })

    it('rejects the published path-escape fixture and names every offending path', () => {
      const outcome = evaluateResultAcceptance(inputFor('git', { manifestRaw: negative('result-manifest.path-escape') }))
      expectFailure(outcome, 422, 'path_not_allowed')
      expect(detailsOf(outcome)).toEqual([
        { path: 'changedPaths.1', code: 'outside_allowed_paths' },
        { path: 'changedPaths.2', code: 'outside_allowed_paths' },
      ])
    })

    it('uses the current task paths, not the copy in the package', () => {
      const taskPackage = loadTaskPackageFixture()
      const outcome = evaluateResultAcceptance(inputFor('git', { task: { id: taskPackage.taskId, allowedPaths: ['tests/**'] } }))
      expectFailure(outcome, 422, 'path_not_allowed')
    })

    it('does not treat a directory name prefix or the directory itself as inside', () => {
      const manifest = manifestWith((draft) => {
        draft.changedPaths = ['src-backup/File.tsx', 'src']
      })
      const outcome = evaluateResultAcceptance(inputFor('git', { manifestRaw: manifest }))
      expectFailure(outcome, 422, 'path_not_allowed')
      expect(detailsOf(outcome)).toHaveLength(2)
    })

    it('lets the identical replay win after the allowed paths were narrowed', () => {
      const base = inputFor()
      const accepted = evaluateResultAcceptance(base)
      if (!accepted.ok || accepted.outcome !== 'accept') throw new Error('[internal] expected accept')
      const recorded = recordAttemptResult([base.attempt as ExecutionAttempt], { attemptId: (base.attempt as ExecutionAttempt).attemptId, evidenceId: EVIDENCE_ID, externalRunId: 'run-1' })
      if (!recorded.ok) throw new Error('[internal] expected recorded result')
      expectFailure(evaluateResultAcceptance({ ...base, task: { id: base.task.id, allowedPaths: [] } }), 422, 'path_not_allowed')
      const narrowed = { ...base, task: { id: base.task.id, allowedPaths: [] }, attempt: recorded.attempt }
      const replay = evaluateResultAcceptance({ ...narrowed, existingResult: { evidenceId: EVIDENCE_ID, payloadHash: accepted.manifestHash } })
      expect(replay).toEqual({ ok: true, outcome: 'duplicate', evidenceId: EVIDENCE_ID, manifestHash: accepted.manifestHash })
    })
  })

  describe('checks', () => {
    it('rejects the published unknown-test fixture', () => {
      const outcome = evaluateResultAcceptance(inputFor('git', { manifestRaw: negative('result-manifest.unknown-test') }))
      expectFailure(outcome, 422, 'unknown_test_id')
      expect(detailsOf(outcome)).toEqual([
        { path: 'checks.0.testId', code: 'unknown_test_id' },
        { path: 'checks.0.acIds.0', code: 'test_not_mapped_to_ac' },
      ])
    })

    it('accepts a declared test of another task when it claims no acceptance criterion', () => {
      const base = inputFor()
      if (!base.taskPackage.ok) throw new Error('[internal] expected package')
      const manifest = manifestWith((draft) => {
        draft.checks.push({ ...draft.checks[0], checkId: 'unit-tests-3', testId: 'other task: declared elsewhere', acIds: [] })
      })
      const outcome = evaluateResultAcceptance({
        ...base,
        manifestRaw: manifest,
        taskPackage: { ...base.taskPackage, declaredTestIds: ['other task: declared elsewhere'] },
      })
      expect(outcome.ok && outcome.outcome).toBe('accept')
    })

    it('rejects an acceptance criterion of another task with unknown_ac', () => {
      const manifest = manifestWith((draft) => {
        draft.checks[0].acIds = ['AC-001', 'AC-003']
      })
      const outcome = evaluateResultAcceptance(inputFor('git', { manifestRaw: manifest }))
      expectFailure(outcome, 422, 'unknown_ac')
      expect(detailsOf(outcome)).toEqual([{ path: 'checks.0.acIds.1', code: 'unknown_ac' }])
    })

    it('rejects a wrong validation profile version with correlation_mismatch', () => {
      const manifest = manifestWith((draft) => {
        draft.checks[2].validationProfileVersion = 2
      })
      const outcome = evaluateResultAcceptance(inputFor('git', { manifestRaw: manifest }))
      expectFailure(outcome, 422, 'correlation_mismatch')
      expect(detailsOf(outcome)).toEqual([{ path: 'checks.2.validationProfileVersion', code: 'validation_profile_version_mismatch' }])
    })
  })

  describe('size limits', () => {
    it('rejects too many changed paths with 413 before looking at the paths', () => {
      const manifest = manifestWith((draft) => {
        draft.changedPaths = Array.from({ length: MAX_RESULT_CHANGED_PATHS + 1 }, (_value, index) => `outside/file-${index}.ts`)
      })
      const outcome = evaluateResultAcceptance(inputFor('git', { manifestRaw: manifest }))
      expectFailure(outcome, 413, 'payload_too_large')
      expect(detailsOf(outcome)).toEqual([{ path: 'changedPaths', code: 'too_many_changed_paths' }])
    })

    it('accepts exactly the maximum number of changed paths', () => {
      const manifest = manifestWith((draft) => {
        draft.changedPaths = Array.from({ length: MAX_RESULT_CHANGED_PATHS }, (_value, index) => `src/file-${index}.ts`)
      })
      const outcome = evaluateResultAcceptance(inputFor('git', { manifestRaw: manifest }))
      expect(outcome.ok && outcome.outcome).toBe('accept')
    })
  })

  describe('rules in isolation', () => {
    function contextFor(manifest: ResultManifestV1, variant: 'git' | 'snapshot' = 'git') {
      const taskPackage = loadTaskPackageFixture(variant)
      const profile = getTargetProfile(taskPackage.targetProfileId, taskPackage.targetProfileVersion)
      if (!profile) throw new Error('[internal] fixture profile missing')
      return { manifest, task: { id: taskPackage.taskId, allowedPaths: taskPackage.allowedPaths }, taskPackage, profile, declaredTestIds: declaredTestIds() }
    }

    it('runs size, then paths, then checks', () => {
      expect(RESULT_ACCEPTANCE_CHECKS).toEqual([checkResultSizeLimits, checkChangedPathsAllowed, checkResultChecks])
    })

    it.each(['git', 'snapshot'] as const)('passes the published %s manifest through every rule', (variant) => {
      const context = contextFor(loadResultManifestFixture(variant), variant)
      expect(RESULT_ACCEPTANCE_CHECKS.map((check) => check(context))).toEqual([{ ok: true }, { ok: true }, { ok: true }])
    })

    it('limits checks, artifacts and declared artifact bytes', () => {
      const artifact = loadResultManifestFixture().artifacts[0]
      const tooMany = manifestWith((draft) => {
        draft.checks = Array.from({ length: MAX_RESULT_CHECKS + 1 }, (_value, index) => ({ ...draft.checks[0], checkId: `c-${index}` }))
        draft.artifacts = Array.from({ length: MAX_RESULT_ARTIFACTS + 1 }, (_value, index) => ({ ...artifact, path: `reports/r-${index}.json` }))
      })
      const counted = checkResultSizeLimits(contextFor(tooMany))
      expect(counted.ok ? [] : counted.body.details.map((detail) => detail.code)).toEqual(['too_many_checks', 'too_many_artifacts'])

      const heavy = manifestWith((draft) => {
        draft.artifacts = [
          { ...artifact, sizeBytes: MAX_RESULT_ARTIFACT_BYTES + 1 },
          ...Array.from({ length: 7 }, (_value, index) => ({ ...artifact, path: `reports/big-${index}.json`, sizeBytes: MAX_RESULT_ARTIFACT_BYTES })),
        ]
      })
      const weighed = checkResultSizeLimits(contextFor(heavy))
      expect(weighed.ok).toBe(false)
      if (weighed.ok) return
      expect(weighed.status).toBe(413)
      expect(weighed.body.details.map((detail) => detail.code)).toEqual(['artifact_too_large', 'artifacts_total_too_large'])
      expect(7 * MAX_RESULT_ARTIFACT_BYTES + MAX_RESULT_ARTIFACT_BYTES + 1).toBeGreaterThan(MAX_RESULT_TOTAL_ARTIFACT_BYTES)

      const light = manifestWith((draft) => {
        draft.artifacts = [{ ...artifact, sizeBytes: MAX_RESULT_ARTIFACT_BYTES }]
      })
      expect(checkResultSizeLimits(contextFor(light))).toEqual({ ok: true })
    })

    it('collects only artifacts that point at a stored attachment', () => {
      const artifact = loadResultManifestFixture().artifacts[0]
      const attachmentId = '5a5a5a5a-5555-4555-8555-555555555555'
      expect(collectArtifactReferences([artifact, { ...artifact, path: 'reports/shot.png', attachmentId, sizeBytes: 12 }])).toEqual([
        { path: 'artifacts.1', role: 'attachment', attachmentId, declared: { sha256: artifact.sha256, sizeBytes: 12 } },
      ])
    })
  })
})
