import { z } from 'zod'
import {
  checkStatusSchema,
  isSameRevision,
  sourceRevisionSchema,
  type CheckStatus,
  type DeliveryEvidenceKind,
  type SourceRevision,
} from './contracts'

export type AcProofStatus = 'passed' | 'failed' | 'not_run' | 'missing'
export type TestProofStatus = CheckStatus | 'missing'
export type ManualCheckProofStatus = 'approved' | 'changes_requested' | 'missing'

export type AcProofEvidence = {
  id: string
  kind: DeliveryEvidenceKind
  baselineId: string
  sourceRevision: SourceRevision | null
  payload: unknown
}

export type AcProofInput = {
  acIds: readonly string[]
  acTestMap: Readonly<Record<string, readonly string[]>>
  manualChecks: Readonly<Record<string, string>>
  baselineId: string
  revision: SourceRevision
  evidence: readonly AcProofEvidence[]
}

export type TestProof = { testId: string; status: TestProofStatus; evidenceId: string | null }
export type ManualCheckProof = { manualCheckId: string; status: ManualCheckProofStatus; evidenceId: string | null }

export type AcProof = {
  acId: string
  status: AcProofStatus
  proven: boolean
  tests: TestProof[]
  manualCheck: ManualCheckProof | null
}

const CHECK_EVIDENCE_KINDS: readonly DeliveryEvidenceKind[] = ['result_manifest', 'test']

const reportedCheckSchema = z.object({
  testId: z.string(),
  status: checkStatusSchema,
  sourceRevision: sourceRevisionSchema,
})

const checksPayloadSchema = z.object({ checks: z.array(z.unknown()) })

const manualVerdictSchema = z.object({
  verdict: z.enum(['approved', 'changes_requested']),
  manualCheckId: z.string(),
  reviewer: z.object({ kind: z.literal('human') }),
})

function outranks(next: CheckStatus, current: TestProofStatus): boolean {
  if (current === 'failed') return false
  if (next === 'failed') return true
  if (current === 'passed') return false
  return next === 'passed' || current === 'missing'
}

function collectTestProofs(evidence: readonly AcProofEvidence[], revision: SourceRevision): Map<string, TestProof> {
  const proofs = new Map<string, TestProof>()
  for (const row of evidence) {
    if (!CHECK_EVIDENCE_KINDS.includes(row.kind)) continue
    const payload = checksPayloadSchema.safeParse(row.payload)
    if (!payload.success) continue
    for (const rawCheck of payload.data.checks) {
      const check = reportedCheckSchema.safeParse(rawCheck)
      if (!check.success || !isSameRevision(check.data.sourceRevision, revision)) continue
      const current = proofs.get(check.data.testId)
      if (current && !outranks(check.data.status, current.status)) continue
      proofs.set(check.data.testId, { testId: check.data.testId, status: check.data.status, evidenceId: row.id })
    }
  }
  return proofs
}

function collectManualVerdicts(evidence: readonly AcProofEvidence[]): Map<string, ManualCheckProof> {
  const verdicts = new Map<string, ManualCheckProof>()
  for (const row of evidence) {
    if (row.kind !== 'review') continue
    const review = manualVerdictSchema.safeParse(row.payload)
    if (!review.success) continue
    verdicts.set(review.data.manualCheckId, {
      manualCheckId: review.data.manualCheckId,
      status: review.data.verdict,
      evidenceId: row.id,
    })
  }
  return verdicts
}

function deriveStatus(tests: readonly TestProof[], manualCheck: ManualCheckProof | null): AcProofStatus {
  if (tests.length === 0 && !manualCheck) return 'missing'
  if (tests.some((test) => test.status === 'failed') || manualCheck?.status === 'changes_requested') return 'failed'
  if (tests.some((test) => test.status === 'not_run')) return 'not_run'
  if (tests.some((test) => test.status === 'missing') || manualCheck?.status === 'missing') return 'missing'
  return 'passed'
}

export function proveAcceptanceCriteria(input: AcProofInput): AcProof[] {
  const onRevision = input.evidence.filter(
    (row) => row.baselineId === input.baselineId && row.sourceRevision !== null && isSameRevision(row.sourceRevision, input.revision),
  )
  const testProofs = collectTestProofs(onRevision, input.revision)
  const manualVerdicts = collectManualVerdicts(onRevision)

  return input.acIds.map((acId) => {
    const requiredTestIds = Object.hasOwn(input.acTestMap, acId) ? input.acTestMap[acId] : []
    const tests = requiredTestIds.map((testId) => testProofs.get(testId) ?? { testId, status: 'missing' as const, evidenceId: null })
    const manualCheckId = Object.hasOwn(input.manualChecks, acId) ? input.manualChecks[acId] : null
    const manualCheck =
      manualCheckId === null
        ? null
        : (manualVerdicts.get(manualCheckId) ?? { manualCheckId, status: 'missing' as const, evidenceId: null })
    const status = deriveStatus(tests, manualCheck)
    return { acId, status, proven: status === 'passed', tests, manualCheck }
  })
}

export function listUnprovenAcIds(proofs: readonly AcProof[]): string[] {
  return proofs.filter((proof) => !proof.proven).map((proof) => proof.acId)
}
