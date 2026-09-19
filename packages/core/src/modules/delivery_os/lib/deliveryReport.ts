import { z } from 'zod'
import { proveAcceptanceCriteria, type AcProof, type AcProofEvidence, type TestProof } from './acProof'
import {
  DELIVERY_SCHEMA_VERSIONS,
  checkStatusSchema,
  isSameRevision,
  sourceRevisionSchema,
  usageSchema,
  type BaselineContentV1,
  type CheckStatus,
  type DeliveryEvidenceKind,
  type DeliveryReportRow,
  type DeliveryReportV1,
  type ReportAcStatus,
  type ReportAcceptanceCriterion,
  type ReportDecision,
  type ReportDeployment,
  type ReportGate,
  type ReportGateBlocker,
  type ReportScan,
  type ReportTestProof,
  type SourceRevision,
} from './contracts'
import { deriveDeploymentVerificationStatus } from './evidenceRules'
import { buildProgress } from './projectStatus'
import type { TargetProfile } from './targetProfiles'
import { MAX_TRACEABILITY_ROWS, buildTraceability, clampTraceabilityLimit, type TraceabilityTask } from './traceability'

export type DeliveryReportEvidence = {
  id: string
  projectId: string
  baselineId: string
  taskId: string | null
  kind: DeliveryEvidenceKind
  sourceRevision: SourceRevision | null
  payload: unknown
  rawReportHash: string | null
  createdAt: Date | string
}

export type DeliveryReportDecision = {
  id: string
  projectId: string
  kind: 'requirements' | 'design' | 'deploy' | 'release'
  subjectType: 'baseline' | 'deployment_evidence'
  subjectId: string
  subjectHash: string
  sourceRevision: SourceRevision | null
  verdict: 'approved' | 'rejected'
  reason: string | null
  decidedAt: Date | string
}

export type DeliveryReportBaseline = {
  id: string
  projectId: string
  contentHash: string
  content: Pick<BaselineContentV1, 'requirements' | 'acceptanceCriteria' | 'acTestMap' | 'manualChecks'>
}

export type DeliveryReportInput = {
  projectId: string
  baseline: DeliveryReportBaseline
  tasks: readonly TraceabilityTask[]
  evidence: readonly DeliveryReportEvidence[]
  decisions: readonly DeliveryReportDecision[]
  profile: TargetProfile
  revision: SourceRevision | null
  limit: number
}

export const MAX_REPORT_USAGE_ENTRIES = 100
export const MAX_REPORT_DECISIONS = 1000
export const MAX_REPORT_ISSUES = 1000
export const MAX_REPORT_BLOCKERS = 2000
export const MAX_REPORT_TASK_IDS = 100

const CHECK_EVIDENCE_KINDS: readonly DeliveryEvidenceKind[] = ['result_manifest', 'test']
const NOT_RUN_ALIASES: readonly string[] = ['skipped', 'todo', 'pending']

const looseCheckSchema = z.looseObject({
  checkId: z.string().optional(),
  testId: z.string().optional(),
  status: z.string().optional(),
  sourceRevision: sourceRevisionSchema,
  rawReportHash: z.string().optional(),
})
type LooseCheck = z.infer<typeof looseCheckSchema>

const checksPayloadSchema = z.looseObject({ checks: z.array(z.unknown()) })

const scanPayloadSchema = z.looseObject({
  checkId: z.string(),
  status: checkStatusSchema,
  rawReportHash: z.string().optional(),
})

const deploymentPayloadSchema = z.looseObject({
  url: z.string().optional(),
  environment: z.string().optional(),
  buildId: z.string().optional(),
  uploadStatus: z.enum(['succeeded', 'failed']),
  verification: z.looseObject({ status: z.enum(['verified', 'failed']), observedBuildId: z.string() }).nullable().optional(),
})

const usagePayloadSchema = z.looseObject({ usage: usageSchema })

function toTime(value: Date | string): number {
  const time = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time
}

function newestOf<TRow extends { createdAt: Date | string }>(rows: readonly TRow[]): TRow | null {
  let newest: TRow | null = null
  for (const row of rows) {
    if (!newest || toTime(row.createdAt) >= toTime(newest.createdAt)) newest = row
  }
  return newest
}

