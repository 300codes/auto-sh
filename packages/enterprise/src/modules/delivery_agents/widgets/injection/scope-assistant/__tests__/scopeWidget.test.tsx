/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import ScopeAssistant from '../widget.client'
const translate = (key: string) => key
const chat = jest.fn()
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => translate, useOptionalT: () => translate }))
jest.mock('@open-mercato/ui/ai/AiChat', () => ({ AiChat: (props: unknown) => { chat(props); return <div data-testid="scope-chat" /> } }))
const context = { schemaVersion: 'delivery-scoping-context.v1' as const, projectId: '44444444-4444-4444-8444-444444444444', intakeUpdatedAt: '2026-09-19T10:00:00.000Z' }
test('page load and remount do not start a Scope conversation; explicit open uses the selected project', () => {
  chat.mockClear()
  const view = render(<ScopeAssistant context={context} />)
  expect(chat).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'delivery_agents.scope.open' }))
  expect(chat).toHaveBeenCalledWith(expect.objectContaining({ agent: 'delivery_agents.scope', pageContext: expect.objectContaining({ recordId: context.projectId }) }))
  view.unmount()
  chat.mockClear()
  render(<ScopeAssistant context={context} />)
  expect(chat).not.toHaveBeenCalled()
})
