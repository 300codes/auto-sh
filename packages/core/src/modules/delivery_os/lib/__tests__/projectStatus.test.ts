import type { SourceRevision } from '../contracts'
import { buildProgress, deriveProjectStatus, type ProjectStatusInput } from '../projectStatus'

const releasedRevision: SourceRevision = { kind: 'git', commitSha: 'a'.repeat(40) }
const newerRevision: SourceRevision = { kind: 'git', commitSha: 'b'.repeat(40) }

function input(overrides: Partial<ProjectStatusInput> = {}): ProjectStatusInput {
  return {
    project: { deletedAt: null, activeBaselineId: 'baseline-2' },
    baselines: [
      { id: 'baseline-1', acIds: ['AC-1'] },
      { id: 'baseline-2', acIds: ['AC-1', 'AC-2', 'AC-3'] },
    ],
    tasks: [
      { id: 'list', baselineId: 'baseline-2', status: 'verified', acIds: ['AC-1', 'AC-2'] },
      { id: 'form', baselineId: 'baseline-2', status: 'executing', acIds: ['AC-3'] },
    ],
    evidence: [],
    decisions: [],
    ...overrides,
  }
}

const allVerified = input().tasks.map((task) => ({ ...task, status: 'verified' as const }))

describe('buildProgress', () => {
  it('has no percent when the denominator is 0, and a floored percent otherwise', () => {
    expect(buildProgress(0, 0)).toEqual({ proven: 0, total: 0, unit: 'ac', percent: null })
    expect(buildProgress(2, 3)).toEqual({ proven: 2, total: 3, unit: 'ac', percent: 66 })
    expect(buildProgress(3, 3)).toEqual({ proven: 3, total: 3, unit: 'ac', percent: 100 })
  })
})

