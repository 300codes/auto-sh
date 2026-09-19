/** @jest-environment jsdom */
import * as React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { WorkflowStudioLink } from '../WorkflowStudioLink'
import { FigmaSync } from '../../stages/FigmaSync'
const api = jest.fn()
const translate = (key: string) => key
let submit: (values: Record<string, unknown>) => Promise<void>
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => translate, useOptionalT: () => translate }))
jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({ useBackendChrome: () => ({ payload: { grantedFeatures: ['*'] } }) }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: (...args: unknown[]) => api(...args) }))
jest.mock('@open-mercato/ui/backend/CrudForm', () => ({ CrudForm: (props: { onSubmit: typeof submit }) => { submit = props.onSubmit; return <div data-testid="figma-form" /> } }))
const projectId = '44444444-4444-4444-8444-444444444444'
const definitionId = '55555555-5555-4555-8555-555555555555'
const nextId = '66666666-6666-4666-8666-666666666666'
const binding = { schemaVersion: 'delivery-workflow-binding.v1', projectId, binding: { definitionId, version: 3, workflowId: 'delivery.process', workflowInstanceId: null, studioHref: `/backend/definitions/visual-editor?id=${definitionId}` } }
beforeEach(() => { api.mockReset() })
test('Studio uses only the verified scoped definition link and clears it immediately on project change', async () => {
  api.mockResolvedValueOnce({ ok: true, result: binding })
  const view = render(<WorkflowStudioLink projectId={projectId} />)
  expect(await screen.findByRole('link')).toHaveAttribute('href', binding.binding.studioHref)
  api.mockReturnValue(new Promise(() => undefined))
  view.rerender(<WorkflowStudioLink projectId={nextId} />)
  expect(screen.queryByRole('link')).toBeNull()
})
test('missing optional plugin produces no broken link; an untrusted Studio URL is rejected', async () => {
  api.mockResolvedValueOnce({ ok: false, status: 404 })
  const view = render(<WorkflowStudioLink projectId={projectId} />)
  await act(async () => undefined)
  expect(screen.queryByRole('link')).toBeNull()
  expect(screen.queryByText('delivery_os.flow.workflowBindingError')).toBeNull()
  view.unmount()
  api.mockResolvedValueOnce({ ok: true, result: { ...binding, binding: { ...binding.binding, studioHref: 'https://foreign.example.invalid' } } })
  render(<WorkflowStudioLink projectId={projectId} />)
  await screen.findByText('delivery_os.flow.workflowBindingError')
  expect(screen.queryByRole('link')).toBeNull()
})
test('Figma reports partial synchronization and retries the explicit same source/stage/artifact without claiming completion', async () => {
  api.mockResolvedValueOnce({ ok: true, status: 207, result: { schemaVersion: 'delivery.figma-sync/v1', complete: false, results: [] } })
  const changed = jest.fn(async () => undefined)
  render(<FigmaSync projectId={projectId} stageId="ux" artifactId={definitionId} onChanged={changed} />)
  await act(async () => { await submit({ fileKey: 'figma-file' }) })
  await screen.findByText('delivery_os.figmaSync.partial')
  expect(JSON.parse(api.mock.calls[0][1].body)).toEqual({ fileKey: 'figma-file', stageId: 'ux', artifactId: definitionId })
  api.mockResolvedValueOnce({ ok: true, status: 200, result: { schemaVersion: 'delivery.figma-sync/v1', complete: true, results: [] } })
  await act(async () => { await submit({ fileKey: 'figma-file' }) })
  await screen.findByText('delivery_os.figmaSync.complete')
  expect(api.mock.calls[1]).toEqual(api.mock.calls[0])
  expect(changed).toHaveBeenCalledTimes(2)
})
test('Figma unconfigured provider remains an error and never claims completion', async () => {
  api.mockResolvedValue({ ok: false, status: 422 })
  const changed = jest.fn(async () => undefined)
  render(<FigmaSync projectId={projectId} stageId="ux" artifactId={null} onChanged={changed} />)
  await expect(submit({ fileKey: 'figma-file' })).rejects.toThrow()
  expect(changed).not.toHaveBeenCalled()
  expect(screen.queryByText('delivery_os.figmaSync.complete')).toBeNull()
})
