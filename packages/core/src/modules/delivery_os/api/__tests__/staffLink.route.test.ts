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
import { metadata, openApi } from '../projects/[id]/staff-link/route'
import { ACTOR_ID, FOREIGN_ORG_ID, ORG_ID, STALE_UPDATED_AT, TENANT_ID } from '../../commands/__tests__/baselineTestKit'
import { DELIVERY_STAFF_KANBAN_ADAPTER_KEY as COMMAND_KANBAN_ADAPTER_KEY } from '../../commands/staffKanbanAdapter'
import { STAFF_ACCESS_RESOLVER_KEY as COMMAND_STAFF_ACCESS_RESOLVER_KEY } from '../../commands/staffLink'
import { deliveryFlowErrorBodySchema, staffLinkSchema } from '../../lib/contracts'
import { expectStatus, projectVersion, type Json } from './flowHelpers'
import {
  DELIVERY_STAFF_KANBAN_ADAPTER_KEY,
  EMPLOYEE_FEATURES,
  FOREIGN_TENANT_ID,
  STAFF_ACCESS_RESOLVER_KEY,
  VIEW_ONLY,
  detailCodesOf,
  expectFrozenError,
  isAllowedBy,
  readBody,
  resetRouteState,
  routeState,
  signInAs,
} from './routeTestKit'
import {
  OTHER_STAFF_PROJECT_ID,
  STAFF_PROJECT_ID,
  prepareLinkedProject,
  putStaffLink,
  readStaffLink,
  resetCommentRouteKit,
  registerStaffProjects,
} from './commentRouteKit'
import { createPinnedProject } from './stageRouteKit'

const MANAGE_FEATURE = 'delivery_os.flow.manage'
const OTHER_DELIVERY_PROJECT_ID = 'cccccccc-0000-4000-8000-cccccccccc01'
const STAFF_TASK_ID = 'dddddddd-0000-4000-8000-dddddddddd01'
const STORED_CURSORS = {
  FIGFILE0001: { cursor: 'page-2', lastBatchKey: 'import-key-0001', lastBatchHash: null, lastSyncAt: null, lastError: null },
}

async function expectFlowError(response: Response, status: number, code: string): Promise<Json> {
  const body = await readBody(response)
  expect({ status: response.status, code: body.code }).toEqual({ status, code })
  expect(deliveryFlowErrorBodySchema.safeParse(body).success).toBe(true)
  return body
}

/** Only the fields the re-link guard filters on matter; the rest of the thread row is irrelevant here. */
function seedCardedThread(projectId: string): void {
  routeState.store.commentThreads.push({
    id: 'cccccccc-0000-4000-8000-cccccccccc02',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    projectId,
    staffTaskId: STAFF_TASK_ID,
  })
}

function seedLinkOfAnotherProject(staffProjectId: string): void {
  const linkedAt = new Date('2026-09-19T09:30:00.000Z')
  routeState.store.staffLinks.push({
    id: 'eeeeeeee-0000-4000-8000-eeeeeeeeee01',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    projectId: OTHER_DELIVERY_PROJECT_ID,
    staffProjectId,
    linkedBy: ACTOR_ID,
    linkedAt,
    syncCursors: {},
    createdAt: linkedAt,
    updatedAt: linkedAt,
  })
}

beforeEach(() => {
  resetRouteState()
  resetCommentRouteKit()
})

