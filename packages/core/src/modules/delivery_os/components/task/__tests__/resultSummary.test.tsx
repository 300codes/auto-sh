/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { loadResultManifestFixture } from '@open-mercato/core/modules/delivery_os/lib/fixtures'
import englishMessages from '@open-mercato/core/modules/delivery_os/i18n/en.json'
import { ResultSummary, checkStatusMap } from '../ResultSummary'

const translate = (key: string) => key
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => translate, useOptionalT: () => translate }))

const manifest = loadResultManifestFixture()
const messages = englishMessages as Record<string, string>

function withChecks(statuses: Array<'passed' | 'failed' | 'not_run'>) {
  return {
    ...manifest,
    checks: statuses.map((status, index) => ({ ...manifest.checks[index % manifest.checks.length], checkId: `check-${index}`, status })),
  }
}

describe('ResultSummary — checks', () => {
  it('never paints a check that did not run as a success', () => {
    expect(checkStatusMap.not_run).not.toBe('success')
    expect(checkStatusMap.passed).toBe('success')
    expect(checkStatusMap.failed).toBe('error')
  })

  it('counts not_run apart from the passing checks and says why it matters', () => {
    render(<ResultSummary manifest={withChecks(['passed', 'passed', 'not_run', 'failed'])} source="manual" />)
    expect(screen.getByTestId('result-check-count-passed')).toBeTruthy()
    expect(screen.getByTestId('result-check-count-failed')).toBeTruthy()
    expect(screen.getByTestId('result-check-count-not_run')).toBeTruthy()
    expect(screen.getByTestId('result-not-run-caveat')).toBeTruthy()
  })

  it('drops the caveat when every check actually ran', () => {
    render(<ResultSummary manifest={withChecks(['passed', 'failed'])} source="manual" />)
    expect(screen.queryByTestId('result-not-run-caveat')).toBeNull()
  })

  it('states the English copy that keeps a not-run check out of the passing side', () => {
    expect(messages['delivery_os.task.result.checks.notRunCaveat']).toContain('proves nothing')
  })
})

describe('ResultSummary — usage', () => {
  it('reports an unknown usage as missing data, never as zero', () => {
    render(<ResultSummary manifest={manifest} source="manual" />)
    expect(screen.getByTestId('result-usage-unknown')).toBeTruthy()
    expect(screen.queryByTestId('result-usage-values')).toBeNull()
    expect(messages['delivery_os.task.result.usage.unknown']).toContain('not zero')
  })

  it('shows the measured values and who measured them', () => {
    const measured = {
      ...manifest,
      usage: { source: 'provider' as const, values: { inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.25 } },
    }
    render(<ResultSummary manifest={measured} source="manual" />)
    expect(screen.getByTestId('result-usage-values')).toBeTruthy()
    expect(screen.getByText('150')).toBeTruthy()
    expect(screen.queryByTestId('result-usage-unknown')).toBeNull()
  })

  it('says outright that usage does not survive a reload, and the English copy keeps saying it', () => {
    render(<ResultSummary manifest={manifest} source="manual" accepted />)
    expect(screen.getByTestId('result-usage-not-persisted')).toBeTruthy()
    const copy = messages['delivery_os.task.result.usage.notPersisted']
    expect(copy).toContain('no read endpoint')
    expect(copy).toContain('reloaded')
  })

  it('keeps the caveat out of the pre-submit preview, where nothing has been stored yet', () => {
    render(<ResultSummary manifest={manifest} source="manual" />)
    expect(screen.queryByTestId('result-usage-not-persisted')).toBeNull()
  })
})

describe('ResultSummary — provenance and content', () => {
  it('names the evidence source instead of leaving it implied', () => {
    const { unmount } = render(<ResultSummary manifest={manifest} source="manual" />)
    expect(screen.getByText('delivery_os.task.result.source.manual')).toBeTruthy()
    unmount()
    render(<ResultSummary manifest={manifest} source="adapter" />)
    expect(screen.getByText('delivery_os.task.result.source.adapter')).toBeTruthy()
  })

  it('lists every changed path and counts the artifacts', () => {
    render(<ResultSummary manifest={manifest} source="manual" />)
    expect(screen.getAllByTestId('result-changed-paths')[0].children).toHaveLength(manifest.changedPaths.length)
    expect(screen.getByTestId('result-changed-path-count').textContent).toBe(String(manifest.changedPaths.length))
  })

  it('says a result reports no findings rather than rendering an empty block', () => {
    render(<ResultSummary manifest={manifest} source="manual" />)
    expect(screen.getByText('delivery_os.task.result.findings.none')).toBeTruthy()
  })

  it('renders each finding with its severity', () => {
    const withFindings = {
      ...manifest,
      findings: [
        { severity: 'error' as const, message: 'The filter drops published services.', path: 'src/services.ts' },
        { severity: 'warning' as const, message: 'No empty state for the catalogue.', acId: 'AC-001' },
      ],
    }
    render(<ResultSummary manifest={withFindings} source="manual" />)
    expect(screen.getByTestId('result-findings').children).toHaveLength(2)
    expect(screen.getByText('delivery_os.task.result.findings.severity.error')).toBeTruthy()
    expect(screen.getByText('delivery_os.task.result.findings.severity.warning')).toBeTruthy()
  })
})
