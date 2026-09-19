import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import {
  DeliveryBaseline,
  DeliveryCommentReply,
  DeliveryCommentThread,
  DeliveryDecision,
  DeliveryProject,
  DeliveryStaffLink,
  DeliveryTask,
} from '../../data/entities'
import { draftSpecV1Schema } from '../../data/validators'
import { hashBaseline } from '../../lib/baseline'
import { DEFAULT_DELIVERY_LIMITS, deliveryErrorBodySchema, type BaselineContentV1 } from '../../lib/contracts'
import { loadBaselineContentFixture, loadRequirementsProposalFixture } from '../../lib/fixtures/index'
import { TARGET_PROFILES } from '../../lib/targetProfiles'

export const TENANT_ID = '11111111-1111-4111-8111-111111111111'
export const ORG_ID = '22222222-2222-4222-8222-222222222222'
export const FOREIGN_ORG_ID = '99999999-9999-4999-8999-999999999992'
export const PROJECT_ID = '44444444-4444-4444-8444-444444444444'
export const BASELINE_ID = '5a5a5a5a-5555-4555-8555-555555555555'
export const NEW_ROW_ID = '6b6b6b6b-6666-4666-8666-666666666666'
export const ACTOR_ID = '88888888-8888-4888-8888-888888888888'
export const UPDATED_AT = new Date('2026-09-19T09:00:00.000Z')
export const STALE_UPDATED_AT = '2026-09-19T08:00:00.000Z'

export type Row = Record<string, unknown>

export type Store = {
  projects: DeliveryProject[]
  baselines: DeliveryBaseline[]
  decisions: DeliveryDecision[]
  tasks: DeliveryTask[]
  attachments: Row[]
  staffLinks: Row[]
  commentThreads: Row[]
  commentReplies: Row[]
}

export type EmMock = {
  fork: jest.Mock
  create: jest.Mock
  persist: jest.Mock
  flush: jest.Mock
  transactional: jest.Mock
}

export function emptyStore(): Store {
  return { projects: [], baselines: [], decisions: [], tasks: [], attachments: [], staffLinks: [], commentThreads: [], commentReplies: [] }
}

export function rowsFor(store: Store, entity: unknown): Row[] {
  if (entity === DeliveryProject) return store.projects as unknown as Row[]
  if (entity === DeliveryBaseline) return store.baselines as unknown as Row[]
  if (entity === DeliveryDecision) return store.decisions as unknown as Row[]
  if (entity === DeliveryTask) return store.tasks as unknown as Row[]
  if (entity === Attachment) return store.attachments
  if (entity === DeliveryStaffLink) return store.staffLinks
  if (entity === DeliveryCommentThread) return store.commentThreads
  if (entity === DeliveryCommentReply) return store.commentReplies
  throw new Error('[internal] unexpected entity in test store')
}

export function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key] ?? null
    if (typeof expected === 'object' && expected !== null && '$in' in expected) {
      return (expected as { $in: unknown[] }).$in.includes(actual)
    }
    if (typeof expected === 'object' && expected !== null && '$ne' in expected) {
      return actual !== ((expected as { $ne: unknown }).$ne ?? null)
    }
    if (typeof expected === 'object' && expected !== null && '$gt' in expected) {
      const bound = (expected as { $gt: number | string }).$gt
      if (typeof bound === 'number') return typeof actual === 'number' && actual > bound
      return typeof actual === 'string' && actual > bound
    }
    return actual === (expected ?? null)
  })
}

export function getHandler<TResult>(id: string): CommandHandler<unknown, TResult> {
  const handler = commandRegistry.get(id)
  if (!handler) throw new Error(`[internal] command ${id} is not registered`)
  return handler as CommandHandler<unknown, TResult>
}

export function makeHarness(
  store: Store,
  options: { headers?: Record<string, string>; orgId?: string; sub?: string; services?: Record<string, unknown> } = {},
): { ctx: CommandRuntimeContext; em: EmMock } {
  const em: EmMock = {
    fork: jest.fn(),
    create: jest.fn((_entity: unknown, data: Row) => ({ id: NEW_ROW_ID, ...data })),
    persist: jest.fn((row: Row) => {
      if ('proposalTaskKey' in row) store.tasks.push(row as unknown as DeliveryTask)
      else if ('contentHash' in row) store.baselines.push(row as unknown as DeliveryBaseline)
      else store.decisions.push(row as unknown as DeliveryDecision)
    }),
    flush: jest.fn(async () => undefined),
    transactional: jest.fn(),
  }
  em.fork.mockReturnValue(em)
  em.transactional.mockImplementation(async (work: (tx: EmMock) => Promise<unknown>) => work(em))
  const services: Record<string, unknown> = {
    em,
    dataEngine: { markOrmEntityChange: jest.fn() },
    deliveryOsAttachmentInspector: makeAttachmentInspector(() => store.attachments),
    ...options.services,
  }
  const container = {
    resolve: jest.fn((name: string) => {
      if (name in services) return services[name]
      throw new Error(`[internal] ${name} is not registered`)
    }),
  }
  const ctx: CommandRuntimeContext = {
    container: container as unknown as CommandRuntimeContext['container'],
    auth: { sub: options.sub ?? ACTOR_ID, tenantId: TENANT_ID, orgId: options.orgId ?? ORG_ID },
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
    request: new Request('http://localhost/api/delivery_os', { method: 'POST', headers: options.headers }),
  }
  return { ctx, em }
}

