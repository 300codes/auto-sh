import { randomUUID } from 'node:crypto'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { hasAllFeatures } from '@open-mercato/shared/security/features'
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import type { DeliveryStaffKanbanAdapter } from '../../commands/staffKanbanAdapter'
import {
  DeliveryBaseline,
  DeliveryCommentReply,
  DeliveryCommentThread,
  DeliveryDecision,
  DeliveryEvidence,
  DeliveryFlowStageArtifact,
  DeliveryFlowStageDecision,
  DeliveryIntake,
  DeliveryProject,
  DeliveryStaffLink,
  DeliveryTask,
} from '../../data/entities'
import { deliveryErrorBodySchema } from '../../lib/contracts'
import { TARGET_PROFILES } from '../../lib/targetProfiles'
import {
  ACTOR_ID,
  ORG_ID,
  PROJECT_ID,
  TENANT_ID,
  UPDATED_AT,
  makeAttachmentInspector,
  matches,
  type Row,
} from '../../commands/__tests__/baselineTestKit'

/**
 * Copies of `STAFF_ACCESS_RESOLVER_KEY` (commands/staffLink.ts) and `DELIVERY_STAFF_KANBAN_ADAPTER_KEY`
 * (commands/staffKanbanAdapter.ts). They are literals here because importing the owning command module from the kit
 * would close a require cycle with the mocked encryption helpers; `staffLink.route.test.ts` asserts they still match.
 */
export const STAFF_ACCESS_RESOLVER_KEY = 'timeTrackingAccessResolver'
export const DELIVERY_STAFF_KANBAN_ADAPTER_KEY = 'deliveryStaffKanbanAdapter'

export const FOREIGN_TENANT_ID = '99999999-9999-4999-8999-999999999991'
export const TASK_ID = '7c7c7c7c-7777-4777-8777-777777777777'
export const ALL_FEATURES = ['delivery_os.*']
export const VIEW_ONLY = ['delivery_os.projects.view']
export const EMPLOYEE_FEATURES = ['delivery_os.projects.view', 'delivery_os.projects.manage', 'delivery_os.results.import']

type AuthState = { sub: string; tenantId: string; orgId: string } | null

/** Mirrors the shape `commands/staffLink.ts` resolves from DI; a `null` slot means the staff module is absent. */
export type StaffAccessResolverMock = {
  resolveProjectAccess: (ctx: { userId: string; tenantId: string; organizationId: string }) => Promise<{ canManageAll: boolean; projectIds: string[] }>
}

type RouteStore = {
  projects: Row[]
  baselines: Row[]
  decisions: Row[]
  tasks: Row[]
  evidence: Row[]
  attachments: Row[]
  intakes: Row[]
  stageArtifacts: Row[]
  stageDecisions: Row[]
  staffLinks: Row[]
  commentThreads: Row[]
  commentReplies: Row[]
}

function emptyRouteStore(): RouteStore {
  return { projects: [], baselines: [], decisions: [], tasks: [], evidence: [], attachments: [], intakes: [], stageArtifacts: [], stageDecisions: [], staffLinks: [], commentThreads: [], commentReplies: [] }
}

export const routeState: {
  auth: AuthState
  features: string[]
  rbacAvailable: boolean
  selectionRejected: boolean
  store: RouteStore
  queryEngine: { query: jest.Mock }
  staffAccess: StaffAccessResolverMock | null
  kanbanAdapter: DeliveryStaffKanbanAdapter | null
  writes: number
} = {
  auth: null,
  features: [],
  rbacAvailable: true,
  selectionRejected: false,
  store: emptyRouteStore(),
  queryEngine: { query: jest.fn() },
  staffAccess: null,
  kanbanAdapter: null,
  writes: 0,
}

function rowsFor(entity: unknown): Row[] {
  const { store } = routeState
  if (entity === DeliveryProject) return store.projects
  if (entity === DeliveryBaseline) return store.baselines
  if (entity === DeliveryDecision) return store.decisions
  if (entity === DeliveryTask) return store.tasks
  if (entity === DeliveryEvidence) return store.evidence
  if (entity === Attachment) return store.attachments
  if (entity === DeliveryIntake) return store.intakes
  if (entity === DeliveryFlowStageArtifact) return store.stageArtifacts
  if (entity === DeliveryFlowStageDecision) return store.stageDecisions
  if (entity === DeliveryStaffLink) return store.staffLinks
  if (entity === DeliveryCommentThread) return store.commentThreads
  if (entity === DeliveryCommentReply) return store.commentReplies
  throw new Error('[internal] unexpected entity in route test store')
}

