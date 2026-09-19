import type { SourceRevision } from '../contracts'
import { MAX_TRACEABILITY_ROWS, buildTraceability, type TraceabilityInput } from '../traceability'

const revision: SourceRevision = { kind: 'git', commitSha: 'c'.repeat(40) }
const reportHash = 'd'.repeat(64)

function input(overrides: Partial<TraceabilityInput> = {}): TraceabilityInput {
  return {
    projectId: 'project-1',
    baseline: {
      id: 'baseline-2',
      projectId: 'project-1',
      requirements: [
        { id: 'REQ-1', title: 'List products' },
        { id: 'REQ-2', title: 'Add product' },
        { id: 'REQ-3', title: 'Export (not yet specified)' },
      ],
      acceptanceCriteria: [
        { id: 'AC-1', requirementId: 'REQ-1', description: 'Filter by name' },
        { id: 'AC-2', requirementId: 'REQ-1', description: 'Empty state' },
        { id: 'AC-3', requirementId: 'REQ-2', description: 'Validation' },
      ],
    },
    tasks: [
      { id: 'list', projectId: 'project-1', baselineId: 'baseline-2', title: 'List', status: 'verified', acIds: ['AC-1', 'AC-2'] },
      { id: 'form', projectId: 'project-1', baselineId: 'baseline-2', title: 'Form', status: 'ready', acIds: ['AC-3'] },
    ],
    evidence: [
      { id: 'manifest', projectId: 'project-1', baselineId: 'baseline-2', taskId: 'list', kind: 'result_manifest', sourceRevision: revision, rawReportHash: null },
      { id: 'tests', projectId: 'project-1', baselineId: 'baseline-2', taskId: 'list', kind: 'test', sourceRevision: revision, rawReportHash: reportHash },
    ],
    limit: 100,
    ...overrides,
  }
}

describe('buildTraceability', () => {
  it('builds requirement → AC → task → evidence rows in baseline order, keeping gaps as null links', () => {
    const batch = buildTraceability(input())
    expect(batch.rows.map((row) => [row.requirementId, row.acId, row.taskId, row.evidenceId])).toEqual([
      ['REQ-1', 'AC-1', 'list', 'manifest'],
      ['REQ-1', 'AC-1', 'list', 'tests'],
      ['REQ-1', 'AC-2', 'list', 'manifest'],
      ['REQ-1', 'AC-2', 'list', 'tests'],
      ['REQ-2', 'AC-3', 'form', null],
      ['REQ-3', null, null, null],
    ])
    expect(batch.rows[1]).toMatchObject({ evidenceKind: 'test', countsAsAcEvidence: true, sourceRevision: revision, rawReportHash: reportHash, taskStatus: 'verified' })
    expect(batch).toMatchObject({ projectId: 'project-1', baselineId: 'baseline-2', totalRows: 6, truncated: false, issues: [] })
  })

  it('shows an AC without any task as an uncovered row', () => {
    const batch = buildTraceability(input({ tasks: [] }))
    expect(batch.rows.filter((row) => row.acId === 'AC-3')).toEqual([
      expect.objectContaining({ requirementId: 'REQ-2', acId: 'AC-3', taskId: null, evidenceId: null, countsAsAcEvidence: false }),
    ])
  })

  it('reports an unknown AC reference and keeps it as a row instead of dropping it', () => {
    const tasks = [...input().tasks, { id: 'rogue', projectId: 'project-1', baselineId: 'baseline-2', title: 'Rogue', status: 'draft' as const, acIds: ['AC-9'] }]
    const batch = buildTraceability(input({ tasks }))
    expect(batch.issues).toEqual([{ code: 'unknown_ac', taskId: 'rogue', acId: 'AC-9' }])
    expect(batch.rows.at(-1)).toMatchObject({ requirementId: null, acId: 'AC-9', taskId: 'rogue' })
    expect(buildTraceability(input()).issues).toEqual([])
  })

  it('excludes tasks and evidence of another baseline or project', () => {
    const tasks = [...input().tasks, { id: 'old', projectId: 'project-1', baselineId: 'baseline-1', title: 'Old', status: 'verified' as const, acIds: ['AC-3'] }]
    const evidence = [
      ...input().evidence,
      { id: 'old-result', projectId: 'project-1', baselineId: 'baseline-1', taskId: 'form', kind: 'result_manifest' as const, sourceRevision: revision, rawReportHash: null },
      { id: 'foreign', projectId: 'project-2', baselineId: 'baseline-2', taskId: 'form', kind: 'test' as const, sourceRevision: revision, rawReportHash: reportHash },
    ]
    const batch = buildTraceability(input({ tasks, evidence }))
    expect(batch.rows.map((row) => row.taskId)).not.toContain('old')
    expect(batch.rows.map((row) => row.evidenceId)).not.toContain('old-result')
    expect(batch.rows.map((row) => row.evidenceId)).not.toContain('foreign')
    expect(batch.totalRows).toBe(6)
  })

  it('returns no rows for a baseline of another project', () => {
    const batch = buildTraceability(input({ baseline: { ...input().baseline, projectId: 'project-2' } }))
    expect(batch.rows).toEqual([])
    expect(batch.totalRows).toBe(0)
  })

  it('flags a reference-material row as not counting towards AC proof', () => {
    const evidence = [{ id: 'wp-report', projectId: 'project-1', baselineId: 'baseline-2', taskId: 'form', kind: 'reference_material' as const, sourceRevision: null, rawReportHash: null }]
    const row = buildTraceability(input({ evidence })).rows.find((candidate) => candidate.evidenceId === 'wp-report')
    expect(row).toMatchObject({ acId: 'AC-3', countsAsAcEvidence: false })
  })

  it('keeps an AC whose requirement is missing, and does not duplicate rows for an AC listed twice', () => {
    const baseline = {
      ...input().baseline,
      acceptanceCriteria: [...input().baseline.acceptanceCriteria, { id: 'AC-4', requirementId: 'REQ-X', description: 'Orphan' }],
    }
    const tasks = [{ id: 'form', projectId: 'project-1', baselineId: 'baseline-2', title: 'Form', status: 'ready' as const, acIds: ['AC-3', 'AC-3', 'AC-4'] }]
    const batch = buildTraceability(input({ baseline, tasks, evidence: [] }))
    expect(batch.rows.filter((row) => row.acId === 'AC-3')).toHaveLength(1)
    expect(batch.rows.at(-1)).toMatchObject({ requirementId: 'REQ-X', acId: 'AC-4', taskId: 'form' })
    expect(batch.issues).toEqual([])
  })

  it('truncates to the limit and says so, while a limit covering every row does not', () => {
    const truncated = buildTraceability(input({ limit: 4 }))
    expect(truncated.rows).toHaveLength(4)
    expect(truncated).toMatchObject({ totalRows: 6, truncated: true, limit: 4 })
    expect(buildTraceability(input({ limit: 6 }))).toMatchObject({ totalRows: 6, truncated: false })
  })

  it('clamps the limit to 1…MAX_TRACEABILITY_ROWS', () => {
    expect(buildTraceability(input({ limit: 0 })).limit).toBe(1)
    expect(buildTraceability(input({ limit: 50_000 })).limit).toBe(MAX_TRACEABILITY_ROWS)
    expect(buildTraceability(input({ limit: Number.NaN })).limit).toBe(MAX_TRACEABILITY_ROWS)
  })
})