function compareByCreation(first: { id: string; createdAt: Date | string }, second: { id: string; createdAt: Date | string }): number {
  const byTime = toTime(first.createdAt) - toTime(second.createdAt)
  return byTime !== 0 ? byTime : first.id < second.id ? -1 : first.id > second.id ? 1 : 0
}

function toIsoString(value: Date | string): string {
  const time = toTime(value)
  return Number.isFinite(time) ? new Date(time).toISOString() : String(value)
}

function isOnRevision(row: { sourceRevision: SourceRevision | null }, revision: SourceRevision): boolean {
  return row.sourceRevision !== null && isSameRevision(row.sourceRevision, revision)
}

function normalizeCheckStatus(status: unknown): unknown {
  return typeof status === 'string' && NOT_RUN_ALIASES.includes(status) ? 'not_run' : status
}

function normalizeChecksPayload(payload: unknown): unknown {
  const parsed = checksPayloadSchema.safeParse(payload)
  if (!parsed.success) return payload
  const checks = parsed.data.checks.map((check) => {
    if (typeof check !== 'object' || check === null || Array.isArray(check)) return check
    return { ...check, status: normalizeCheckStatus((check as { status?: unknown }).status) }
  })
  return { ...parsed.data, checks }
}

function readChecks(row: DeliveryReportEvidence, revision: SourceRevision): LooseCheck[] {
  if (!CHECK_EVIDENCE_KINDS.includes(row.kind)) return []
  const payload = checksPayloadSchema.safeParse(row.payload)
  if (!payload.success) return []
  return payload.data.checks
    .map((check) => looseCheckSchema.safeParse(check))
    .filter((check) => check.success)
    .map((check) => check.data)
    .filter((check) => isSameRevision(check.sourceRevision, revision))
}

export function selectDefaultRevision(evidence: readonly DeliveryReportEvidence[], baselineId: string): SourceRevision | null {
  const results = evidence.filter((row) => row.kind === 'result_manifest' && row.baselineId === baselineId && row.sourceRevision !== null)
  return newestOf(results)?.sourceRevision ?? null
}

function missingProofs(input: DeliveryReportInput): AcProof[] {
  const { acTestMap, manualChecks, acceptanceCriteria } = input.baseline.content
  return acceptanceCriteria.map((criterion) => {
    const testIds = Object.hasOwn(acTestMap, criterion.id) ? acTestMap[criterion.id] : []
    const manualCheckId = Object.hasOwn(manualChecks, criterion.id) ? manualChecks[criterion.id] : null
    return {
      acId: criterion.id,
      status: 'missing',
      proven: false,
      tests: testIds.map((testId) => ({ testId, status: 'missing', evidenceId: null })),
      manualCheck: manualCheckId === null ? null : { manualCheckId, status: 'missing', evidenceId: null },
    }
  })
}

function proveOnRevision(input: DeliveryReportInput, onRevision: readonly DeliveryReportEvidence[], revision: SourceRevision): AcProof[] {
  const evidence: AcProofEvidence[] = onRevision.map((row) => ({
    id: row.id,
    kind: row.kind,
    baselineId: row.baselineId,
    sourceRevision: row.sourceRevision,
    payload: CHECK_EVIDENCE_KINDS.includes(row.kind) ? normalizeChecksPayload(row.payload) : row.payload,
  }))
  return proveAcceptanceCriteria({
    acIds: input.baseline.content.acceptanceCriteria.map((criterion) => criterion.id),
    acTestMap: input.baseline.content.acTestMap,
    manualChecks: input.baseline.content.manualChecks,
    baselineId: input.baseline.id,
    revision,
    evidence,
  })
}

function refineAcStatus(proof: AcProof): ReportAcStatus {
  if (proof.status !== 'missing') return proof.status
  if (proof.tests.some((test) => test.status === 'missing')) return 'missing'
  if (proof.manualCheck?.status === 'missing') return 'manual_pending'
  return 'missing'
}

function findCheckHash(
  test: TestProof,
  rowsById: ReadonlyMap<string, DeliveryReportEvidence>,
  revision: SourceRevision | null,
): string | null {
  if (!test.evidenceId) return null
  const row = rowsById.get(test.evidenceId)
  if (!row) return null
  const check = revision ? readChecks(row, revision).find((candidate) => candidate.testId === test.testId) : undefined
  return check?.rawReportHash ?? row.rawReportHash
}

