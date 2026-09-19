/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { deliveryReportV1Schema } from '../../../lib/contracts'
import fixture from '../../../lib/fixtures/delivery-report.v1.json'
import { EvidenceTable } from '../EvidenceTable'
import { EvidenceSources } from '../EvidenceSources'
import { EvidenceDetailDialog } from '../EvidenceDetailDialog'

const mockApiCall = jest.fn()
const translate = (key: string) => key === 'delivery_os.report.evidence.forbidden' ? 'Evidence access denied' : key
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => translate, useOptionalT: () => translate }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: (...args: unknown[]) => mockApiCall(...args) }))
jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({ useOrganizationScopeVersion: () => 0 }))
jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: ({ data, pagination, emptyState }: { data: { id: string; acId: string | null }[]; pagination?: { page: number; total: number; onPageChange: (page: number) => void }; emptyState?: React.ReactNode }) => <div>
    {pagination ? <><span data-testid="page">{pagination.page}</span><span data-testid="total">{pagination.total}</span></> : null}
    {data.map((row) => <div data-testid="row" key={row.id}>{row.acId}</div>)}
    {data.length === 0 ? emptyState : null}
    {pagination ? <button type="button" onClick={() => pagination.onPageChange(pagination.page + 1)}>Next</button> : null}
  </div>,
}))

beforeEach(() => { mockApiCall.mockReset(); mockApiCall.mockResolvedValue({ ok: false, status: 403 }) })

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

  it('distinguishes a forbidden scoped read from an empty evidence collection', async () => {
    render(<EvidenceSources projectId={fixture.projectId} baselineId={fixture.baselineId} revision={null} onEvidenceSelect={() => undefined} />)
    expect(await screen.findByText('Evidence access denied')).toBeTruthy()
    expect(screen.queryByText('delivery_os.report.evidence.sourcesEmpty')).toBeNull()
    expect(mockApiCall).toHaveBeenCalledWith(expect.stringContaining(`/projects/${fixture.projectId}/evidence?baselineId=${fixture.baselineId}&group=baseline`), expect.any(Object))
    fireEvent.click(screen.getByRole('button', { name: 'delivery_os.report.evidence.retry' }))
    await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(2))
  })

  it('shows the selected ID and denied read without a fabricated payload, and closes on Escape', async () => {
    const onOpenChange = jest.fn()
    render(<EvidenceDetailDialog projectId={fixture.projectId} evidenceId={fixture.rows[0].evidenceId} onOpenChange={onOpenChange} />)
    expect(screen.getByText(fixture.rows[0].evidenceId)).toBeTruthy()
    expect(await screen.findByText('Evidence access denied')).toBeTruthy()
    expect(screen.getByRole('dialog').querySelector('pre')).toBeNull()
    expect(screen.queryByText('delivery_os.report.evidence.noFiles')).toBeNull()
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
