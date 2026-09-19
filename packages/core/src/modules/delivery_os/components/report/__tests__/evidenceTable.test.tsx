/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { deliveryReportV1Schema } from '../../../lib/contracts'
import fixture from '../../../lib/fixtures/delivery-report.v1.json'
import { EvidenceTable } from '../EvidenceTable'
import { EvidenceSources } from '../EvidenceSources'
import { EvidenceDetailDialog } from '../EvidenceDetailDialog'

const mockEvidenceList = jest.fn()
const mockEvidenceDetail = jest.fn()
jest.mock('../useEvidenceRead', () => ({ useEvidenceList: (...args: unknown[]) => mockEvidenceList(...args), useEvidenceDetail: (...args: unknown[]) => mockEvidenceDetail(...args) }))
beforeEach(() => {
  mockEvidenceList.mockReset().mockReturnValue({ status: 'error', data: null, reload: jest.fn() })
  mockEvidenceDetail.mockReset().mockReturnValue({ status: 'notFound', data: null, reload: jest.fn() })
})

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => (key: string) => key === 'delivery_os.report.evidence.error' ? 'Evidence read failed' : key }))
jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: ({ data, pagination }: { data: { id: string; acId: string | null }[]; pagination: { page: number; total: number; onPageChange: (page: number) => void } }) => <div>
    <span data-testid="page">{pagination.page}</span><span data-testid="total">{pagination.total}</span>
    {data.map((row) => <div data-testid="row" key={row.id}>{row.acId}</div>)}
    <button type="button" onClick={() => pagination.onPageChange(pagination.page + 1)}>Next</button>
  </div>,
}))

describe('report evidence UI', () => {
  it('paginates only available relationships in batches of 50 despite a truncated server total', () => {
    const report = deliveryReportV1Schema.parse(fixture)
    report.rows = Array.from({ length: 60 }, (_, index) => ({ ...report.rows[0], acId: `AC-${index}` }))
    report.totalRows = 1300
    report.truncated = true
    render(<EvidenceTable report={report} />)
    expect(screen.getAllByTestId('row')).toHaveLength(50)
    expect(screen.getByTestId('total').textContent).toBe('60')
    expect(screen.getByText('delivery_os.report.evidence.truncated')).toBeTruthy()
    fireEvent.click(screen.getByText('Next'))
    expect(screen.getAllByTestId('row')).toHaveLength(10)
    expect(screen.getByText('AC-59')).toBeTruthy()
  })

  it('distinguishes a failed evidence read from an empty list or missing files', () => {
    render(<EvidenceSources projectId={fixture.projectId} baselineId={fixture.baselineId} revision={null} onEvidenceSelect={jest.fn()} />)
    expect(screen.getByText('Evidence read failed')).toBeTruthy()
    expect(screen.queryByText('delivery_os.report.evidence.sourcesEmpty')).toBeNull()
    expect(mockEvidenceList).toHaveBeenCalledWith(fixture.projectId, fixture.baselineId, null, 'baseline', 0)
    fireEvent.click(screen.getByRole('button', { name: 'delivery_os.report.evidence.retry' }))
    expect(mockEvidenceList.mock.results[0].value.reload).toHaveBeenCalledTimes(1)
  })

  it('shows the selected ID, never a fabricated payload, and closes on Escape', () => {
    const onOpenChange = jest.fn()
    render(<EvidenceDetailDialog projectId={fixture.projectId} evidenceId={fixture.rows[0].evidenceId} onOpenChange={onOpenChange} />)
    expect(screen.getByText(fixture.rows[0].evidenceId)).toBeTruthy()
    expect(screen.getByText('delivery_os.report.evidence.notFound')).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('returns focus to the evidence trigger after closing the real dialog', async () => {
    function Harness() {
      const [evidenceId, setEvidenceId] = React.useState<string | null>(null)
      return <>
        <button type="button" onClick={() => setEvidenceId(fixture.rows[0].evidenceId)}>Open evidence</button>
        <EvidenceDetailDialog projectId={fixture.projectId} evidenceId={evidenceId} onOpenChange={(open) => { if (!open) setEvidenceId(null) }} />
      </>
    }
    render(<Harness />)
    const trigger = screen.getByText('Open evidence')
    trigger.focus()
    fireEvent.click(trigger)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(document.activeElement).toBe(trigger))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
