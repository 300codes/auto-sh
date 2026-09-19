import {
  DELIVERY_SCHEMA_VERSIONS,
  type CheckStatus,
  type ResultCheck,
  type ResultManifestV1,
  type SourceRevision,
  type TaskPackageV1,
} from '../contracts'
import { hashCanonical, sha256Hex } from '../hash'

export type ResultManifestOverrides = Partial<ResultManifestV1> & { checkStatus?: CheckStatus }

const FAKE_CHECK_DURATION_MS = 1000

function exitCodeFor(status: CheckStatus): number | null {
  if (status === 'passed') return 0
  if (status === 'failed') return 1
  return null
}

export function deriveFakeResultRevision(taskPackage: Pick<TaskPackageV1, 'attemptId' | 'baseRevision'>): SourceRevision {
  const digest = sha256Hex(`delivery-fake-result:${taskPackage.attemptId}`)
  if (taskPackage.baseRevision.kind === 'git') return { kind: 'git', commitSha: digest.slice(0, 40) }
  return { kind: 'snapshot', contentHash: digest, externalWorkspaceId: taskPackage.baseRevision.externalWorkspaceId }
}

const MAX_CHECK_ID_PREFIX_LENGTH = 56

function buildFakeChecks(taskPackage: TaskPackageV1, resultRevision: SourceRevision, status: CheckStatus): ResultCheck[] {
  const { validationProfile, attemptId } = taskPackage
  const acIdsByTestId = new Map<string, Set<string>>()
  for (const [acId, testIds] of Object.entries(validationProfile.requiredTests)) {
    for (const testId of testIds) acIdsByTestId.set(testId, (acIdsByTestId.get(testId) ?? new Set<string>()).add(acId))
  }
  const testDefinition = acIdsByTestId.size > 0 ? validationProfile.checks.find((check) => check.kind === 'test') : undefined
  if (acIdsByTestId.size > 0 && !testDefinition) {
    throw new Error('[internal] buildResultManifest needs a test check in the validation profile to report required tests')
  }
  const shared = {
    validationProfileVersion: validationProfile.version,
    status,
    exitCode: exitCodeFor(status),
    durationMs: FAKE_CHECK_DURATION_MS,
  }
  const profileChecks = validationProfile.checks
    .filter((check) => check !== testDefinition)
    .map((check): ResultCheck => ({
      checkId: check.checkId,
      testId: check.checkId,
      acIds: [],
      commandProfileId: check.commandProfileId,
      testDefinitionHash: sha256Hex(`delivery-fake-check-definition:${check.checkId}:${check.commandProfileId}`),
      rawReportHash: hashCanonical({ attemptId, checkId: check.checkId, status }),
      sourceRevision: { ...resultRevision },
      ...shared,
    }))
  if (!testDefinition) return profileChecks
  const usedCheckIds = new Set(profileChecks.map((check) => check.checkId))
  const checkIdPrefix = testDefinition.checkId.slice(0, MAX_CHECK_ID_PREFIX_LENGTH)
  let sequence = 0
  const nextCheckId = (): string => {
    let candidate: string
    do {
      sequence += 1
      candidate = `${checkIdPrefix}-${sequence}`
    } while (usedCheckIds.has(candidate))
    usedCheckIds.add(candidate)
    return candidate
  }
  const testChecks = [...acIdsByTestId.entries()].map(([testId, acIds]): ResultCheck => ({
    checkId: nextCheckId(),
    testId,
    acIds: [...acIds],
    commandProfileId: testDefinition.commandProfileId,
    testDefinitionHash: sha256Hex(`delivery-fake-test-definition:${testId}`),
    rawReportHash: hashCanonical({ attemptId, testId, status }),
    sourceRevision: { ...resultRevision },
    ...shared,
  }))
  return [...testChecks, ...profileChecks]
}

export function buildResultManifest(taskPackage: TaskPackageV1, overrides: ResultManifestOverrides = {}): ResultManifestV1 {
  const { checkStatus = 'passed', ...manifestOverrides } = overrides
  const resultRevision = manifestOverrides.resultRevision ?? deriveFakeResultRevision(taskPackage)
  const baseRevision = manifestOverrides.baseRevision ?? taskPackage.baseRevision
  const commits: Pick<ResultManifestV1, 'baseCommit' | 'resultCommit'> = {}
  if (baseRevision.kind === 'git') commits.baseCommit = baseRevision.commitSha
  if (resultRevision.kind === 'git') commits.resultCommit = resultRevision.commitSha
  return {
    schemaVersion: DELIVERY_SCHEMA_VERSIONS.resultManifest,
    projectId: taskPackage.projectId,
    taskId: taskPackage.taskId,
    attemptId: taskPackage.attemptId,
    baselineId: taskPackage.baselineId,
    baselineHash: taskPackage.baselineHash,
    targetProfileVersion: taskPackage.targetProfileVersion,
    externalRunId: `fake-run-${taskPackage.attemptId}`,
    baseRevision,
    resultRevision,
    ...commits,
    changedPaths: [],
    artifacts: [],
    checks: buildFakeChecks(taskPackage, resultRevision, checkStatus),
    agentDeclaration: {
      summary: 'Deterministic fake executor result',
      claimedAcIds: taskPackage.acceptanceCriteria.map((criterion) => criterion.id),
    },
    findings: [],
    usage: { source: 'runner', values: 'unknown' },
    ...manifestOverrides,
  }
}