function toReportTest(test: TestProof, rowsById: ReadonlyMap<string, DeliveryReportEvidence>, revision: SourceRevision | null): ReportTestProof {
  return { testId: test.testId, status: test.status, evidenceId: test.evidenceId, rawReportHash: findCheckHash(test, rowsById, revision) }
}

function outranksScan(next: CheckStatus, current: CheckStatus | null): boolean {
  if (current === null) return true
  if (current === 'failed') return false
  if (next === 'failed') return true
  return current === 'not_run' && next === 'passed'
}

function buildScans(profile: TargetProfile, onRevision: readonly DeliveryReportEvidence[], revision: SourceRevision | null): ReportScan[] {
  const requiredScans = profile.checks.filter((check) => check.kind === 'scan' && check.required)
  return requiredScans.map((definition) => {
    let reportedStatus: CheckStatus | null = null
    let evidenceId: string | null = null
    let rawReportHash: string | null = null
    const consider = (status: CheckStatus, rowId: string, hash: string | null) => {
      if (!outranksScan(status, reportedStatus)) return
      reportedStatus = status
      evidenceId = rowId
      rawReportHash = hash
    }
    for (const row of onRevision) {
      if (row.kind === 'scan') {
        const scan = scanPayloadSchema.safeParse(row.payload)
        if (scan.success && scan.data.checkId === definition.checkId) consider(scan.data.status, row.id, scan.data.rawReportHash ?? row.rawReportHash)
        continue
      }
      if (!revision) continue
      for (const check of readChecks(row, revision)) {
        const status = checkStatusSchema.safeParse(check.status)
        if (check.checkId === definition.checkId && status.success) consider(status.data, row.id, check.rawReportHash ?? row.rawReportHash)
      }
    }
    const status = reportedStatus === 'passed' ? 'present' : reportedStatus === 'failed' ? 'failed' : 'missing'
    return { checkId: definition.checkId, status, reportedStatus, evidenceId, rawReportHash }
  })
}

function buildDeployment(onRevision: readonly DeliveryReportEvidence[]): ReportDeployment {
  const newest = newestOf(onRevision.filter((row) => row.kind === 'deployment'))
  if (!newest) return { status: 'missing', verificationStatus: null, evidenceId: null, url: null, environment: null, buildId: null }
  const payload = deploymentPayloadSchema.safeParse(newest.payload)
  if (!payload.success) return { status: 'unverified', verificationStatus: null, evidenceId: newest.id, url: null, environment: null, buildId: null }
  const verificationStatus = deriveDeploymentVerificationStatus({
    buildId: payload.data.buildId,
    uploadStatus: payload.data.uploadStatus,
    verification: payload.data.verification ?? null,
  })
  return {
    status: verificationStatus === 'verified' ? 'verified' : 'unverified',
    verificationStatus,
    evidenceId: newest.id,
    url: payload.data.url ?? null,
    environment: payload.data.environment ?? null,
    buildId: payload.data.buildId ?? null,
  }
}

function decisionApplies(
  decision: DeliveryReportDecision,
  baseline: DeliveryReportBaseline,
  revision: SourceRevision | null,
  deploymentRowsOnRevision: ReadonlySet<string>,
): boolean {
  if (decision.subjectType === 'baseline' && decision.subjectHash !== baseline.contentHash) return false
  if (decision.kind === 'requirements' || decision.kind === 'design') return decision.subjectType === 'baseline'
  if (!revision || !decision.sourceRevision || !isSameRevision(decision.sourceRevision, revision)) return false
  if (decision.subjectType === 'deployment_evidence') return deploymentRowsOnRevision.has(decision.subjectId)
  return decision.kind === 'deploy'
}

