jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

const mockFindWithDecryption = jest.fn()
const mockFindOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

const mockEmitDeliveryOsEvent = jest.fn(async (..._args: unknown[]) => undefined)

jest.mock('../../events', () => ({
  emitDeliveryOsEvent: (...args: unknown[]) => mockEmitDeliveryOsEvent(...args),
}))

import '@open-mercato/core/modules/delivery_os/commands'
import { LockMode } from '@mikro-orm/core'
import type { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { DeliveryProject } from '../../data/entities'
import { deliveryFlowErrorBodySchema, flowPinResponseSchema, type FlowTemplateV1 } from '../../lib/contracts'
import { hashFlowTemplate } from '../../lib/flowRules'
import { DEFAULT_FLOW_TEMPLATE } from '../../lib/flowTemplates'
import { issueTrustedExecution } from '../../lib/trustedExecution'
import type { FlowInstanceLinkCommandResult, FlowPinCommandResult } from '../flow'
import { DELIVERY_FLOW_TEMPLATE_PROVIDER_KEY, type FlowTemplateLookup } from '../flowTemplateProvider'
import {
  ACTOR_ID,
  catchHttpError,
  detailCodes,
  emptyStore,
  expectFrozenBody,
  FOREIGN_ORG_ID,
  getHandler,
  makeHarness,
  makeProject,
  matches,
  ORG_ID,
  PROJECT_ID,
  rowsFor,
  STALE_UPDATED_AT,
  TENANT_ID,
  type Row,
  type Store,
} from './baselineTestKit'

function expectFlowBody(error: CrudHttpError, status: number, code: string): void {
  expect(error.status).toBe(status)
  expect(deliveryFlowErrorBodySchema.safeParse(error.body).success).toBe(true)
  expect(error.body.code).toBe(code)
}

const INSTANCE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER_INSTANCE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const DEFINITION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const pin = getHandler<FlowPinCommandResult>('delivery_os.flow.pin')
const link = getHandler<FlowInstanceLinkCommandResult>('delivery_os.flow.link_instance')

let store: Store
let providerLookup: jest.Mock<Promise<FlowTemplateLookup>, [string, number]>

function harness(options: { headers?: Record<string, string>; orgId?: string; inProcess?: boolean; provider?: boolean } = {}) {
  const services: Record<string, unknown> = {}
  if (options.provider !== false) services[DELIVERY_FLOW_TEMPLATE_PROVIDER_KEY] = { getTemplate: providerLookup }
  const built = makeHarness(store, { headers: options.headers, orgId: options.orgId, services })
  const ctx: CommandRuntimeContext = options.inProcess ? { ...built.ctx, request: undefined } : built.ctx
  return { ctx, em: built.em }
}

function projectLock(): Record<string, string> {
  return { [OPTIMISTIC_LOCK_HEADER_NAME]: store.projects[0].updatedAt.toISOString() }
}

function pinInput(overrides: Row = {}): Row {
  return { projectId: PROJECT_ID, templateId: DEFAULT_FLOW_TEMPLATE.templateId, templateVersion: DEFAULT_FLOW_TEMPLATE.version, ...overrides }
}

function runPin(input: Row = pinInput(), options: Parameters<typeof harness>[0] = { headers: projectLock() }) {
  const { ctx, em } = harness(options)
  return { result: Promise.resolve(pin.execute(input, ctx)), em }
}

function linkInput(overrides: Row = {}): Row {
  return {
    projectId: PROJECT_ID,
    workflowInstanceId: INSTANCE_ID,
    definitionId: DEFINITION_ID,
    workflowId: 'delivery-project',
    version: 1,
    ...overrides,
  }
}

function editedTemplate(): FlowTemplateV1 {
  return { ...DEFAULT_FLOW_TEMPLATE, title: `${DEFAULT_FLOW_TEMPLATE.title} (edited)` }
}

beforeEach(() => {
  mockEmitDeliveryOsEvent.mockClear()
  mockFindOneWithDecryption.mockReset()
  mockFindWithDecryption.mockReset()
  mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Row) =>
    rowsFor(store, entity).find((row) => matches(row, where)) ?? null,
  )
  mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Row) =>
    rowsFor(store, entity).filter((row) => matches(row, where)),
  )
  providerLookup = jest.fn(async (templateId: string, version: number) =>
    templateId === DEFAULT_FLOW_TEMPLATE.templateId && version === DEFAULT_FLOW_TEMPLATE.version ? DEFAULT_FLOW_TEMPLATE : null,
  )
  store = { ...emptyStore(), projects: [makeProject()] }
})

