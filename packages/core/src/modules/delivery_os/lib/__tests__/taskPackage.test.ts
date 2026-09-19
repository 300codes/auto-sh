import { reconcileAttempt, requestCancellation, reserveAttempt } from '../attempts'
import { hashBaseline } from '../baseline'
import {
  DELIVERY_SCHEMA_VERSIONS,
  taskPackageV1Schema,
  type BaselineContentV1,
  type ExecutionAttempt,
  type SourceRevision,
  type TaskPackageV1,
} from '../contracts'
import { loadBaselineContentFixture, loadTaskPackageFixture } from '../fixtures'
import { getTargetProfile, type TargetProfile } from '../targetProfiles'
import { buildTaskPackageV1, type TaskPackageInput } from '../taskPackage'

const NOW = '2026-09-19T10:00:00.000Z'
const ACTOR_ID = '88888888-8888-4888-8888-888888888888'

function requireProfile(id: string): TargetProfile {
  const profile = getTargetProfile(id, 1)
  if (!profile) throw new Error(`[internal] missing profile ${id}`)
  return profile
}

function reserve(expected: TaskPackageV1, baseRevision: SourceRevision = expected.baseRevision): ExecutionAttempt {
  const result = reserveAttempt([], {
    idempotencyKey: expected.idempotencyKey,
    payload: { mode: 'manual_handoff', baseRevision },
    mode: 'manual_handoff',
    baselineId: expected.baselineId,
    baselineHash: expected.baselineHash,
    baseRevision,
    now: NOW,
    newAttemptId: expected.attemptId,
  })
  if (!result.ok) throw new Error('[internal] fixture reservation failed')
  return result.attempt
}

function inputFor(expected: TaskPackageV1, content: BaselineContentV1, acIds: string[]): TaskPackageInput {
  return {
    project: { id: expected.projectId, repositoryRef: expected.repositoryRef, limits: expected.limits },
    task: {
      id: expected.taskId,
      projectId: expected.projectId,
      baselineId: expected.baselineId,
      title: expected.title,
      description: expected.description ?? null,
      acIds,
      allowedPaths: expected.allowedPaths,
      targetProfileId: expected.targetProfileId,
      targetProfileVersion: expected.targetProfileVersion,
    },
    baseline: {
      id: expected.baselineId,
      projectId: expected.projectId,
      contentHash: expected.baselineHash,
      content,
    },
    attempt: reserve(expected),
    profile: requireProfile(expected.targetProfileId),
  }
}

function gitInput(): { expected: TaskPackageV1; input: TaskPackageInput } {
  const expected = loadTaskPackageFixture('git')
  return { expected, input: inputFor(expected, loadBaselineContentFixture(), ['AC-002', 'AC-001']) }
}

function snapshotInput(): { expected: TaskPackageV1; input: TaskPackageInput } {
  const expected = loadTaskPackageFixture('snapshot')
  const content: BaselineContentV1 = {
    ...loadBaselineContentFixture(),
    schemaVersion: DELIVERY_SCHEMA_VERSIONS.baselineContent,
    requirements: expected.requirements,
    acceptanceCriteria: expected.acceptanceCriteria,
    screens: expected.designArtifactRefs,
    acTestMap: expected.validationProfile.requiredTests,
    manualChecks: {},
  }
  const pinned = { ...expected, baselineHash: hashBaseline(content) }
  return { expected: pinned, input: inputFor(pinned, content, ['AC-101']) }
}

function expectFailure(input: TaskPackageInput, status: number, code: string): void {
  const result = buildTaskPackageV1(input)
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.status).toBe(status)
  expect(result.body.code).toBe(code)
}