function buildDecisions(input: DeliveryReportInput, revision: SourceRevision | null, deploymentRowsOnRevision: ReadonlySet<string>): ReportDecision[] {
  return input.decisions
    .filter((decision) => decision.projectId === input.projectId)
    .slice(0, MAX_REPORT_DECISIONS)
    .map((decision) => ({
    id: decision.id,
    kind: decision.kind,
    verdict: decision.verdict,
    subjectType: decision.subjectType,
    subjectId: decision.subjectId,
    subjectHash: decision.subjectHash,
    sourceRevision: decision.sourceRevision,
    decidedAt: toIsoString(decision.decidedAt),
    reason: decision.reason,
    appliesToRevision: decisionApplies(decision, input.baseline, revision, deploymentRowsOnRevision),
    }))
}

function latestApplicableDeployDecision(decisions: readonly ReportDecision[]): ReportDecision | null {
  const applicable = decisions.filter((decision) => decision.kind === 'deploy' && decision.appliesToRevision)
  let latest: ReportDecision | null = null
  for (const decision of applicable) {
    if (!latest || toTime(decision.decidedAt) >= toTime(latest.decidedAt)) latest = decision
  }
  return latest
}

function buildGates(
  revision: SourceRevision | null,
  criteria: readonly ReportAcceptanceCriterion[],
  scans: readonly ReportScan[],
  deployment: ReportDeployment,
  decisions: readonly ReportDecision[],
): { publishable: ReportGate; releasable: ReportGate } {
  const publishBlocking: ReportGateBlocker[] = []
  const releaseOnlyBlocking: ReportGateBlocker[] = []
  if (!revision) publishBlocking.push({ kind: 'revision', id: 'revision', status: 'missing' })
  for (const criterion of criteria) {
    if (criterion.status === 'passed') continue
    const blocker = { kind: 'ac' as const, id: criterion.acId, status: criterion.status }
    if (criterion.status === 'manual_pending') releaseOnlyBlocking.push(blocker)
    else publishBlocking.push(blocker)
  }
  for (const scan of scans) {
    if (scan.status !== 'present') publishBlocking.push({ kind: 'scan', id: scan.checkId, status: scan.status })
  }
  const deployDecision = latestApplicableDeployDecision(decisions)
  if (!deployDecision) releaseOnlyBlocking.push({ kind: 'deploy_decision', id: 'deploy', status: 'missing' })
  else if (deployDecision.verdict !== 'approved') releaseOnlyBlocking.push({ kind: 'deploy_decision', id: deployDecision.id, status: deployDecision.verdict })
  if (deployment.status !== 'verified') releaseOnlyBlocking.push({ kind: 'deployment', id: deployment.evidenceId ?? 'deployment', status: deployment.status })
  const releaseBlocking = [...publishBlocking, ...releaseOnlyBlocking]
  return {
    publishable: { ok: publishBlocking.length === 0, blocking: publishBlocking.slice(0, MAX_REPORT_BLOCKERS) },
    releasable: { ok: releaseBlocking.length === 0, blocking: releaseBlocking.slice(0, MAX_REPORT_BLOCKERS) },
  }
}

function buildUsage(onRevision: readonly DeliveryReportEvidence[]): DeliveryReportV1['usage'] {
  const entries: DeliveryReportV1['usage'] = []
  for (const row of onRevision) {
    if (row.kind !== 'result_manifest') continue
    const parsed = usagePayloadSchema.safeParse(row.payload)
    if (parsed.success) entries.push({ evidenceId: row.id, ...parsed.data.usage })
  }
  return entries.slice(0, MAX_REPORT_USAGE_ENTRIES)
}

type RowSkeleton = { requirementId: string | null; acId: string | null; taskId: string | null; taskStatus: DeliveryReportRow['taskStatus'] }

function expandSkeletonRow(
  link: RowSkeleton,
  criterion: ReportAcceptanceCriterion | undefined,
  deploymentEvidenceId: string | null,
): DeliveryReportRow[] {
  const base: DeliveryReportRow = {
    requirementId: link.requirementId,
    acId: link.acId,
    acStatus: criterion?.status ?? null,
    taskId: link.taskId,
    taskStatus: link.taskStatus,
    testId: null,
    testStatus: null,
    manualCheckId: null,
    manualCheckStatus: null,
    evidenceId: null,
    rawReportHash: null,
    deploymentEvidenceId,
  }
  if (!criterion) return [base]
  const rows: DeliveryReportRow[] = criterion.tests.map((test) => ({
    ...base,
    testId: test.testId,
    testStatus: test.status,
    evidenceId: test.evidenceId,
    rawReportHash: test.rawReportHash,
  }))
  if (criterion.manualCheck) {
    rows.push({
      ...base,
      manualCheckId: criterion.manualCheck.manualCheckId,
      manualCheckStatus: criterion.manualCheck.status,
      evidenceId: criterion.manualCheck.evidenceId,
    })
  }
  return rows.length === 0 ? [base] : rows
}

