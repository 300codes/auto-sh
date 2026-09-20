/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { loadResultManifestFixture } from '@open-mercato/core/modules/delivery_os/lib/fixtures'
import { ResultSummary } from '../ResultSummary'
import { ResultCheckList } from '../ResultCheckList'

const translate = (key: string) => key
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => translate, useOptionalT: () => translate }))

const manifest = loadResultManifestFixture()

describe('a result manifest reads as checks, not as JSON', () => {
  it('renders one readable row per check with the test it ran and the criteria it proves', () => {
    render(<ResultSummary manifest={manifest} source="manual" />)
    expect(screen.getByTestId('result-checks').children).toHaveLength(manifest.checks.length)
    for (const check of manifest.checks) {
      const row = screen.getByTestId(`result-check-${check.checkId}`)
      expect(row.textContent).toContain(check.testId)
      for (const acId of check.acIds) {
        expect(screen.getByTestId(`result-check-criteria-${check.checkId}`).textContent).toContain(acId)
      }
    }
  })

  it('states the measurement of each check: exit code and duration', () => {
    render(<ResultSummary manifest={manifest} source="manual" />)
    const measured = manifest.checks[0]
    expect(screen.getByTestId(`result-check-meta-${measured.checkId}`).textContent)
      .toContain('delivery_os.task.result.checks.exitCode')
    expect(screen.getByTestId(`result-check-meta-${measured.checkId}`).textContent)
      .toContain(measured.durationMs >= 1000
        ? 'delivery_os.task.result.checks.durationSeconds'
        : 'delivery_os.task.result.checks.durationMillis')
  })

  it('never renders the manifest as a JSON document', () => {
    const { container } = render(<ResultSummary manifest={manifest} source="manual" />)
    expect(container.querySelector('textarea')).toBeNull()
    expect(container.textContent).not.toContain('"schemaVersion"')
  })

  it('puts the failures first and says the task cannot be verified on them', () => {
    const mixed = {
      ...manifest,
      checks: [
        { ...manifest.checks[0], checkId: 'passing', status: 'passed' as const },
        { ...manifest.checks[0], checkId: 'failing', status: 'failed' as const, exitCode: 1 },
      ],
    }
    render(<ResultCheckList checks={mixed.checks} />)
    expect(screen.getByTestId('result-checks').children[0].getAttribute('data-check-status')).toBe('failed')
    expect(screen.getByTestId('result-checks-failed-banner').textContent)
      .toBe('delivery_os.task.result.checks.failedBanner')
  })

  it('keeps check ids and report hashes out of the reading flow, one disclosure away', () => {
    render(<ResultCheckList checks={manifest.checks} />)
    expect(screen.queryByTestId('result-checks-technical')).toBeNull()
    fireEvent.click(screen.getByText('delivery_os.task.result.checks.technical.title'))
    expect(screen.getByTestId('result-checks-technical').textContent).toContain(manifest.checks[0].rawReportHash)
  })

  it('says a result with no check proves nothing', () => {
    render(<ResultCheckList checks={[]} />)
    expect(screen.getByTestId('result-checks-none').textContent).toBe('delivery_os.task.result.checks.none')
  })

  it('reports the run verdict at the top instead of leaving it to be counted', () => {
    const { unmount } = render(<ResultSummary manifest={manifest} source="manual" />)
    expect(screen.getByText('delivery_os.task.result.verdict.passed')).toBeTruthy()
    unmount()
    render(<ResultSummary manifest={{ ...manifest, checks: [{ ...manifest.checks[0], status: 'failed' }] }} source="manual" />)
    expect(screen.getByText('delivery_os.task.result.verdict.failed')).toBeTruthy()
  })
})
