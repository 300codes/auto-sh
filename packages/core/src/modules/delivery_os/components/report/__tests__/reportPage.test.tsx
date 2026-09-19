/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { DeliveryReport } from '../DeliveryReport'
import { ReleaseDecisionActions } from '../ReleaseDecisionActions'
import { metadata } from '../../../backend/delivery/projects/[id]/report/page.meta'
import type { ReportState } from '../useDeliveryReport'

const translate = (key: string) => ['error', 'forbidden', 'invalid'].some((status) => key === `delivery_os.report.${status}`) ? `Report ${key.split('.').pop()}` : key
let mockFeatures: string[] = []
let mockState: ReportState = { key: 'scope', status: 'loading', snapshot: null, stale: false, refreshing: true }
const mockRefresh = jest.fn()
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => translate, useOptionalT: () => translate }))
jest.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }))
jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({ useBackendChrome: () => ({ payload: { grantedFeatures: mockFeatures } }) }))
jest.mock('../useDeliveryReport', () => ({ useDeliveryReport: () => ({ state: mockState, refresh: mockRefresh, historical: false }) }))
jest.mock('@open-mercato/ui/backend/forms', () => ({ FormHeader: ({ title }: { title: string }) => <h1>{title}</h1> }))
jest.mock('../EvidenceTable', () => ({ EvidenceTable: () => null }))

beforeEach(() => {
  mockFeatures = []
  mockRefresh.mockReset()
  mockState = { key: 'scope', status: 'loading', snapshot: null, stale: false, refreshing: true }
})

describe('delivery report page', () => {
  it('requires view permission only and stays hidden from main navigation', () => {
    expect(metadata.requireAuth).toBe(true)
    expect(metadata.requireFeatures).toEqual(['delivery_os.projects.view'])
    expect(metadata.navHidden).toBe(true)
  })

  it.each(['invalid', 'forbidden', 'notFound', 'noBaseline', 'error'] as const)('renders a distinct %s state with project recovery', (status) => {
    mockState = { ...mockState, status, refreshing: false }
    render(<DeliveryReport projectId="project-id" />)
    expect(screen.getByText(translate(`delivery_os.report.${status}`))).toBeTruthy()
    expect(screen.getByRole('link', { name: 'delivery_os.report.project' }).getAttribute('href')).toBe('/backend/delivery/projects/project-id')
    expect(screen.queryByTestId('delivery-report-summary')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'delivery_os.report.refresh' }))
    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })

  it.each([
    { features: ['delivery_os.deploy.approve'], deploy: true, release: false },
    { features: ['delivery_os.release.approve'], deploy: false, release: true },
    { features: ['delivery_os.*'], deploy: true, release: true },
    { features: ['*'], deploy: true, release: true },
    { features: ['delivery_os.projects.view'], deploy: false, release: false },
  ])('keeps separate wildcard-aware ACL and blocks writes without D2/D3: $features', ({ features, deploy, release }) => {
    mockFeatures = features
    render(<ReleaseDecisionActions historical={false} archived={false} />)
    const deployButton = screen.queryByRole('button', { name: 'delivery_os.report.decisions.deploy' })
    const releaseButton = screen.queryByRole('button', { name: 'delivery_os.report.decisions.release' })
    expect(Boolean(deployButton)).toBe(deploy)
    expect(Boolean(releaseButton)).toBe(release)
    if (deployButton) expect(deployButton.hasAttribute('disabled')).toBe(true)
    if (releaseButton) expect(releaseButton.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('delivery_os.report.decisions.dependencies')).toBeTruthy()
  })

  it.each([{ historical: true, archived: false }, { historical: false, archived: true }])('offers no actions for history or archive', (props) => {
    mockFeatures = ['*']
    const { container } = render(<ReleaseDecisionActions {...props} />)
    expect(container.childElementCount).toBe(0)
  })
})