describe('delivery_os.flow.pin (F4)', () => {
  it('pins once: snapshot, hash and pinnedAt on the project, project version bumped, ids-only event', async () => {
    const before = store.projects[0].updatedAt
    const { result } = runPin()
    const response = await result
    const project = store.projects[0]
    const hash = hashFlowTemplate(DEFAULT_FLOW_TEMPLATE)

    expect(flowPinResponseSchema.safeParse(response).success).toBe(true)
    expect(response).toMatchObject({ projectId: PROJECT_ID, duplicate: false, template: { templateId: 'delivery-default', version: 1, hash } })
    expect(project.flowTemplateId).toBe('delivery-default')
    expect(project.flowTemplateVersion).toBe(1)
    expect(project.flowTemplateHash).toBe(hash)
    expect(project.flowTemplateSnapshot).toEqual(DEFAULT_FLOW_TEMPLATE)
    expect(project.flowPinnedAt?.toISOString()).toBe(response.pinnedAt)
    expect(project.updatedAt.getTime()).toBeGreaterThan(before.getTime())
    expect(response.projectUpdatedAt).toBe(project.updatedAt.toISOString())
    const lockedLoad = mockFindOneWithDecryption.mock.calls.find(([, entity, , options]) => entity === DeliveryProject && options !== undefined)
    expect(lockedLoad?.[3]).toEqual({ lockMode: LockMode.PESSIMISTIC_WRITE })

    expect(mockEmitDeliveryOsEvent).toHaveBeenCalledTimes(1)
    const [eventId, payload, options] = mockEmitDeliveryOsEvent.mock.calls[0] as [string, Record<string, unknown>, Record<string, unknown>]
    expect(eventId).toBe('delivery_os.flow.pinned')
    expect(Object.keys(payload).sort()).toEqual(['organizationId', 'projectId', 'templateHash', 'templateId', 'templateVersion', 'tenantId'])
    expect(payload).toMatchObject({ projectId: PROJECT_ID, templateId: 'delivery-default', templateVersion: 1, templateHash: hash, tenantId: TENANT_ID, organizationId: ORG_ID })
    expect(options).toMatchObject({ persistent: true, tenantId: TENANT_ID, organizationId: ORG_ID })
  })

  it('answers the same template again with the stored body without consulting the provider or the lock', async () => {
    const first = await runPin().result
    providerLookup.mockClear()
    providerLookup.mockResolvedValue(editedTemplate())
    const { result, em } = runPin(pinInput(), { headers: {} })
    const replay = await result

    expect(replay).toEqual({ ...first, duplicate: true })
    expect(providerLookup).not.toHaveBeenCalled()
    expect(em.transactional).not.toHaveBeenCalled()
    expect(mockEmitDeliveryOsEvent).toHaveBeenCalledTimes(1)
  })

  it('refuses another template on a pinned project', async () => {
    await runPin().result
    const error = await catchHttpError(() => runPin(pinInput({ templateVersion: 2 })).result)
    expectFlowBody(error, 409, 'flow_already_pinned')
    expect(detailCodes(error)).toEqual(['flow_already_pinned'])
    expect(store.projects[0].flowTemplateVersion).toBe(1)
  })

  it('answers unknown_flow_template before any lock when the provider knows no such template', async () => {
    const { result, em } = runPin(pinInput({ templateVersion: 7 }))
    const error = await catchHttpError(() => result)
    expectFlowBody(error, 422, 'unknown_flow_template')
    expect(em.transactional).not.toHaveBeenCalled()
    expect(store.projects[0].flowTemplateId).toBeUndefined()
  })

  it('answers unknown_flow_template when the provider returns a template for another id or version', async () => {
    providerLookup.mockResolvedValue({ ...DEFAULT_FLOW_TEMPLATE, version: 2 })
    const error = await catchHttpError(() => runPin().result)
    expectFlowBody(error, 422, 'unknown_flow_template')
  })

  it('answers unknown_flow_template when no provider is registered', async () => {
    const error = await catchHttpError(() => runPin(pinInput(), { headers: projectLock(), provider: false }).result)
    expectFlowBody(error, 422, 'unknown_flow_template')
  })

  it('refuses a provider whose stated hash does not match the template content', async () => {
    providerLookup.mockResolvedValue({ template: DEFAULT_FLOW_TEMPLATE, hash: 'd'.repeat(64) })
    const { result, em } = runPin()
    const error = await catchHttpError(() => result)
    expectFlowBody(error, 422, 'flow_template_hash_mismatch')
    expect(em.transactional).not.toHaveBeenCalled()
  })

  it('accepts a provider that states the matching hash', async () => {
    providerLookup.mockResolvedValue({ template: DEFAULT_FLOW_TEMPLATE, hash: hashFlowTemplate(DEFAULT_FLOW_TEMPLATE) })
    const response = await runPin().result
    expect(response.duplicate).toBe(false)
  })

  it('requires the project lock header and refuses a stale one', async () => {
    const missing = await catchHttpError(() => runPin(pinInput(), { headers: {} }).result)
    expectFrozenBody(missing, 428, 'optimistic_lock_required')

    const stale = await catchHttpError(() => runPin(pinInput(), { headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: STALE_UPDATED_AT } }).result)
    expect(stale.status).toBe(409)
    expect(stale.body.code).toBe('optimistic_lock_conflict')
    expect(store.projects[0].flowTemplateId).toBeUndefined()
    expect(mockEmitDeliveryOsEvent).not.toHaveBeenCalled()
  })

  it('hides projects of another organization', async () => {
    const error = await catchHttpError(() => runPin(pinInput(), { headers: projectLock(), orgId: FOREIGN_ORG_ID }).result)
    expectFrozenBody(error, 404, 'not_found')
  })
})

