/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { ReleaseDecisionActions } from '../ReleaseDecisionActions'

let mockFeatures: string[] = []
const translate = (key: string) => key
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => translate, useOptionalT: () => translate }))
jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({ useBackendChrome: () => ({ payload: { grantedFeatures: mockFeatures } }) }))
jest.mock('../ReleaseDecisionDialog', () => ({ ReleaseDecisionDialog: () => null }))

it.each([
  [['delivery_os.deploy.approve'], true, false],
  [['delivery_os.release.approve'], false, true],
  [['delivery_os.*'], true, true],
  [['*'], true, true],
  [[], false, false],
])('separates capabilities including wildcards: %j', (features, deploy, release) => {
  mockFeatures = features as string[]
  render(<ReleaseDecisionActions historical={false} archived={false} />)
  expect(Boolean(screen.queryByRole('button', { name: 'delivery_os.report.decisions.deploy' }))).toBe(deploy)
  expect(Boolean(screen.queryByRole('button', { name: 'delivery_os.report.decisions.release' }))).toBe(release)
  for (const button of screen.queryAllByRole('button')) expect(button.hasAttribute('disabled')).toBe(true)
})

it.each([[true, false], [false, true]])('removes mutations from history=%s/archive=%s', (historical, archived) => {
  mockFeatures = ['*']
  render(<ReleaseDecisionActions historical={historical} archived={archived} />)
  expect(screen.queryAllByRole('button')).toHaveLength(0)
})