describe('buildTaskPackageV1', () => {
  it('builds the package for a non-open attempt only when the open gate is switched off', () => {
    const { expected, input } = gitInput()
    const cancelled = requestCancellation([reserve(expected)], { attemptId: expected.attemptId, now: NOW })
    if (!cancelled.ok) throw new Error('[internal] fixture cancellation failed')
    expectFailure({ ...input, attempt: cancelled.attempt }, 409, 'attempt_cancelled')
    const result = buildTaskPackageV1({ ...input, attempt: cancelled.attempt }, { attemptGate: 'none' })
    expect(result.ok).toBe(true)
    const missing = buildTaskPackageV1({ ...input, attempt: undefined }, { attemptGate: 'none' })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.body.code).toBe('attempt_not_found')
  })

  it('builds the published git package from the published baseline', () => {
    const { expected, input } = gitInput()
    expect(expected.baselineHash).toBe(hashBaseline(loadBaselineContentFixture()))
    const result = buildTaskPackageV1(input)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(taskPackageV1Schema.safeParse(result.taskPackage).success).toBe(true)
    expect(result.taskPackage).toEqual(expected)
  })

  it('leaves out criteria, requirements and tests that are not part of the task', () => {
    const { input } = gitInput()
    const result = buildTaskPackageV1({ ...input, task: { ...input.task, acIds: ['AC-001'] } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.taskPackage.acceptanceCriteria.map((criterion) => criterion.id)).toEqual(['AC-001'])
    expect(result.taskPackage.requirements.map((requirement) => requirement.id)).toEqual(['REQ-1'])
    expect(Object.keys(result.taskPackage.validationProfile.requiredTests)).toEqual(['AC-001'])
  })

  it('exports a snapshot revision without baseCommit for wordpress-theme', () => {
    const { expected, input } = snapshotInput()
    const result = buildTaskPackageV1(input)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.taskPackage).toEqual(expected)
    expect(result.taskPackage.baseRevision.kind).toBe('snapshot')
    expect('baseCommit' in result.taskPackage).toBe(false)
  })

  it('refuses a git revision on a snapshot profile', () => {
    const { expected, input } = snapshotInput()
    const attempt = reserve(expected, { kind: 'git', commitSha: 'a'.repeat(40) })
    expectFailure({ ...input, attempt }, 422, 'revision_kind_mismatch')
  })

  it('refuses a missing attempt', () => {
    expectFailure({ ...gitInput().input, attempt: undefined }, 404, 'attempt_not_found')
  })

  it('refuses a cancelled attempt', () => {
    const { input } = gitInput()
    const cancelled = requestCancellation([input.attempt as ExecutionAttempt], { attemptId: input.attempt!.attemptId, now: NOW })
    if (!cancelled.ok) throw new Error('[internal] fixture cancellation failed')
    expectFailure({ ...input, attempt: cancelled.attempt }, 409, 'attempt_cancelled')
  })

  it.each([
    ['not_started', 'attempt_closed'],
    ['unknown', 'reconciliation_required'],
  ] as const)('refuses an attempt reconciled as %s', (resolution, code) => {
    const { input } = gitInput()
    const reconciled = reconcileAttempt([input.attempt as ExecutionAttempt], {
      attemptId: input.attempt!.attemptId,
      resolution,
      note: 'Checked the runner',
      observedAt: NOW,
      actorUserId: ACTOR_ID,
      now: NOW,
    })
    if (!reconciled.ok) throw new Error('[internal] fixture reconciliation failed')
    expectFailure({ ...input, attempt: reconciled.attempt }, 409, code)
  })

  it('refuses an attempt pinned to another baseline hash', () => {
    const { input } = gitInput()
    expectFailure({ ...input, baseline: { ...input.baseline, contentHash: 'f'.repeat(64) } }, 422, 'baseline_mismatch')
  })

  it('refuses a task of another project', () => {
    const { input } = gitInput()
    expectFailure({ ...input, task: { ...input.task, projectId: input.task.id } }, 422, 'correlation_mismatch')
  })

  it('refuses a profile the task is not pinned to', () => {
    const { input } = gitInput()
    expectFailure({ ...input, profile: requireProfile('open-mercato-module') }, 422, 'unknown_target_profile')
  })

  it('refuses a criterion that is not in the pinned baseline', () => {
    const { input } = gitInput()
    expectFailure({ ...input, task: { ...input.task, acIds: ['AC-001', 'AC-404'] } }, 422, 'unknown_ac')
  })

  it('refuses unreadable baseline content', () => {
    const { input } = gitInput()
    expectFailure({ ...input, baseline: { ...input.baseline, content: { schemaVersion: 'nope' } } }, 422, 'hash_mismatch')
  })

  it('refuses stored content that no longer matches the pinned hash', () => {
    const { input } = gitInput()
    const altered = { ...loadBaselineContentFixture(), planSummary: 'Quietly widened scope' }
    const result = buildTaskPackageV1({ ...input, baseline: { ...input.baseline, content: altered } })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.body.code).toBe('hash_mismatch')
    expect(result.body.details[0].code).toBe('stored_content_altered')
  })

  it('does not mutate its input', () => {
    const { input } = gitInput()
    const before = JSON.stringify(input)
    buildTaskPackageV1(input)
    expect(JSON.stringify(input)).toBe(before)
  })
})
