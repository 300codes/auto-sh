/** @jest-environment node */

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback?: string) => fallback ?? _key }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => require('./routeTestKit').findMock)
jest.mock('@open-mercato/shared/lib/di/container', () => require('./routeTestKit').containerMock)
jest.mock('@open-mercato/shared/lib/auth/server', () => require('./routeTestKit').authServerMock)
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => require('./routeTestKit').organizationScopeMock)
jest.mock('../../events', () => ({ emitDeliveryOsEvent: jest.fn(async () => undefined) }))

import '@open-mercato/core/modules/delivery_os/commands'
import { POST, metadata, openApi } from '../projects/[id]/flow/pin/route'
import { FOREIGN_ORG_ID, STALE_UPDATED_AT } from '../../commands/__tests__/baselineTestKit'
import { deliveryFlowErrorBodySchema, flowPinResponseSchema } from '../../lib/contracts'
import { hashFlowTemplate } from '../../lib/flowRules'
import { DEFAULT_FLOW_TEMPLATE } from '../../lib/flowTemplates'
import { createProject, expectStatus, projectVersion, type Json } from './flowHelpers'
import {
  ALL_FEATURES,
  EMPLOYEE_FEATURES,
  FOREIGN_TENANT_ID,
  apiRequest,
  isAllowedBy,
  readBody,
  resetRouteState,
  routeParams,
  routeState,
  signInAs,
} from './routeTestKit'

const PIN_BODY = { templateId: DEFAULT_FLOW_TEMPLATE.templateId, templateVersion: DEFAULT_FLOW_TEMPLATE.version }

function pin(projectId: string, body: Json, lock: string | Date | null): Promise<Response> {
  return POST(apiRequest('POST', `/projects/${projectId}/flow/pin`, { body, lock }), routeParams(projectId))
}

async function expectFlowError(response: Response, status: number, code: string): Promise<Json> {
  const body = await readBody(response)
  expect({ status: response.status, code: body.code }).toEqual({ status, code })
  expect(deliveryFlowErrorBodySchema.safeParse(body).success).toBe(true)
  return body
}

async function newProject(): Promise<string> {
  return (await createProject({ targetProfileId: 'wordpress-theme' })).id as string
}

beforeEach(() => {
  resetRouteState()
})

describe('POST /projects/:id/flow/pin (F4)', () => {
  it('requires flow.manage, which the employee set does not carry', () => {
    expect(isAllowedBy(metadata, 'POST', ['delivery_os.flow.manage'])).toBe(true)
    expect(isAllowedBy(metadata, 'POST', EMPLOYEE_FEATURES)).toBe(false)
    expect(isAllowedBy(metadata, 'POST', ALL_FEATURES)).toBe(true)
    expect(openApi.methods.POST?.responses?.map((response) => response.status)).toEqual([201, 200])
  })

  it('pins once (201) and answers a replay with the same body (200) without a header, write-once', async () => {
    const projectId = await newProject()
    const created = await expectStatus(await pin(projectId, PIN_BODY, await projectVersion(projectId)), 201)
    const parsed = flowPinResponseSchema.parse(created)
    expect(created).not.toHaveProperty('duplicate')
    expect(parsed.template).toEqual({ templateId: PIN_BODY.templateId, version: PIN_BODY.templateVersion, hash: hashFlowTemplate(DEFAULT_FLOW_TEMPLATE) })
    expect(routeState.store.projects[0]).toMatchObject({ flowTemplateId: PIN_BODY.templateId, flowTemplateHash: parsed.template.hash })

    const replay = await expectStatus(await pin(projectId, PIN_BODY, null), 200)
    expect(replay).toEqual(created)
  })

  it('refuses another template once pinned (409 flow_already_pinned) and keeps the stored pin', async () => {
    const projectId = await newProject()
    await expectStatus(await pin(projectId, PIN_BODY, await projectVersion(projectId)), 201)
    const other = { ...PIN_BODY, templateVersion: 2 }
    await expectFlowError(await pin(projectId, other, await projectVersion(projectId)), 409, 'flow_already_pinned')
    expect(routeState.store.projects[0].flowTemplateVersion).toBe(1)
  })

  it('answers 428 without the project header and 409 on a stale one', async () => {
    const projectId = await newProject()
    await expectFlowError(await pin(projectId, PIN_BODY, null), 428, 'optimistic_lock_required')
    const stale = await pin(projectId, PIN_BODY, STALE_UPDATED_AT)
    expect({ status: stale.status, code: (await readBody(stale)).code }).toEqual({ status: 409, code: 'optimistic_lock_conflict' })
    expect(routeState.store.projects[0].flowTemplateId ?? null).toBeNull()
  })

  it('refuses an unknown template (422) and a malformed body (400)', async () => {
    const projectId = await newProject()
    await expectFlowError(await pin(projectId, { templateId: 'no-such-flow', templateVersion: 1 }, await projectVersion(projectId)), 422, 'unknown_flow_template')
    await expectFlowError(await pin(projectId, { templateId: PIN_BODY.templateId }, await projectVersion(projectId)), 400, 'validation_failed')
  })

  it.each([
    ['tenant', { tenantId: FOREIGN_TENANT_ID }],
    ['organization', { orgId: FOREIGN_ORG_ID }],
  ])('hides a project of another %s behind 404', async (_label, foreign) => {
    const projectId = await newProject()
    const lock = await projectVersion(projectId)
    signInAs(foreign)
    await expectFlowError(await pin(projectId, PIN_BODY, lock), 404, 'not_found')
    expect(routeState.store.projects[0].flowTemplateId ?? null).toBeNull()
  })
})