export function buildDeliveryReport(input: DeliveryReportInput): DeliveryReportV1 {
  const { baseline, profile } = input
  const inScope = baseline.projectId === input.projectId
  const scoped = inScope
    ? input.evidence.filter((row) => row.projectId === input.projectId && row.baselineId === baseline.id).sort(compareByCreation)
    : []
  const revision = input.revision ?? selectDefaultRevision(scoped, baseline.id)
  const revisionSource = input.revision ? 'selected' : revision ? 'latest_result' : 'none'
  const onRevision = revision ? scoped.filter((row) => isOnRevision(row, revision)) : []
  const rowsById = new Map(scoped.map((row) => [row.id, row] as const))

  const proofs = revision ? proveOnRevision(input, onRevision, revision) : missingProofs(input)
  const proofsByAc = new Map(proofs.map((proof) => [proof.acId, proof] as const))
  const baselineTasks = inScope ? input.tasks.filter((task) => task.projectId === input.projectId && task.baselineId === baseline.id) : []
  const acceptanceCriteria: ReportAcceptanceCriterion[] = baseline.content.acceptanceCriteria.map((criterion) => {
    const proof = proofsByAc.get(criterion.id)
    const tests = proof ? proof.tests.map((test) => toReportTest(test, rowsById, revision)) : []
    return {
      acId: criterion.id,
      requirementId: criterion.requirementId,
      description: criterion.description,
      status: proof ? refineAcStatus(proof) : 'missing',
      taskIds: baselineTasks.filter((task) => task.acIds.includes(criterion.id)).map((task) => task.id).slice(0, MAX_REPORT_TASK_IDS),
      tests,
      manualCheck: proof?.manualCheck ?? null,
    }
  })
  const criteriaByAc = new Map(acceptanceCriteria.map((criterion) => [criterion.acId, criterion] as const))

  const scans = buildScans(profile, onRevision, revision)
  const deployment = buildDeployment(onRevision)
  const deploymentRowsOnRevision = new Set(onRevision.filter((row) => row.kind === 'deployment').map((row) => row.id))
  const decisions = buildDecisions(input, revision, deploymentRowsOnRevision)
  const gates = buildGates(revision, acceptanceCriteria, scans, deployment, decisions)

  const skeleton = buildTraceability({
    projectId: input.projectId,
    baseline: {
      id: baseline.id,
      projectId: baseline.projectId,
      requirements: baseline.content.requirements,
      acceptanceCriteria: baseline.content.acceptanceCriteria,
    },
    tasks: input.tasks,
    evidence: [],
    limit: MAX_TRACEABILITY_ROWS,
  })
  const limit = clampTraceabilityLimit(input.limit)
  const rows: DeliveryReportRow[] = []
  let totalRows = skeleton.totalRows - skeleton.rows.length
  for (const link of skeleton.rows) {
    const criterion = link.acId ? criteriaByAc.get(link.acId) : undefined
    for (const row of expandSkeletonRow(link, criterion, deployment.evidenceId)) {
      totalRows += 1
      if (rows.length < limit) rows.push(row)
    }
  }

  const proven = acceptanceCriteria.filter((criterion) => criterion.status === 'passed').length
  return {
    schemaVersion: DELIVERY_SCHEMA_VERSIONS.report,
    projectId: input.projectId,
    baselineId: baseline.id,
    baselineHash: baseline.contentHash,
    targetProfile: { id: profile.id, version: profile.version },
    revision,
    revisionSource,
    acceptanceCriteria,
    rows,
    totalRows,
    truncated: totalRows > limit || skeleton.truncated,
    limit,
    issues: skeleton.issues.slice(0, MAX_REPORT_ISSUES),
    scans,
    deployment,
    gates,
    decisions,
    progress: buildProgress(proven, acceptanceCriteria.length),
    usage: buildUsage(onRevision),
  }
}