/** Only the stage history and comment entities honour `orderBy`; the v1 suites rely on insertion order. */
const ORDERED_ENTITIES = new Set<unknown>([DeliveryFlowStageArtifact, DeliveryFlowStageDecision, DeliveryCommentThread, DeliveryCommentReply])

function sortKey(value: unknown): number | string {
  if (value instanceof Date) return value.getTime()
  return typeof value === 'number' ? value : String(value ?? '')
}

function sortRows(rows: Row[], orderBy: Record<string, 'asc' | 'desc'>): Row[] {
  return [...rows].sort((left, right) => {
    for (const [key, direction] of Object.entries(orderBy)) {
      const a = sortKey(left[key])
      const b = sortKey(right[key])
      if (a === b) continue
      return (a < b ? -1 : 1) * (direction === 'desc' ? -1 : 1)
    }
    return 0
  })
}

export const findMock = {
  findOneWithDecryption: async (_em: unknown, entity: unknown, where: Row) =>
    rowsFor(entity).find((row) => matches(row, where)) ?? null,
  findWithDecryption: jest.fn(async (_em: unknown, entity: unknown, where: Row, options?: { limit?: number; offset?: number; orderBy?: Record<string, 'asc' | 'desc'> }) => {
    const filtered = rowsFor(entity).filter((row) => matches(row, where))
    const rows = options?.orderBy && ORDERED_ENTITIES.has(entity) ? sortRows(filtered, options.orderBy) : filtered
    const offset = options?.offset ?? 0
    return rows.slice(offset, options?.limit === undefined ? undefined : offset + options.limit)
  }),
}

const createdEntities = new WeakMap<object, unknown>()

function entityDefaults(entity: unknown): Row {
  if (typeof entity !== 'function') return {}
  const instance = new (entity as new () => Row)()
  return Object.fromEntries(Object.entries(instance).filter(([, value]) => value !== undefined))
}

export const em = {
  fork: () => em,
  transactional: jest.fn(async (work: (tx: unknown) => Promise<unknown>) => work(em)),
  create: (entity: unknown, data: Row) => {
    const now = new Date()
    const row: Row = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      decidedAt: now,
      deletedAt: null,
      ...entityDefaults(entity),
      ...data,
    }
    createdEntities.set(row, entity)
    return row
  },
  persist: jest.fn((row: Row) => {
    const entity = createdEntities.get(row)
    if (entity && !rowsFor(entity).includes(row)) rowsFor(entity).push(row)
    routeState.writes += 1
    return em
  }),
  flush: jest.fn(async () => undefined),
  nativeInsert: jest.fn(async () => undefined),
  nativeUpdate: jest.fn(async () => 0),
  findOne: async () => null,
  count: async (entity: unknown, where: Row) => rowsFor(entity).filter((row) => matches(row, where)).length,
}

export const EM_WRITE_METHODS = ['transactional', 'persist', 'flush', 'nativeInsert', 'nativeUpdate'] as const

const dataEngine = {
  markOrmEntityChange: () => {
    routeState.writes += 1
  },
  flushOrmEntityChanges: async () => undefined,
  setDefaultIndexerConfig: () => undefined,
  hasIndexedDefaultEntityClass: () => true,
}

const commandBus = {
  execute: async (commandId: string, options: { input: unknown; ctx: unknown }) => {
    const handler = commandRegistry.get(commandId)
    if (!handler) throw new Error(`[internal] command ${commandId} is not registered`)
    const result = await handler.execute(options.input as never, options.ctx as never)
    return { result, logEntry: null }
  },
}

const rbacService = {
  userHasAllFeatures: async (_userId: string, required: string[]) => hasAllFeatures(routeState.features, required),
  getGrantedFeatures: async () => routeState.features,
}

const services: Record<string, unknown> = {
  em,
  dataEngine,
  commandBus,
  queryEngine: routeState.queryEngine,
  accessLogService: { log: async () => undefined },
}