describe('GET/PUT /projects/:id/staff-link (F10)', () => {
  it('opens the read to the view feature and gates the write behind the flow manage feature', () => {
    expect(isAllowedBy(metadata, 'GET', VIEW_ONLY)).toBe(true)
    expect(isAllowedBy(metadata, 'PUT', [MANAGE_FEATURE])).toBe(true)
    expect(isAllowedBy(metadata, 'PUT', EMPLOYEE_FEATURES)).toBe(false)
    expect(isAllowedBy(metadata, 'PUT', VIEW_ONLY)).toBe(false)
    expect(openApi.methods.GET?.responses?.map((response) => response.status)).toEqual([200])
    expect(openApi.methods.PUT?.errors?.map((entry) => entry.status)).toEqual([400, 403, 404, 409, 422, 428])
  })

  it('keeps the route kit DI key copies equal to the command constants', () => {
    expect({ access: STAFF_ACCESS_RESOLVER_KEY, kanban: DELIVERY_STAFF_KANBAN_ADAPTER_KEY }).toEqual({
      access: COMMAND_STAFF_ACCESS_RESOLVER_KEY,
      kanban: COMMAND_KANBAN_ADAPTER_KEY,
    })
  })

  it('answers 404 until the link exists and returns it afterwards', async () => {
    const projectId = await createPinnedProject()
    registerStaffProjects([STAFF_PROJECT_ID])
    const missing = await expectFrozenError(await readStaffLink(projectId), 404, 'not_found')
    expect(missing.details).toEqual([{ path: 'staffLink', code: 'not_found' }])

    await expectStatus(await putStaffLink(projectId, { staffProjectId: STAFF_PROJECT_ID }, await projectVersion(projectId)), 200)
    const body = await expectStatus(await readStaffLink(projectId), 200)
    expect(staffLinkSchema.safeParse(body).success).toBe(true)
    expect(body).toMatchObject({ projectId, staffProjectId: STAFF_PROJECT_ID, linkedBy: ACTOR_ID, syncCursors: {} })
  })

  it('requires the project version header, refuses a stale one and writes with the current one', async () => {
    const projectId = await createPinnedProject()
    registerStaffProjects([STAFF_PROJECT_ID])
    const body = { staffProjectId: STAFF_PROJECT_ID }

    await expectFrozenError(await putStaffLink(projectId, body), 428, 'optimistic_lock_required')
    const stale = await putStaffLink(projectId, body, STALE_UPDATED_AT)
    expect({ status: stale.status, code: (await readBody(stale)).code }).toEqual({ status: 409, code: 'optimistic_lock_conflict' })
    expect(routeState.store.staffLinks).toHaveLength(0)

    await expectStatus(await putStaffLink(projectId, body, await projectVersion(projectId)), 200)
    expect(routeState.store.staffLinks).toHaveLength(1)
    expect(routeState.store.staffLinks[0]).toMatchObject({ projectId, staffProjectId: STAFF_PROJECT_ID })
  })

  it('replays the same staff project without a version header', async () => {
    const projectId = await prepareLinkedProject()
    const stored = await expectStatus(await readStaffLink(projectId), 200)
    const replay = await expectStatus(await putStaffLink(projectId, { staffProjectId: STAFF_PROJECT_ID }), 200)

    expect(replay).toEqual(stored)
    expect(routeState.store.staffLinks).toHaveLength(1)
  })

  it('answers the same 404 for an unreachable staff project and for one the existence probe misses', async () => {
    const projectId = await createPinnedProject()
    const version = await projectVersion(projectId)
    const body = { staffProjectId: OTHER_STAFF_PROJECT_ID }

    registerStaffProjects([STAFF_PROJECT_ID])
    const unreachable = await expectFrozenError(await putStaffLink(projectId, body, version), 404, 'not_found')
    expect(detailCodesOf(unreachable)).toEqual(['not_found'])

    registerStaffProjects([OTHER_STAFF_PROJECT_ID], { existing: [] })
    const missingProbe = await expectFrozenError(await putStaffLink(projectId, body, version), 404, 'not_found')
    expect(detailCodesOf(missingProbe)).toEqual(['not_found'])
    expect(routeState.store.staffLinks).toHaveLength(0)
  })

  it('answers 422 staff_link_required when the staff module is absent', async () => {
    const projectId = await createPinnedProject()
    const version = await projectVersion(projectId)
    routeState.staffAccess = null

    const body = await expectFlowError(await putStaffLink(projectId, { staffProjectId: STAFF_PROJECT_ID }, version), 422, 'staff_link_required')
    expect(detailCodesOf(body)).toEqual(['staff_module_unavailable'])
    expect(routeState.store.staffLinks).toHaveLength(0)
  })

  it('re-links while no card exists and refuses once a thread carries a staff card', async () => {
    const projectId = await prepareLinkedProject()
    routeState.store.staffLinks[0].syncCursors = { ...STORED_CURSORS }
    const relinked = await expectStatus(
      await putStaffLink(projectId, { staffProjectId: OTHER_STAFF_PROJECT_ID }, await projectVersion(projectId)),
      200,
    )
    expect(relinked).toMatchObject({ staffProjectId: OTHER_STAFF_PROJECT_ID, syncCursors: {} })
    expect(routeState.store.staffLinks).toHaveLength(1)

    seedCardedThread(projectId)
    const refused = await expectFrozenError(
      await putStaffLink(projectId, { staffProjectId: STAFF_PROJECT_ID }, await projectVersion(projectId)),
      409,
      'invalid_transition',
    )
    expect(detailCodesOf(refused)).toEqual(['staff_link_in_use'])
    expect(routeState.store.staffLinks[0].staffProjectId).toBe(OTHER_STAFF_PROJECT_ID)
  })

  it('answers 409 staff_project_already_linked when another delivery project holds the staff project', async () => {
    const projectId = await createPinnedProject()
    registerStaffProjects([STAFF_PROJECT_ID])
    seedLinkOfAnotherProject(STAFF_PROJECT_ID)

    const refused = await expectFrozenError(
      await putStaffLink(projectId, { staffProjectId: STAFF_PROJECT_ID }, await projectVersion(projectId)),
      409,
      'invalid_transition',
    )
    expect(detailCodesOf(refused)).toEqual(['staff_project_already_linked'])
    expect(routeState.store.staffLinks).toHaveLength(1)
    expect(routeState.store.staffLinks[0].projectId).toBe(OTHER_DELIVERY_PROJECT_ID)
  })

  it('answers 404 on both methods for another tenant and for another organization', async () => {
    const projectId = await prepareLinkedProject()
    const version = await projectVersion(projectId)
    const body = { staffProjectId: OTHER_STAFF_PROJECT_ID }

    signInAs({ tenantId: FOREIGN_TENANT_ID })
    await expectFrozenError(await readStaffLink(projectId), 404, 'not_found')
    await expectFrozenError(await putStaffLink(projectId, body, version), 404, 'not_found')

    signInAs({ orgId: FOREIGN_ORG_ID })
    await expectFrozenError(await readStaffLink(projectId), 404, 'not_found')
    await expectFrozenError(await putStaffLink(projectId, body, version), 404, 'not_found')

    expect(routeState.store.staffLinks).toHaveLength(1)
    expect(routeState.store.staffLinks[0].staffProjectId).toBe(STAFF_PROJECT_ID)
  })
})