describe('delivery_os.flow.link_instance (F5)', () => {
  const trustedExecution = issueTrustedExecution(ACTOR_ID)

  async function pinned(): Promise<void> {
    await runPin().result
  }

  it('is not reachable with a request, without the trusted option, or with a forged object', async () => {
    await pinned()
    const overHttp = await catchHttpError(() => link.execute(linkInput({ trustedExecution }), harness({ headers: projectLock() }).ctx))
    expectFrozenBody(overHttp, 403, 'forbidden')
    expect(detailCodes(overHttp)).toEqual(['trusted_execution_required'])

    const missing = await catchHttpError(() => link.execute(linkInput(), harness({ inProcess: true }).ctx))
    expectFrozenBody(missing, 403, 'forbidden')

    const forged = JSON.parse(JSON.stringify(trustedExecution))
    const forgedError = await catchHttpError(() => link.execute(linkInput({ trustedExecution: forged }), harness({ inProcess: true }).ctx))
    expectFrozenBody(forgedError, 403, 'forbidden')
    expect(store.projects[0].flowWorkflowInstanceId).toBeUndefined()
  })

  it('refuses to link an unpinned project', async () => {
    const error = await catchHttpError(() => link.execute(linkInput({ trustedExecution }), harness({ inProcess: true }).ctx))
    expectFlowBody(error, 422, 'flow_not_pinned')
  })

  it('links once under the project row lock, is a no-op for the same instance and refuses another', async () => {
    await pinned()
    const before = store.projects[0].updatedAt
    const first = await link.execute(linkInput({ trustedExecution }), harness({ inProcess: true }).ctx)
    expect(first).toMatchObject({ projectId: PROJECT_ID, workflowInstanceId: INSTANCE_ID, changed: true })
    expect(store.projects[0].flowWorkflowInstanceId).toBe(INSTANCE_ID)
    expect(store.projects[0].flowWorkflowDefinitionId).toBe(DEFINITION_ID)
    expect(store.projects[0].updatedAt).not.toBe(before)
    expect(first.projectUpdatedAt).toBe(store.projects[0].updatedAt.toISOString())

    const again = await link.execute(linkInput({ trustedExecution }), harness({ inProcess: true }).ctx)
    expect(again.changed).toBe(false)

    const other = await catchHttpError(() =>
      link.execute(linkInput({ workflowInstanceId: OTHER_INSTANCE_ID, trustedExecution }), harness({ inProcess: true }).ctx),
    )
    expectFlowBody(other, 409, 'flow_already_pinned')
    expect(detailCodes(other)).toEqual(['instance_already_linked'])
    expect(store.projects[0].flowWorkflowInstanceId).toBe(INSTANCE_ID)
    expect(mockEmitDeliveryOsEvent).toHaveBeenCalledTimes(1)
  })

  it('stamps the trusted actor in the audit log', async () => {
    await pinned()
    const ctx = harness({ inProcess: true }).ctx
    const input = linkInput({ trustedExecution })
    const result = await link.execute(input, ctx)
    const log = await link.buildLog?.({ input, result, ctx, snapshots: {} })
    expect(log).toMatchObject({ actorUserId: ACTOR_ID, resourceId: PROJECT_ID })
  })
})
