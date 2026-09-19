/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen, within } from '@testing-library/react'
import type { DeliveryReportV1, ReportDecision } from '../../../lib/contracts'
import { ReportSummary } from '../ReportSummary'
import { DeploymentSummary } from '../DeploymentSummary'
import { DecisionHistory } from '../DecisionHistory'

const translate = (key: string) => key
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => translate, useOptionalT: () => translate }))

function report(): DeliveryReportV1 {
  return {
    schemaVersion: 'delivery.report/v1', projectId: 'project', baselineId: 'baseline', baselineHash: 'a'.repeat(64),
    targetProfile: { id: 'wordpress', version: 1 }, revision: { kind: 'git', commitSha: 'b'.repeat(40) }, revisionSource: 'latest_result',
    acceptanceCriteria: [], rows: [], totalRows: 0, truncated: false, limit: 1000, issues: [], scans: [],
    deployment: { status: 'unverified', verificationStatus: 'failed', evidenceId: 'deployment', url: 'https://example.com/', environment: 'preview', buildId: 'build-1' },
    gates: { publishable: { ok: true, blocking: [] }, releasable: { ok: false, blocking: [{ kind: 'deployment', id: 'deployment', status: 'unverified' }] } },
    decisions: [], progress: { proven: 0, total: 0, unit: 'ac', percent: null }, usage: [{ source: 'runner', values: 'unknown', evidenceId: 'usage' }],
  }
}

describe('report summaries', () => {
  it('does not show a percentage when a revision is missing even if the payload contains zero', () => {
    const value = report()
    render(<ReportSummary report={{ ...value, revision: null, revisionSource: 'none', progress: { ...value.progress, total: 3, percent: 0 } }} readAt="2026-09-19T12:00:00Z" />)
    expect(screen.queryByText(/0%/)).toBeNull()
    expect(screen.getByText('delivery_os.report.summary.noRevision')).toBeTruthy()
  })

  it('keeps unknown usage and missing revision distinct from passing proof', () => {
    render(<ReportSummary report={{ ...report(), revision: null, revisionSource: 'none' }} readAt="2026-09-19T12:00:00Z" />)
    expect(screen.getAllByText('delivery_os.report.status.unknown').length).toBeGreaterThan(0)
    expect(screen.getByText('delivery_os.report.summary.noRevision')).toBeTruthy()
    expect(screen.queryByText('0%')).toBeNull()
    expect(screen.queryByText('delivery_os.report.status.passed')).toBeNull()
    expect(screen.getByText('delivery_os.report.summary.v1Scope')).toBeTruthy()
  })

  it('shows snapshot identity, latest-result caveat, and scan reported result separately', () => {
    const snapshot = { kind: 'snapshot' as const, contentHash: 'c'.repeat(64), externalWorkspaceId: 'wp:42' }
    render(<ReportSummary report={{ ...report(), revision: snapshot, scans: [{ checkId: 'security', status: 'present', reportedStatus: 'not_run', evidenceId: 'scan', rawReportHash: null }] }} readAt="2026-09-19T12:00:00Z" />)
    expect(screen.getByText(`snapshot:${snapshot.contentHash}`)).toBeTruthy()
    expect(screen.getByText('wp:42')).toBeTruthy()
    expect(screen.getByText('delivery_os.report.summary.latestResult')).toBeTruthy()
    expect(screen.getByText('delivery_os.report.status.present')).toBeTruthy()
    expect(screen.getByText('delivery_os.report.status.not_run')).toBeTruthy()
  })

  it.each(['javascript:alert(1)', 'data:text/html,bad', '//example.com/', 'https://user:secret@example.com/'])('does not link unsafe deployment URL %s', (url) => {
    const value = report()
    render(<DeploymentSummary report={{ ...value, deployment: { ...value.deployment, url } }} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('delivery_os.report.status.failed')).toBeTruthy()
    expect(screen.getByText('delivery_os.report.status.unverified')).toBeTruthy()
  })

  it('opens an allowed deployment address securely', () => {
    render(<DeploymentSummary report={report()} />)
    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toBe('https://example.com/')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('never applies a release of another build or another baseline to this report', () => {
    const value = report()
    const decision: ReportDecision = { id: 'old-build', kind: 'release', verdict: 'approved', subjectType: 'deployment_evidence', subjectId: 'old-evidence', subjectHash: 'old-hash', sourceRevision: value.revision, decidedAt: '2026-09-19T12:00:00Z', reason: null, appliesToRevision: true }
    value.decisions = [decision, { ...decision, id: 'same-build', subjectId: 'deployment' }, { ...decision, id: 'old-revision', subjectId: 'deployment', appliesToRevision: false }, { ...decision, id: 'old-baseline', kind: 'deploy', subjectType: 'baseline', subjectId: 'other-baseline', subjectHash: value.baselineHash }]
    render(<DecisionHistory report={value} />)
    for (const id of ['old-build', 'old-revision', 'old-baseline']) {
      expect(within(screen.getByTestId(`report-decision-${id}`)).getByText('delivery_os.report.history.historical')).toBeTruthy()
    }
    expect(within(screen.getByTestId('report-decision-same-build')).getByText('delivery_os.report.history.applies')).toBeTruthy()
  })

  it('marks an old approval historical after a later rejection of the same subject', () => {
    const value = report()
    const approval: ReportDecision = { id: 'approved', kind: 'deploy', verdict: 'approved', subjectType: 'baseline', subjectId: value.baselineId, subjectHash: value.baselineHash, sourceRevision: value.revision, decidedAt: '2026-09-19T12:00:00Z', reason: null, appliesToRevision: true }
    value.decisions = [approval, { ...approval, id: 'rejected', verdict: 'rejected', decidedAt: '2026-09-19T13:00:00Z' }]
    render(<DecisionHistory report={value} />)
    expect(within(screen.getByTestId('report-decision-approved')).getByText('delivery_os.report.history.historical')).toBeTruthy()
    expect(within(screen.getByTestId('report-decision-rejected')).getByText('delivery_os.report.history.applies')).toBeTruthy()
  })
})
