/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import { EvidenceSources } from '../EvidenceSources'
import { EvidenceDetailDialog } from '../EvidenceDetailDialog'
const mockList = jest.fn()
const mockDetail = jest.fn()
jest.mock('../useEvidenceRead', () => ({ useEvidenceList: (...args: unknown[]) => mockList(...args), useEvidenceDetail: (...args: unknown[]) => mockDetail(...args) }))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => (key: string) => key }))
jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({ useOrganizationScopeVersion: () => 0 }))
jest.mock('@open-mercato/ui/backend/DataTable', () => ({ DataTable: ({ data, columns, emptyState }: { data: Array<Record<string, unknown>>; columns: Array<{ cell?: (input: { row: { original: Record<string, unknown> } }) => React.ReactNode }>; emptyState: string }) => <div>{data.length === 0 ? emptyState : data.map((row) => <div key={String(row.id)}>{columns.map((column, index) => <span key={index}>{column.cell?.({ row: { original: row } })}</span>)}</div>)}</div> }))
const revision = { kind: 'git' as const, commitSha: 'a'.repeat(40) }
beforeEach(() => { mockList.mockReset(); mockDetail.mockReset(); mockList.mockReturnValue({ status: 'ready', data: { items: [], nextOffset: null }, reload: jest.fn() }) })
it('shows separate revision and baseline groups, paging and selection', () => {
  mockList.mockReturnValue({ status: 'ready', data: { items: [{ id: 'evidence', kind: 'screenshot' }], nextOffset: 25 }, reload: jest.fn() })
  const onEvidenceSelect = jest.fn()
  render(<EvidenceSources projectId="project" baselineId="baseline" revision={revision} onEvidenceSelect={onEvidenceSelect} />)
  expect(screen.getByText('delivery_os.report.evidence.baselineNotice')).toBeTruthy()
  fireEvent.click(screen.getAllByRole('button', { name: 'evidence' })[0])
  expect(onEvidenceSelect).toHaveBeenCalledWith('evidence')
  fireEvent.click(screen.getAllByRole('button', { name: 'delivery_os.report.evidence.next' })[0])
  expect(mockList).toHaveBeenCalledWith('project', 'baseline', revision, 'revision', 25)
})
it('does not issue revision group reads without a revision', () => {
  render(<EvidenceSources projectId="project" baselineId="baseline" revision={null} onEvidenceSelect={jest.fn()} />)
  expect(mockList).toHaveBeenCalledTimes(1)
  expect(mockList).toHaveBeenCalledWith('project', 'baseline', null, 'baseline', 0)
})
it('shows an explicit unavailable detail instead of a fake empty payload', () => {
  mockDetail.mockReturnValue({ status: 'notFound', data: null, reload: jest.fn() })
  render(<EvidenceDetailDialog projectId="project" evidenceId="evidence" onOpenChange={jest.fn()} />)
  expect(screen.getByText('delivery_os.report.evidence.notFound')).toBeTruthy()
  expect(screen.queryByText('delivery_os.report.evidence.noFiles')).toBeNull()
})
it('renders safe read detail including nullable revision and missing files', () => {
  mockDetail.mockReturnValue({ status: 'ready', data: { kind: 'review', sourceRevision: null, rawReportHash: null, payload: { verdict: 'approved' }, attachments: [], attachmentsTruncated: false }, reload: jest.fn() })
  render(<EvidenceDetailDialog projectId="project" evidenceId="evidence" onOpenChange={jest.fn()} />)
  expect(screen.getByText('delivery_os.report.evidence.noFiles')).toBeTruthy()
  expect(screen.getByText(/"verdict": "approved"/)).toBeTruthy()
})