describe('deriveProjectStatus', () => {
  it('reports draft without any baseline and no percent', () => {
    const result = deriveProjectStatus(input({ baselines: [], project: { deletedAt: null, activeBaselineId: null }, tasks: [] }))
    expect(result.status).toBe('draft')
    expect(result.progress).toEqual({ proven: 0, total: 0, unit: 'ac', percent: null })
  })

  it('reports awaiting_approval when baselines exist but none is active, including an active id missing from the input', () => {
    expect(deriveProjectStatus(input({ project: { deletedAt: null, activeBaselineId: null } })).status).toBe('awaiting_approval')
    const dangling = deriveProjectStatus(input({ project: { deletedAt: null, activeBaselineId: 'baseline-9' } }))
    expect(dangling.status).toBe('awaiting_approval')
    expect(dangling.progress.percent).toBeNull()
  })

  it('reports planning with the full AC denominator when the active baseline has no live task', () => {
    const cancelledOnly = input({ tasks: [{ id: 'gone', baselineId: 'baseline-2', status: 'cancelled', acIds: ['AC-1'] }] })
    const result = deriveProjectStatus(cancelledOnly)
    expect(result.status).toBe('planning')
    expect(result.progress).toEqual({ proven: 0, total: 3, unit: 'ac', percent: 0 })
    expect(result.taskCounts.cancelled).toBe(1)
  })

  it('reports in_progress and counts only AC whose every live covering task is verified', () => {
    const result = deriveProjectStatus(input())
    expect(result.status).toBe('in_progress')
    expect(result.progress).toEqual({ proven: 2, total: 3, unit: 'ac', percent: 66 })
    expect(result.taskCounts).toMatchObject({ verified: 1, executing: 1, draft: 0 })
  })

  it('does not prove an AC while another task covering it is still open', () => {
    const tasks = [...input().tasks, { id: 'extra', baselineId: 'baseline-2', status: 'ready' as const, acIds: ['AC-1'] }]
    expect(deriveProjectStatus(input({ tasks })).progress.proven).toBe(1)
  })

  it('ignores tasks pinned to another baseline, archived tasks and cancelled tasks when proving AC', () => {
    const tasks = [
      { id: 'old', baselineId: 'baseline-1', status: 'verified' as const, acIds: ['AC-3'] },
      { id: 'archived', baselineId: 'baseline-2', status: 'verified' as const, acIds: ['AC-3'], deletedAt: '2026-09-19T00:00:00Z' },
      { id: 'dropped', baselineId: 'baseline-2', status: 'cancelled' as const, acIds: ['AC-3'] },
      { id: 'list', baselineId: 'baseline-2', status: 'verified' as const, acIds: ['AC-1', 'AC-2'] },
    ]
    const result = deriveProjectStatus(input({ tasks }))
    expect(result.progress.proven).toBe(2)
    expect(result.status).toBe('coverage_gap')
  })

  it('reports verified only when every AC is proven', () => {
    const result = deriveProjectStatus(input({ tasks: allVerified }))
    expect(result.status).toBe('verified')
    expect(result.progress).toEqual({ proven: 3, total: 3, unit: 'ac', percent: 100 })
  })

  it('never reports verified for a baseline with zero AC', () => {
    const result = deriveProjectStatus(input({ baselines: [{ id: 'baseline-2', acIds: [] }], tasks: allVerified }))
    expect(result.status).toBe('coverage_gap')
    expect(result.progress.percent).toBeNull()
  })

  it('reports released only while the approved release matches the latest result revision', () => {
    const evidence = [{ kind: 'result_manifest' as const, baselineId: 'baseline-2', sourceRevision: releasedRevision, createdAt: '2026-09-19T10:00:00Z' }]
    const decisions = [{ kind: 'release', verdict: 'approved' as const, sourceRevision: releasedRevision, decidedAt: '2026-09-19T11:00:00Z' }]
    expect(deriveProjectStatus(input({ tasks: allVerified, evidence, decisions })).status).toBe('released')

    const newerResult = [...evidence, { kind: 'result_manifest' as const, baselineId: 'baseline-2', sourceRevision: newerRevision, createdAt: '2026-09-19T12:00:00Z' }]
    expect(deriveProjectStatus(input({ tasks: allVerified, evidence: newerResult, decisions })).status).toBe('verified')

    const laterReject = [...decisions, { kind: 'release', verdict: 'rejected' as const, sourceRevision: releasedRevision, decidedAt: '2026-09-19T13:00:00Z' }]
    expect(deriveProjectStatus(input({ tasks: allVerified, evidence, decisions: laterReject })).status).toBe('verified')
  })

  it('lets a same-instant rejection win over an approval and ignores unparseable dates', () => {
    const evidence = [{ kind: 'result_manifest' as const, baselineId: 'baseline-2', sourceRevision: releasedRevision, createdAt: '2026-09-19T10:00:00Z' }]
    const tie = [
      { kind: 'release', verdict: 'approved' as const, sourceRevision: releasedRevision, decidedAt: '2026-09-19T11:00:00Z' },
      { kind: 'release', verdict: 'rejected' as const, sourceRevision: releasedRevision, decidedAt: '2026-09-19T11:00:00Z' },
    ]
    expect(deriveProjectStatus(input({ tasks: allVerified, evidence, decisions: tie })).status).toBe('verified')
    const garbledFirst = [
      { kind: 'release', verdict: 'approved' as const, sourceRevision: releasedRevision, decidedAt: 'not-a-date' },
      { kind: 'release', verdict: 'rejected' as const, sourceRevision: releasedRevision, decidedAt: '2026-09-19T12:00:00Z' },
    ]
    expect(deriveProjectStatus(input({ tasks: allVerified, evidence, decisions: garbledFirst })).status).toBe('verified')
  })

  it('keeps an archived project readable with its progress', () => {
    const result = deriveProjectStatus(input({ project: { deletedAt: new Date('2026-09-19T00:00:00Z'), activeBaselineId: 'baseline-2' } }))
    expect(result.status).toBe('archived')
    expect(result.progress).toEqual({ proven: 2, total: 3, unit: 'ac', percent: 66 })
  })

  it('lists blocked and reconciliation-required tasks for attention', () => {
    const tasks = [
      { id: 'stuck', baselineId: 'baseline-2', status: 'blocked' as const, statusReason: 'reconciliation_required', acIds: ['AC-1'] },
      { id: 'waiting', baselineId: 'baseline-2', status: 'blocked' as const, statusReason: 'dependency_blocked', acIds: ['AC-2'] },
      { id: 'fine', baselineId: 'baseline-2', status: 'ready' as const, acIds: ['AC-3'] },
    ]
    const result = deriveProjectStatus(input({ tasks }))
    expect(result.attention).toEqual({ blockedTaskIds: ['stuck', 'waiting'], reconciliationRequiredTaskIds: ['stuck'] })
    expect(result.status).toBe('in_progress')
  })
})
