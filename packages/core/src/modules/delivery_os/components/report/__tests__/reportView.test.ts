import { deliveryReportV1Schema, type SourceRevision } from '../../../lib/contracts'
import fixture from '../../../lib/fixtures/delivery-report.v1.json'
import { currentReportDecision, formatRevisionRef, readReportSelection, reportHistoryHref, reportRetryDelay, shouldPollReport } from '../reportView'

describe('report identity and waiting policy', () => {
  it.each<SourceRevision>([
    { kind: 'git', commitSha: 'a'.repeat(40) },
    { kind: 'snapshot', contentHash: 'b'.repeat(64), externalWorkspaceId: 'wp:workspace/one' },
  ])('round trips a pinned $kind revision without dropping workspace identity', (revision) => {
    const report = { ...deliveryReportV1Schema.parse(fixture), revision }
    const href = reportHistoryHref(report)!
    expect(readReportSelection(href.split('?')[1])).toEqual({ kind: 'history', baselineId: report.baselineId, revision })
    expect(href).toContain(encodeURIComponent(formatRevisionRef(revision)))
  })

  it.each(['baselineId=bad', `baselineId=${fixture.baselineId}`, 'revision=git:bad',
    `baselineId=${fixture.baselineId}&revision=git:${'a'.repeat(40)}&revision=git:${'b'.repeat(40)}`,
    `baselineId=${fixture.baselineId}&revision=snapshot:${'a'.repeat(64)}`,
  ])('rejects incomplete, invalid and ambiguous history: %s', (query) => {
    expect(readReportSelection(query).kind).toBe('invalid')
  })

  it('does not pin a missing revision', () => {
    expect(readReportSelection('')).toEqual({ kind: 'current' })
    expect(reportHistoryHref({ ...deliveryReportV1Schema.parse(fixture), revision: null })).toBeNull()
  })

  it('requires a current matching consent, stops on rejection, ignores a release for another build', () => {
    const report = deliveryReportV1Schema.parse(fixture)
    const consent = { ...report.decisions[1], kind: 'deploy' as const, appliesToRevision: true, decidedAt: '2026-09-19T10:00:00Z' }
    report.decisions = [consent]
    expect(shouldPollReport(report, false)).toBe(true)
    expect(shouldPollReport(report, true)).toBe(false)
    report.decisions.push({ ...consent, id: 'later', verdict: 'rejected', decidedAt: '2026-09-19T10:30:00Z' })
    expect(shouldPollReport(report, false)).toBe(false)
    report.decisions = [{ ...consent, subjectHash: 'c'.repeat(64) }]
    expect(shouldPollReport(report, false)).toBe(false)
    report.decisions = [consent, { ...consent, kind: 'release', subjectType: 'deployment_evidence', subjectId: 'another-build' }]
    expect(shouldPollReport(report, false)).toBe(true)
  })

  it('orders timestamps by instant rather than their UTC offset string', () => {
    const report = deliveryReportV1Schema.parse(fixture)
    const consent = { ...report.decisions[1], appliesToRevision: true, decidedAt: '2026-09-19T12:00:00+02:00' }
    report.decisions = [consent, { ...consent, id: 'later', verdict: 'rejected', decidedAt: '2026-09-19T10:30:00Z' }]
    expect(currentReportDecision(report, 'deploy')?.verdict).toBe('rejected')
  })

  it('caps retry backoff at one minute', () => {
    expect([1, 2, 3, 4, 10].map(reportRetryDelay)).toEqual([10000, 20000, 40000, 60000, 60000])
  })
})