export const containerMock = {
  createRequestContainer: async () => ({
    resolve: (name: string) => {
      if (name === 'rbacService') {
        if (!routeState.rbacAvailable) throw new Error('[internal] rbacService is not registered')
        return rbacService
      }
      if (name === 'deliveryOsAttachmentInspector') {
        return makeAttachmentInspector(() => routeState.store.attachments)
      }
      if (name === STAFF_ACCESS_RESOLVER_KEY) return routeState.staffAccess ?? undefined
      if (name === DELIVERY_STAFF_KANBAN_ADAPTER_KEY) return routeState.kanbanAdapter ?? undefined
      if (name === 'deliveryOsAttemptQueries') {
        const { createDeliveryOsAttemptQueries } = jest.requireActual('../../commands/attemptQueries')
        return createDeliveryOsAttemptQueries(em)
      }
      if (name === 'deliveryOsFlowQueries') {
        const { createDeliveryOsFlowQueries } = jest.requireActual('../../commands/flowQueries')
        return createDeliveryOsFlowQueries(em)
      }
      if (name === 'deliveryFlowTemplateProvider') {
        const { createBuiltInFlowTemplateProvider } = jest.requireActual('../../commands/flowTemplateProvider')
        return createBuiltInFlowTemplateProvider()
      }
      if (name === 'deliveryOsReportQueries') {
        const { createDeliveryOsReportQueries } = jest.requireActual('../../commands/reportQueries')
        return createDeliveryOsReportQueries(em)
      }
      return services[name]
    },
  }),
}

export const authServerMock = {
  getAuthFromRequest: async () => routeState.auth,
  getAuthFromCookies: async () => routeState.auth,
}

function currentScope() {
  const orgId = routeState.auth?.orgId ?? null
  return {
    selectedId: orgId,
    filterIds: orgId ? [orgId] : null,
    allowedIds: orgId ? [orgId] : null,
    tenantId: routeState.auth?.tenantId ?? null,
    ...(routeState.selectionRejected ? { selectionRejected: true } : {}),
  }
}

export const organizationScopeMock = {
  resolveOrganizationScopeForRequest: async () => currentScope(),
}

export function resetRouteState(): void {
  routeState.auth = { sub: ACTOR_ID, tenantId: TENANT_ID, orgId: ORG_ID }
  routeState.features = [...ALL_FEATURES]
  routeState.rbacAvailable = true
  routeState.selectionRejected = false
  routeState.store = emptyRouteStore()
  routeState.staffAccess = null
  routeState.kanbanAdapter = null
  routeState.writes = 0
  for (const method of EM_WRITE_METHODS) em[method].mockClear()
  findMock.findWithDecryption.mockClear()
  routeState.queryEngine.query.mockReset()
  routeState.queryEngine.query.mockResolvedValue({ items: [], total: 0 })
}

export function signInAs(overrides: { tenantId?: string; orgId?: string; features?: string[] }): void {
  routeState.auth = {
    sub: ACTOR_ID,
    tenantId: overrides.tenantId ?? TENANT_ID,
    orgId: overrides.orgId ?? ORG_ID,
  }
  if (overrides.features) routeState.features = [...overrides.features]
}

export function makeTaskRow(overrides: Row = {}): Row {
  const profile = TARGET_PROFILES[0]
  return {
    id: TASK_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    baselineId: '5a5a5a5a-5555-4555-8555-555555555555',
    title: 'Service list',
    description: null,
    acIds: ['AC-001'],
    dependsOnTaskIds: [],
    allowedPaths: [],
    targetProfileId: profile.id,
    targetProfileVersion: profile.version,
    status: 'draft',
    statusReason: null,
    attemptNumber: 0,
    executionAttempts: [],
    proposalTaskKey: null,
    createdAt: UPDATED_AT,
    updatedAt: UPDATED_AT,
    deletedAt: null,
    ...overrides,
  }
}

export function apiRequest(
  method: string,
  path: string,
  options: { body?: unknown; lock?: string | Date | null; headers?: Record<string, string> } = {},
): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(options.headers ?? {}) }
  if (options.lock) {
    headers[OPTIMISTIC_LOCK_HEADER_NAME] = options.lock instanceof Date ? options.lock.toISOString() : options.lock
  }
  return new Request(`http://localhost/api/delivery_os${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
}

export function routeParams(id: string): { params: Record<string, unknown> } {
  return { params: { id } }
}

export async function readBody(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

export async function expectFrozenError(response: Response, status: number, code: string): Promise<Record<string, unknown>> {
  const body = await readBody(response)
  expect({ status: response.status, code: body.code }).toEqual({ status, code })
  expect(deliveryErrorBodySchema.safeParse(body).success).toBe(true)
  return body
}

export function detailCodesOf(body: Record<string, unknown>): string[] {
  return (body.details as Array<{ code: string }>).map((detail) => detail.code)
}

export function isAllowedBy(
  metadata: Record<string, { requireAuth?: boolean; requireFeatures?: string[] }>,
  method: string,
  granted: string[],
): boolean {
  const entry = metadata[method]
  if (!entry || entry.requireAuth !== true) throw new Error(`[internal] ${method} must declare requireAuth`)
  return hasAllFeatures(granted, entry.requireFeatures ?? [])
}
