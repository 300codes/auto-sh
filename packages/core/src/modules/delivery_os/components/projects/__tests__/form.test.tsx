/** @jest-environment jsdom */
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { projectCreateSchema } from '@open-mercato/core/modules/delivery_os/data/validators'
import { DEFAULT_DELIVERY_LIMITS } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import { TARGET_PROFILES } from '@open-mercato/core/modules/delivery_os/lib/targetProfiles'
import CreateDeliveryProjectPage from '../../../backend/delivery/projects/create/page'
import { metadata } from '../../../backend/delivery/projects/create/page.meta'
import { DeliveryProjectForm } from '../DeliveryProjectForm'
import { INPUT_MODE_VALUES, InputModeChoice } from '../InputModeChoice'

type CrudFormProps = {
  fields: Array<{ id: string; type: string; required?: boolean; options?: Array<{ value: string; label: string }> }>
  initialValues: Record<string, unknown>
  onSubmit: (values: Record<string, unknown>) => Promise<void>
  [key: string]: unknown
}

const crudFormMock = jest.fn()
const createCrudMock = jest.fn()
const pushMock = jest.fn()

const translate = (key: string) => key
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => translate }))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: (...args: unknown[]) => pushMock(...args) }) }))
jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: CrudFormProps) => { crudFormMock(props); return <form data-testid="crud-form" /> },
}))
jest.mock('@open-mercato/ui/backend/utils/crud', () => ({ createCrud: (...args: unknown[]) => createCrudMock(...args) }))

const projectId = '11111111-1111-4111-8111-111111111111'
const updatedAt = '2026-09-19T10:00:00.000Z'

function lastFormProps(): CrudFormProps {
  return crudFormMock.mock.calls.at(-1)?.[0] as CrudFormProps
}

function submitValues(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const profile = TARGET_PROFILES[0]
  return {
    name: '  Delivery form project  ',
    inputMode: 'from_design',
    targetProfile: `${profile.id}@${profile.version}`,
    repositoryRef: '',
    brief: 'Ship the thing',
    maxParallelTasks: 3,
    maxCorrectionRounds: 1,
    attemptTimeoutMinutes: 45,
    ...overrides,
  }
}

beforeEach(() => {
  crudFormMock.mockReset()
  createCrudMock.mockReset()
  pushMock.mockReset()
})

it('guards creation with the feature the POST route requires and keeps the page out of the sidebar', () => {
  expect(metadata).toMatchObject({ requireAuth: true, requireFeatures: ['delivery_os.projects.manage'], navHidden: true })
  expect(metadata.breadcrumb).toHaveLength(2)
  expect(metadata.breadcrumb[0].href).toBe('/backend/delivery/projects')
})

it('renders exactly the inputs the create schema accepts', () => {
  render(<CreateDeliveryProjectPage />)
  const fields = lastFormProps().fields
  expect(fields.map((field) => field.id)).toEqual([
    'name',
    'inputMode',
    'targetProfile',
    'repositoryRef',
    'brief',
    'maxParallelTasks',
    'maxCorrectionRounds',
    'attemptTimeoutMinutes',
  ])
  expect(fields.find((field) => field.id === 'name')?.required).toBe(true)
  expect(INPUT_MODE_VALUES).toEqual(['from_brief', 'from_design'])
  expect(fields.find((field) => field.id === 'inputMode')?.type).toBe('custom')
  expect(fields.find((field) => field.id === 'targetProfile')?.options?.map((option) => option.value))
    .toEqual(TARGET_PROFILES.map((profile) => `${profile.id}@${profile.version}`))
  expect(fields.some((field) => field.id === 'draftSpec')).toBe(false)
  expect(fields.some((field) => field.id === 'updatedAt')).toBe(false)
})

it('seeds the execution limits from the shared defaults', () => {
  render(<CreateDeliveryProjectPage />)
  expect(lastFormProps().initialValues).toMatchObject({
    inputMode: 'from_brief',
    maxParallelTasks: DEFAULT_DELIVERY_LIMITS.maxParallelTasks,
    maxCorrectionRounds: DEFAULT_DELIVERY_LIMITS.maxCorrectionRounds,
    attemptTimeoutMinutes: DEFAULT_DELIVERY_LIMITS.attemptTimeoutMinutes,
  })
})

it('posts a payload the create schema accepts and lands on the new project', async () => {
  createCrudMock.mockResolvedValue({ ok: true, status: 201, result: { id: projectId, updatedAt } })
  render(<CreateDeliveryProjectPage />)
  await act(async () => { await lastFormProps().onSubmit(submitValues()) })

  const [apiPath, payload] = createCrudMock.mock.calls.at(-1) as [string, Record<string, unknown>]
  expect(apiPath).toBe('delivery_os/projects')
  expect(projectCreateSchema.safeParse(payload).success).toBe(true)
  expect(payload).toMatchObject({
    name: 'Delivery form project',
    inputMode: 'from_design',
    targetProfileId: TARGET_PROFILES[0].id,
    targetProfileVersion: TARGET_PROFILES[0].version,
    brief: 'Ship the thing',
    repositoryRef: null,
    limits: { maxParallelTasks: 3, maxCorrectionRounds: 1, attemptTimeoutMinutes: 45 },
  })
  await waitFor(() => expect(pushMock).toHaveBeenCalledWith(`/backend/delivery/projects/${projectId}`))
})

it('refuses to report success when the create response is not the documented body', async () => {
  createCrudMock.mockResolvedValue({ ok: true, status: 201, result: { created: true } })
  render(<CreateDeliveryProjectPage />)
  await expect(lastFormProps().onSubmit(submitValues())).rejects.toThrow()
  expect(pushMock).not.toHaveBeenCalled()
})

it('refuses to post when no target profile was chosen', async () => {
  render(<CreateDeliveryProjectPage />)
  await expect(lastFormProps().onSubmit(submitValues({ targetProfile: '' }))).rejects.toThrow()
  expect(createCrudMock).not.toHaveBeenCalled()
})

it('keeps the shared form free of any create-versus-edit knowledge', async () => {
  const onSubmit = jest.fn(async () => undefined)
  render(
    <DeliveryProjectForm
      title="title"
      submitLabel="submit"
      backHref="/back"
      cancelHref="/cancel"
      fields={[{ id: 'name', label: 'Name', type: 'text' }]}
      initialValues={{ name: 'x' }}
      onSubmit={onSubmit}
      optimisticLockUpdatedAt={updatedAt}
    />,
  )
  const props = lastFormProps()
  expect(props.fields).toEqual([{ id: 'name', label: 'Name', type: 'text' }])
  expect(props.initialValues).toEqual({ name: 'x' })
  expect(props.onSubmit).toBe(onSubmit)
  expect(props.optimisticLockUpdatedAt).toBe(updatedAt)
  expect(Object.keys(props)).not.toContain('mode')
  expect(Object.keys(props)).not.toContain('apiPath')
})

it('states the consequence of each specification start and reports the picked mode', () => {
  const setValue = jest.fn()
  render(<InputModeChoice id="inputMode" value="from_brief" setValue={setValue} />)
  for (const mode of INPUT_MODE_VALUES) {
    expect(screen.getByText(`delivery_os.projects.inputMode.${mode}`)).toBeTruthy()
    expect(screen.getByText(`delivery_os.projects.form.inputMode.consequence.${mode}`)).toBeTruthy()
  }
  expect(screen.getByTestId('input-mode-from_brief').getAttribute('data-state')).toBe('checked')
  fireEvent.click(screen.getByTestId('input-mode-from_design'))
  expect(setValue).toHaveBeenCalledWith('from_design')
})
