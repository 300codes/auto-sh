/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { deliveryReportV1Schema, type ReportGateBlocker } from '../../../lib/contracts'
import fixture from '../../../lib/fixtures/delivery-report.v1.json'
import { gateBlockerAnchor, gateBlockerSentenceKey } from '../gateBlockers'
import { ReportSummary } from '../ReportSummary'

const translate = (key: string) => key
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => translate, useOptionalT: () => translate }))
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}))

function blocker(overrides: Partial<ReportGateBlocker> = {}): ReportGateBlocker {
  return { kind: 'ac', id: 'AC-1', status: 'failed', ...overrides }
}

describe('report gate blockers', () => {
  it('points every recognised blocker kind at the section that explains it', () => {
    expect(gateBlockerAnchor(blocker())).toBe('#report-ac-AC-1')
    expect(gateBlockerAnchor(blocker({ kind: 'scan', id: 'security' }))).toBe('#report-scan-security')
    expect(gateBlockerAnchor(blocker({ kind: 'deployment', id: 'deployment' }))).toBe('#report-deployment')
    expect(gateBlockerAnchor(blocker({ kind: 'revision', id: 'revision' }))).toBe('#report-summary')
    expect(gateBlockerAnchor(blocker({ kind: 'deploy_decision', id: 'decision' }))).toBe('#report-decisions')
  })

  it('names a sentence key per blocker kind instead of concatenating identifiers', () => {
    expect(gateBlockerSentenceKey(blocker())).toBe('delivery_os.report.gate.blockerSentence.ac')
    expect(gateBlockerSentenceKey(blocker({ kind: 'deployment' }))).toBe('delivery_os.report.gate.blockerSentence.deployment')
  })

  it('renders gate blockers as linked sentences, never as a raw "kind: id — status" string', () => {
    const report = deliveryReportV1Schema.parse(fixture)
    report.gates.releasable = {
      ok: false,
      blocking: [blocker({ id: report.acceptanceCriteria[0].acId }), blocker({ kind: 'deployment', id: 'deployment', status: 'unverified' })],
    }
    render(<ReportSummary report={report} readAt="2026-09-19T12:00:00Z" />)

    const sentences = screen.getAllByText('delivery_os.report.gate.blockerSentence.ac')
    expect(sentences).toHaveLength(1)
    expect(sentences[0].getAttribute('href')).toBe(`#report-ac-${report.acceptanceCriteria[0].acId}`)
    expect(screen.getByText('delivery_os.report.gate.blockerSentence.deployment').getAttribute('href')).toBe('#report-deployment')
    expect(screen.queryByText(/failed$/)).toBeNull()
    expect(screen.getByText('delivery_os.report.gate.noBlockers')).toBeTruthy()
  })
})