export function makeDraft(overrides: Row = {}): Row {
  const content = loadBaselineContentFixture()
  return draftSpecV1Schema.parse({
    requirements: content.requirements,
    acceptanceCriteria: content.acceptanceCriteria,
    screens: content.screens,
    tokens: content.tokens,
    architectureSummary: content.architectureSummary,
    planSummary: content.planSummary,
    acTestMap: content.acTestMap,
    manualChecks: content.manualChecks,
    declaredTests: content.declaredTests,
    attachments: content.attachments,
    ...overrides,
  })
}

export function makeRequirementsProposal(overrides: Row = {}): Row {
  return { ...loadRequirementsProposalFixture(), projectId: PROJECT_ID, ...overrides }
}

export function makeProject(overrides: Partial<DeliveryProject> = {}): DeliveryProject {
  const profile = TARGET_PROFILES[0]
  return {
    id: PROJECT_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    name: 'Customer portal',
    inputMode: 'from_brief',
    brief: null,
    targetProfileId: profile.id,
    targetProfileVersion: profile.version,
    repositoryRef: null,
    draftSpec: makeDraft(),
    activeBaselineId: null,
    limits: { ...DEFAULT_DELIVERY_LIMITS },
    createdAt: UPDATED_AT,
    updatedAt: UPDATED_AT,
    deletedAt: null,
    ...overrides,
  } as DeliveryProject
}

export function makeBaseline(
  content: BaselineContentV1 = loadBaselineContentFixture(),
  overrides: Partial<DeliveryBaseline> = {},
): DeliveryBaseline {
  return {
    id: BASELINE_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    version: 1,
    contentHash: hashBaseline(content),
    source: 'manual',
    content,
    attachmentIds: [],
    createdAt: UPDATED_AT,
    ...overrides,
  } as DeliveryBaseline
}

export function makeApproval(baseline: DeliveryBaseline, kind: 'requirements' | 'design', overrides: Row = {}): DeliveryDecision {
  return {
    id: `dec-${kind}-${baseline.id}`,
    tenantId: baseline.tenantId,
    organizationId: baseline.organizationId,
    projectId: baseline.projectId,
    kind,
    verdict: 'approved',
    subjectType: 'baseline',
    subjectId: baseline.id,
    subjectHash: baseline.contentHash,
    subjectVersion: baseline.version,
    decidedAt: UPDATED_AT,
    ...overrides,
  } as unknown as DeliveryDecision
}

export const STORED_FILE_SIZE = 2048

export function draftAttachmentRows(draft: Row, organizationId: string = ORG_ID): Row[] {
  const screens = draft.screens as Array<{ attachmentId: string; sha256: string }>
  const attachments = draft.attachments as Array<{ attachmentId: string; sha256: string }>
  const declared = new Map([...attachments, ...screens].map((entry) => [entry.attachmentId, entry.sha256]))
  return [...declared].map(([id, storedSha256]) => ({
    id,
    tenantId: TENANT_ID,
    organizationId,
    mimeType: 'image/png',
    fileSize: STORED_FILE_SIZE,
    partitionCode: 'privateAttachments',
    storagePath: `delivery/${id}.png`,
    storedSha256,
    unreadable: false,
  }))
}

export function makeAttachmentInspector(rows: () => Row[]): jest.Mock {
  return jest.fn(async (attachment: { id: string }) => {
    const row = rows().find((entry) => entry.id === attachment.id)
    if (!row || row.unreadable === true) throw new Error('[internal] stored file is not readable')
    const mimeType = String(row.mimeType)
    return {
      sha256: row.storedSha256,
      sizeBytes: row.storedSizeBytes ?? row.fileSize,
      detectedMimeType: 'detectedMimeType' in row ? row.detectedMimeType : mimeType.startsWith('image/') ? mimeType : null,
    }
  })
}

export async function catchHttpError(run: () => unknown): Promise<CrudHttpError> {
  try {
    await run()
  } catch (error) {
    if (error instanceof CrudHttpError) return error
    throw error
  }
  throw new Error('[internal] expected a CrudHttpError')
}

export function expectFrozenBody(error: CrudHttpError, status: number, code: string): void {
  expect(error.status).toBe(status)
  expect(deliveryErrorBodySchema.safeParse(error.body).success).toBe(true)
  expect(error.body.code).toBe(code)
}

export function detailCodes(error: CrudHttpError): string[] {
  return (error.body.details as Array<{ code: string }>).map((detail) => detail.code)
}
