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
import { DeliveryCommentThread, DeliveryFlowStageArtifact, DeliveryFlowStageDecision, DeliveryProject, DeliveryTask } from '../../data/entities'
import { stageDecisionRequestSchema } from '../../data/validators'
import {
  deliveryFlowErrorBodySchema,
  stageArtifactCreateResponseSchema,
  stageDecisionResponseSchema,
  type ClientApproval,
  type FlowStageId,
  type StageArtifactRef,
  type StageArtifactV1,
} from '../../lib/contracts'
import { loadStageArtifactFixture, loadStageDecisionRequestFixture } from '../../lib/fixtures/flow/index'
import { computeStageCurrency, hashFlowTemplate } from '../../lib/flowRules'
import { DEFAULT_FLOW_TEMPLATE } from '../../lib/flowTemplates'
import { hashStageArtifactContent } from '../../lib/stageArtifacts'
import { hashStageDecisionRequest } from '../../lib/stageDecisions'
import { TARGET_PROFILES } from '../../lib/targetProfiles'
import { issueTrustedExecution } from '../../lib/trustedExecution'
import type { StageArtifactCommandResult, StageDecisionCommandResult } from '../stages'
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
  UPDATED_AT,
  type Row,
  type Store,
} from './baselineTestKit'

function expectFlowBody(error: CrudHttpError, status: number, code: string): void {
  expect(error.status).toBe(status)
  expect(deliveryFlowErrorBodySchema.safeParse(error.body).success).toBe(true)
  expect(error.body.code).toBe(code)
}

type StageStore = Store & { stageArtifacts: Row[]; stageDecisions: Row[] }

type HarnessOptions = {
  headers?: Record<string, string>
  orgId?: string
  inProcess?: boolean
  features?: string[] | 'throw'
  uniqueRace?: boolean
}

const WORDPRESS_PROFILE = { targetProfileId: 'wordpress-theme', targetProfileVersion: 1 }
const OTHER_PROFILE = TARGET_PROFILES[0]
const STAGE_ORDER: FlowStageId[] = ['scope', 'ux', 'key_visual', 'design_system_ui']
const UX_ATTACHMENT_ID = '55555555-5555-4555-8555-555555555555'
const UX_ATTACHMENT_SHA = '3333333333333333333333333333333333333333333333333333333333333333'
const FOREIGN_ARTIFACT_ID = 'aaaaaaa9-aaaa-4aaa-8aaa-aaaaaaaaaaa9'

const createArtifact = getHandler<StageArtifactCommandResult>('delivery_os.stages.create_artifact')
const decide = getHandler<StageDecisionCommandResult>('delivery_os.stages.decide')

let store: StageStore
let idCounter = 0
let lastGrantLookup: jest.Mock

function nextId(): string {
  idCounter += 1
  return `${idCounter.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`
}

function rows(entity: unknown): Row[] {
  if (entity === DeliveryFlowStageArtifact) return store.stageArtifacts
  if (entity === DeliveryFlowStageDecision) return store.stageDecisions
  return rowsFor(store, entity)
}

function uniqueViolation(): Error {
  return Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' })
}

function harness(options: HarnessOptions = {}) {
  const features = options.features ?? ['delivery_os.stages.approve']
  lastGrantLookup = jest.fn(async () => {
    if (features === 'throw') throw new Error('[internal] rbac unavailable')
    return features
  })
  const built = makeHarness(store, { headers: options.headers, orgId: options.orgId, services: { rbacService: { getGrantedFeatures: lastGrantLookup } } })
  built.em.create.mockImplementation((_entity: unknown, data: Row) => ({ id: nextId(), ...data }))
  built.em.persist.mockImplementation((row: Row) => {
    if ('idempotencyKey' in row) {
      if (options.uniqueRace && store.stageDecisions.some((existing) => existing.idempotencyKey === row.idempotencyKey)) throw uniqueViolation()
      store.stageDecisions.push(row)
      return
    }
    if ('templateHash' in row) {
      if (options.uniqueRace && store.stageArtifacts.some((existing) => existing.stageId === row.stageId && existing.contentHash === row.contentHash)) {
        throw uniqueViolation()
      }
      store.stageArtifacts.push(row)
    }
  })
  const ctx: CommandRuntimeContext = options.inProcess ? { ...built.ctx, request: undefined } : built.ctx
  return { ctx, em: built.em }
}

function projectLock(): Record<string, string> {
  return { [OPTIMISTIC_LOCK_HEADER_NAME]: store.projects[0].updatedAt.toISOString() }
}

function withLock(options: HarnessOptions = {}): HarnessOptions {
  return { headers: projectLock(), ...options }
}

function pinnedProject(overrides: Partial<DeliveryProject> = {}): DeliveryProject {
  return makeProject({
    ...WORDPRESS_PROFILE,
    flowTemplateId: DEFAULT_FLOW_TEMPLATE.templateId,
    flowTemplateVersion: DEFAULT_FLOW_TEMPLATE.version,
    flowTemplateHash: hashFlowTemplate(DEFAULT_FLOW_TEMPLATE),
    flowTemplateSnapshot: DEFAULT_FLOW_TEMPLATE,
    flowPinnedAt: UPDATED_AT,
    ...overrides,
  })
}

function scopeArtifact(overrides: Record<string, unknown> = {}): Row {
  return { ...loadStageArtifactFixture('scope'), projectId: PROJECT_ID, ...overrides }
}

function designArtifact(stageId: FlowStageId, dependsOn: Array<StageArtifactRef & { stageId: FlowStageId }>, overrides: Record<string, unknown> = {}): Row {
  const fixture = loadStageArtifactFixture('ux')
  return {
    ...fixture,
    projectId: PROJECT_ID,
    stageId,
    dependsOn,
    attachments: [],
    content: { ...fixture.content, summary: `${stageId} content`, screens: [] },
    ...overrides,
  }
}

function dependency(stageId: FlowStageId, ref: StageArtifactRef): StageArtifactRef & { stageId: FlowStageId } {
  return { stageId, ...ref }
}

function toRef(result: StageArtifactCommandResult): StageArtifactRef {
  return { artifactId: result.artifactId, version: result.version, contentHash: result.contentHash }
}

function runCreate(stageId: FlowStageId, artifact: Row, options: HarnessOptions = withLock()) {
  const { ctx, em } = harness(options)
  return { result: Promise.resolve(createArtifact.execute({ projectId: PROJECT_ID, stageId, artifact }, ctx)), em }
}

async function created(stageId: FlowStageId, artifact: Row, options: HarnessOptions = withLock()): Promise<StageArtifactCommandResult> {
  return runCreate(stageId, artifact, options).result
}

function clientApproval(): ClientApproval {
  const fixture = loadStageDecisionRequestFixture().clientApproval
  if (!fixture) throw new Error('[internal] fixture has no client approval')
  return fixture
}

function decisionRequest(ref: StageArtifactRef, overrides: Record<string, unknown> = {}): Row {
  return { artifactId: ref.artifactId, subjectHash: ref.contentHash, subjectVersion: ref.version, verdict: 'approved', ...overrides }
}

function runDecide(stageId: FlowStageId, decision: Row, idempotencyKey: string | undefined, options: HarnessOptions = withLock()) {
  const { ctx, em } = harness(options)
  const input: Row = { projectId: PROJECT_ID, stageId, decision }
  if (idempotencyKey !== undefined) input.idempotencyKey = idempotencyKey
  return { result: Promise.resolve(decide.execute(input, ctx)), em }
}

async function decided(stageId: FlowStageId, decision: Row, idempotencyKey: string, options: HarnessOptions = withLock()): Promise<StageDecisionCommandResult> {
  return runDecide(stageId, decision, idempotencyKey, options).result
}

async function approveStage(stageId: FlowStageId, ref: StageArtifactRef, key: string): Promise<StageDecisionCommandResult> {
  const needsClient = stageId === 'key_visual' || stageId === 'design_system_ui'
  return decided(stageId, decisionRequest(ref, needsClient ? { clientApproval: clientApproval() } : {}), key)
}

type Walk = Record<FlowStageId, StageArtifactRef>

async function walkStages(upTo: FlowStageId = 'design_system_ui'): Promise<Walk> {
  const refs = {} as Walk
  let previous: { stageId: FlowStageId; ref: StageArtifactRef } | null = null
  for (const stageId of STAGE_ORDER) {
    const artifact = stageId === 'scope' ? scopeArtifact() : designArtifact(stageId, previous ? [dependency(previous.stageId, previous.ref)] : [])
    const ref = toRef(await created(stageId, artifact))
    refs[stageId] = ref
    if (stageId === upTo) break
    await approveStage(stageId, ref, `approve-${stageId}`)
    previous = { stageId, ref }
  }
  return refs
}

function currencyOf(stageId: FlowStageId): string {
  const artifacts = store.stageArtifacts.map((row) => ({
    id: row.id as string,
    stageId: row.stageId as FlowStageId,
    version: row.version as number,
    contentHash: row.contentHash as string,
    dependsOn: row.dependsOn as StageArtifactRef[] as never,
  }))
  const decisions = store.stageDecisions.map((row) => ({
    id: row.id as string,
    stageId: row.stageId as FlowStageId,
    artifactId: row.artifactId as string,
    subjectHash: row.subjectHash as string,
    verdict: row.verdict as 'approved' | 'rejected',
    decidedAt: (row.decidedAt as Date).toISOString(),
    clientApproved: typeof row.clientApproverName === 'string',
  }))
  return computeStageCurrency(DEFAULT_FLOW_TEMPLATE, artifacts, decisions)[stageId].currency
}

function eventIds(): string[] {
  return mockEmitDeliveryOsEvent.mock.calls.map((call) => call[0] as string)
}

function taskRow(overrides: Row = {}): DeliveryTask {
  return {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    baselineId: null,
    title: 'Booking form',
    status: 'executing',
    statusReason: null,
    attemptNumber: 1,
    executionAttempts: [],
    deletedAt: null,
    updatedAt: UPDATED_AT,
    ...overrides,
  } as unknown as DeliveryTask
}

beforeEach(() => {
  idCounter = 0
  mockEmitDeliveryOsEvent.mockClear()
  mockFindOneWithDecryption.mockReset()
  mockFindWithDecryption.mockReset()
  mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Row) => rows(entity).find((row) => matches(row, where)) ?? null)
  mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Row) => rows(entity).filter((row) => matches(row, where)))
  store = { ...emptyStore(), stageArtifacts: [], stageDecisions: [], projects: [pinnedProject()] }
})

describe('delivery_os.stages.create_artifact (F7) — happy path', () => {
  it('records the four stages in order: version 1 each, current hash, template hash, events, project version bumped', async () => {
    const before = store.projects[0].updatedAt.getTime()
    const refs = await walkStages()
    for (const stageId of STAGE_ORDER) {
      expect(refs[stageId].version).toBe(1)
      expect(currencyOf(stageId)).toBe(stageId === 'design_system_ui' ? 'pending' : 'approved')
    }
    expect(store.stageArtifacts).toHaveLength(4)
    expect(store.stageArtifacts.map((row) => row.templateHash)).toEqual(Array(4).fill(hashFlowTemplate(DEFAULT_FLOW_TEMPLATE)))
    expect(store.stageArtifacts[0]).toMatchObject({ stageId: 'scope', source: 'intake', createdBy: ACTOR_ID, attachmentIds: [] })
    expect(store.stageArtifacts[1].dependsOn).toEqual([dependency('scope', refs.scope)])
    expect(eventIds().filter((id) => id === 'delivery_os.stage.artifact_created')).toHaveLength(4)
    const artifactEvent = mockEmitDeliveryOsEvent.mock.calls[0]
    expect(artifactEvent[1]).toEqual({
      projectId: PROJECT_ID,
      stageId: 'scope',
      artifactId: refs.scope.artifactId,
      version: 1,
      contentHash: refs.scope.contentHash,
      downstreamNowStale: [],
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })
    expect(artifactEvent[2]).toEqual({ persistent: true, tenantId: TENANT_ID, organizationId: ORG_ID })
    expect(store.projects[0].updatedAt.getTime()).toBeGreaterThan(before)
  })

  it('answers a schema-valid response with the expected content hash and locks the project row', async () => {
    const artifact = scopeArtifact()
    const { result, em } = runCreate('scope', artifact)
    const response = await result
    expect(stageArtifactCreateResponseSchema.safeParse(response).success).toBe(true)
    expect(response).toMatchObject({
      projectId: PROJECT_ID,
      stageId: 'scope',
      version: 1,
      duplicate: false,
      downstreamNowStale: [],
      contentHash: hashStageArtifactContent(artifact as unknown as StageArtifactV1),
      projectUpdatedAt: store.projects[0].updatedAt.toISOString(),
    })
    const lockedLoads = mockFindOneWithDecryption.mock.calls.filter(([, entity, , options]) => entity === DeliveryProject && options !== undefined)
    expect(lockedLoads.map((call) => call[3])).toEqual([{ lockMode: LockMode.PESSIMISTIC_WRITE }])
    expect(em.transactional).toHaveBeenCalledTimes(1)
  })

  it('verifies design attachments against the stored files and records the attachment ids', async () => {
    const refs = await walkStages('scope')
    await approveStage('scope', refs.scope, 'approve-scope')
    const fixture = loadStageArtifactFixture('ux')
    const withScreens = { ...fixture, projectId: PROJECT_ID, dependsOn: [dependency('scope', refs.scope)] }
    const missing = await catchHttpError(() => created('ux', withScreens))
    expectFrozenBody(missing, 422, 'attachment_scope_mismatch')

    store.attachments.push({
      id: UX_ATTACHMENT_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      mimeType: 'image/png',
      fileSize: 20480,
      partitionCode: 'privateAttachments',
      storagePath: `delivery/${UX_ATTACHMENT_ID}.png`,
      storedSha256: UX_ATTACHMENT_SHA,
      unreadable: false,
    })
    const response = await created('ux', withScreens)
    expect(response.duplicate).toBe(false)
    expect(store.stageArtifacts[1].attachmentIds).toEqual([UX_ATTACHMENT_ID])
  })

  it('accepts an issued trusted execution in-process without a lock header and refuses it over HTTP', async () => {
    const trusted = issueTrustedExecution(ACTOR_ID)
    const { ctx } = harness({ inProcess: true })
    const response = await createArtifact.execute({ projectId: PROJECT_ID, stageId: 'scope', artifact: scopeArtifact(), trustedExecution: trusted }, ctx)
    expect(response.duplicate).toBe(false)
    const { ctx: httpCtx } = harness(withLock())
    const refused = await catchHttpError(() =>
      createArtifact.execute({ projectId: PROJECT_ID, stageId: 'scope', artifact: scopeArtifact({ source: 'agent' }), trustedExecution: trusted }, httpCtx),
    )
    expectFrozenBody(refused, 403, 'forbidden')
    expect(detailCodes(refused)).toEqual(['trusted_execution_required'])
  })
})

describe('delivery_os.stages.create_artifact (F7) — refusals', () => {
  it('foreign_dependency: a dependency on a downstream stage is refused before any load', async () => {
    const error = await catchHttpError(() => created('ux', designArtifact('ux', [dependency('key_visual', { artifactId: FOREIGN_ARTIFACT_ID, version: 1, contentHash: 'a'.repeat(64) })])))
    expectFrozenBody(error, 422, 'foreign_dependency')
    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
  })

  it('foreign_reference: path stage or project differs from the body', async () => {
    const stageMismatch = await catchHttpError(() => created('ux', scopeArtifact()))
    expectFrozenBody(stageMismatch, 422, 'foreign_reference')
    const projectMismatch = await catchHttpError(() => created('scope', scopeArtifact({ projectId: FOREIGN_ARTIFACT_ID })))
    expectFrozenBody(projectMismatch, 422, 'foreign_reference')
  })

  it('stage_not_approved: a ux artifact cannot bind a Scope that is still pending', async () => {
    const refs = await walkStages('scope')
    const error = await catchHttpError(() => created('ux', designArtifact('ux', [dependency('scope', refs.scope)])))
    expectFlowBody(error, 422, 'stage_not_approved')
    expect(detailCodes(error)).toEqual(['stage_not_approved'])
  })

  it('stage_artifact_stale: binding a superseded Scope version is refused with 409', async () => {
    const refs = await walkStages('scope')
    await approveStage('scope', refs.scope, 'approve-scope-v1')
    const v2 = toRef(await created('scope', scopeArtifact({ content: { ...loadStageArtifactFixture('scope').content, summary: 'Revised scope' } })))
    expect(v2.version).toBe(2)
    await approveStage('scope', v2, 'approve-scope-v2')
    const error = await catchHttpError(() => created('ux', designArtifact('ux', [dependency('scope', refs.scope)])))
    expectFlowBody(error, 409, 'stage_artifact_stale')
    expect(detailCodes(error)).toEqual(['stage_artifact_stale'])
  })

  it('stage_dependency_stale: a new Scope version makes ux stale, so Key Visual cannot bind it and ux cannot be re-approved', async () => {
    const refs = await walkStages('key_visual')
    const scopeV2 = await created('scope', scopeArtifact({ content: { ...loadStageArtifactFixture('scope').content, summary: 'Revised scope' } }))
    expect(scopeV2.downstreamNowStale).toEqual(['ux', 'key_visual'])
    expect(currencyOf('ux')).toBe('stale')
    expect(store.stageDecisions).toHaveLength(2)
    expect(store.stageArtifacts).toHaveLength(4)

    const bindStale = await catchHttpError(() => created('key_visual', designArtifact('key_visual', [dependency('ux', refs.ux)], { content: { summary: 'KV v2', figmaRefs: [], screens: [], notes: null, resolvedThreadKeys: [] } })))
    expectFlowBody(bindStale, 422, 'stage_dependency_stale')
    const scopePending = await catchHttpError(() => decided('ux', decisionRequest(refs.ux), 'approve-ux-again'))
    expectFlowBody(scopePending, 422, 'stage_not_approved')
    await approveStage('scope', toRef(scopeV2), 'approve-scope-v2')
    expect(currencyOf('ux')).toBe('stale')
    const boundToOldHash = await catchHttpError(() => decided('ux', decisionRequest(refs.ux), 'approve-ux-again'))
    expectFlowBody(boundToOldHash, 422, 'stage_dependency_stale')
    expect(detailCodes(boundToOldHash)).toEqual(['stage_dependency_stale'])
    expect(store.stageDecisions).toHaveLength(3)
  })

  it('target_profile_frozen: the Scope may confirm the frozen profile, never change it', async () => {
    const content = loadStageArtifactFixture('scope').content
    const error = await catchHttpError(() =>
      created('scope', scopeArtifact({ content: { ...content, platform: { profileId: OTHER_PROFILE.id, profileVersion: OTHER_PROFILE.version, rationale: 'SPA instead' } } })),
    )
    expectFlowBody(error, 422, 'target_profile_frozen')
    expect(detailCodes(error)).toEqual(['target_profile_frozen'])
    expect(store.stageArtifacts).toHaveLength(0)
  })

  it('unknown_ac: v1 stage content carries no AC references, so the reachable failure is an AC whose requirement is unknown', async () => {
    const content = loadStageArtifactFixture('scope').content
    const criteria = content.acceptanceCriteria.map((criterion, index) => (index === 0 ? { ...criterion, requirementId: 'REQ-999' } : criterion))
    const error = await catchHttpError(() => created('scope', scopeArtifact({ content: { ...content, acceptanceCriteria: criteria } })))
    expectFrozenBody(error, 422, 'foreign_reference')
    expect(store.stageArtifacts).toHaveLength(0)
  })

  it('duplicate content: identical content answers the existing version without a lock header, a write or an event', async () => {
    const first = await created('scope', scopeArtifact())
    mockEmitDeliveryOsEvent.mockClear()
    const { result, em } = runCreate('scope', scopeArtifact({ source: 'manual' }), { headers: {} })
    const replay = await result
    expect(replay).toMatchObject({ artifactId: first.artifactId, version: 1, contentHash: first.contentHash, duplicate: true, downstreamNowStale: [] })
    expect(store.stageArtifacts).toHaveLength(1)
    expect(em.transactional).not.toHaveBeenCalled()
    expect(mockEmitDeliveryOsEvent).not.toHaveBeenCalled()
  })

  it('attempt_active: an executing task or an unknown attempt on the project blocks a new stage version', async () => {
    store.tasks.push(taskRow())
    const active = await catchHttpError(() => created('scope', scopeArtifact()))
    expectFrozenBody(active, 409, 'attempt_active')
    expect(detailCodes(active)).toEqual(['task_executing'])
    const staleWithActive = await catchHttpError(() => created('scope', scopeArtifact(), { headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: STALE_UPDATED_AT } }))
    expectFrozenBody(staleWithActive, 409, 'attempt_active')
    store.tasks[0] = taskRow({ status: 'blocked', statusReason: 'reconciliation_required' })
    const unknown = await catchHttpError(() => created('scope', scopeArtifact()))
    expectFrozenBody(unknown, 409, 'reconciliation_required')
    expect(store.stageArtifacts).toHaveLength(0)
  })

  it('flow_not_pinned and stage_unknown fail closed', async () => {
    store.projects = [makeProject(WORDPRESS_PROFILE)]
    const unpinned = await catchHttpError(() => created('scope', scopeArtifact()))
    expectFlowBody(unpinned, 422, 'flow_not_pinned')
    store.projects = [pinnedProject({ flowTemplateSnapshot: { ...DEFAULT_FLOW_TEMPLATE, stages: DEFAULT_FLOW_TEMPLATE.stages.filter((stage) => stage.kind !== 'scope') } })]
    const unknown = await catchHttpError(() => created('scope', scopeArtifact()))
    expectFlowBody(unknown, 422, 'stage_unknown')
  })

  it('lock: the header is required after the replay check and a stale header answers 409', async () => {
    const missing = await catchHttpError(() => created('scope', scopeArtifact(), { headers: {} }))
    expectFrozenBody(missing, 428, 'optimistic_lock_required')
    const stale = await catchHttpError(() => created('scope', scopeArtifact(), { headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: STALE_UPDATED_AT } }))
    expect(stale.status).toBe(409)
    expect(stale.body.code).toBe('optimistic_lock_conflict')
    expect(store.stageArtifacts).toHaveLength(0)
  })

  it('recovers a unique violation from a parallel writer as the duplicate answer', async () => {
    const artifact = scopeArtifact()
    const winner = { ...artifact, id: FOREIGN_ARTIFACT_ID, tenantId: TENANT_ID, organizationId: ORG_ID, version: 1, contentHash: hashStageArtifactContent(artifact as unknown as StageArtifactV1), templateHash: 'x' }
    let loads = 0
    mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Row) => {
      const found = rows(entity).filter((row) => matches(row, where))
      if (entity === DeliveryFlowStageArtifact) {
        loads += 1
        if (loads === 2) store.stageArtifacts.push(winner)
      }
      return found
    })
    const response = await created('scope', artifact, withLock({ uniqueRace: true }))
    expect(response).toMatchObject({ artifactId: FOREIGN_ARTIFACT_ID, duplicate: true, version: 1 })
    expect(store.stageArtifacts).toHaveLength(1)
    expect(mockEmitDeliveryOsEvent).not.toHaveBeenCalled()
  })

  it('answers 404 for a project of another organization', async () => {
    const error = await catchHttpError(() => created('scope', scopeArtifact(), withLock({ orgId: FOREIGN_ORG_ID })))
    expectFrozenBody(error, 404, 'not_found')
  })
})

describe('delivery_os.stages.decide (F8)', () => {
  it('approve → reject → approve with three keys appends three rows and reports the currency after each', async () => {
    const refs = await walkStages('scope')
    const approved = await decided('scope', decisionRequest(refs.scope), 'k1')
    expect(stageDecisionResponseSchema.safeParse(approved).success).toBe(true)
    expect(approved).toMatchObject({ verdict: 'approved', currency: 'approved', duplicate: false, clientApproved: false, subjectVersion: 1, subjectHash: refs.scope.contentHash })
    const rejected = await decided('scope', decisionRequest(refs.scope, { verdict: 'rejected', reason: 'Booking flow missing a cancellation step' }), 'k2')
    expect(rejected).toMatchObject({ verdict: 'rejected', currency: 'rejected', duplicate: false })
    expect(currencyOf('scope')).toBe('rejected')
    const again = await decided('scope', decisionRequest(refs.scope), 'k3')
    expect(again).toMatchObject({ verdict: 'approved', currency: 'approved', duplicate: false })
    expect(store.stageDecisions).toHaveLength(3)
    expect(store.stageDecisions.map((row) => row.idempotencyKey)).toEqual(['k1', 'k2', 'k3'])
    expect(store.stageDecisions[1]).toMatchObject({ reason: 'Booking flow missing a cancellation step', actorUserId: ACTOR_ID, clientApproverName: null, clientApprovalEvidence: null })
    expect(store.stageDecisions[0]).toMatchObject({ templateHash: hashFlowTemplate(DEFAULT_FLOW_TEMPLATE), subjectVersion: 1 })
    const decidedEvents = mockEmitDeliveryOsEvent.mock.calls.filter((call) => call[0] === 'delivery_os.stage.decided')
    expect(decidedEvents).toHaveLength(3)
    expect(decidedEvents[1][1]).toEqual({
      projectId: PROJECT_ID,
      stageId: 'scope',
      artifactId: refs.scope.artifactId,
      decisionId: rejected.decisionId,
      verdict: 'rejected',
      currency: 'rejected',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })
  })

  it('same key + same body replays without a lock header, a row or an event; same key + other body answers 409', async () => {
    const refs = await walkStages('scope')
    const first = await decided('scope', decisionRequest(refs.scope), 'k1')
    mockEmitDeliveryOsEvent.mockClear()
    const { result, em } = runDecide('scope', decisionRequest(refs.scope, { reason: null }), 'k1', { headers: {} })
    const replay = await result
    expect(replay).toMatchObject({ decisionId: first.decisionId, duplicate: true, currency: 'approved', verdict: 'approved' })
    expect(store.stageDecisions).toHaveLength(1)
    expect(em.transactional).not.toHaveBeenCalled()
    expect(mockEmitDeliveryOsEvent).not.toHaveBeenCalled()

    const conflict = await catchHttpError(() => decided('scope', decisionRequest(refs.scope, { verdict: 'rejected', reason: 'changed my mind' }), 'k1'))
    expectFrozenBody(conflict, 409, 'idempotency_conflict')
    const otherStage = await catchHttpError(() => decided('ux', decisionRequest(refs.scope), 'k1'))
    expectFrozenBody(otherStage, 409, 'idempotency_conflict')
  })

  it('old hash or old version answers 409 subject_hash_mismatch; a superseded artifact answers 409 stage_artifact_stale', async () => {
    const refs = await walkStages('scope')
    const oldHash = await catchHttpError(() => decided('scope', decisionRequest({ ...refs.scope, contentHash: 'b'.repeat(64) }), 'k1'))
    expectFrozenBody(oldHash, 409, 'subject_hash_mismatch')
    const oldVersion = await catchHttpError(() => decided('scope', decisionRequest({ ...refs.scope, version: 7 }), 'k2'))
    expectFrozenBody(oldVersion, 409, 'subject_hash_mismatch')
    await created('scope', scopeArtifact({ content: { ...loadStageArtifactFixture('scope').content, summary: 'Revised scope' } }))
    const superseded = await catchHttpError(() => decided('scope', decisionRequest(refs.scope), 'k3'))
    expectFlowBody(superseded, 409, 'stage_artifact_stale')
    expect(store.stageDecisions).toHaveLength(0)
  })

  it('client_approval_required on key_visual; a recorded client approval is stored on the encrypted columns', async () => {
    const refs = await walkStages('key_visual')
    const missing = await catchHttpError(() => decided('key_visual', decisionRequest(refs.key_visual), 'kv-1'))
    expectFlowBody(missing, 422, 'client_approval_required')
    expect(currencyOf('key_visual')).toBe('pending')
    const approval = clientApproval()
    const approved = await decided('key_visual', decisionRequest(refs.key_visual, { clientApproval: approval }), 'kv-2')
    expect(approved).toMatchObject({ clientApproved: true, currency: 'approved' })
    expect(store.stageDecisions[2]).toMatchObject({
      clientApproverName: approval.approverName,
      clientApproverRole: approval.approverRole,
      clientApprovalEvidence: approval.evidence,
      deferredThreadKeys: [],
    })
  })

  it('approver features from the snapshot: manage-only caller → 403, wildcard grant passes, failing RBAC fails closed', async () => {
    const refs = await walkStages('scope')
    const denied = await catchHttpError(() => decided('scope', decisionRequest(refs.scope), 'k1', withLock({ features: ['delivery_os.projects.manage'] })))
    expectFrozenBody(denied, 403, 'forbidden')
    expect((denied.body.details as Array<{ path: string }>).map((detail) => detail.path)).toEqual(['stages.scope.approverFeatures'])
    expect(lastGrantLookup).toHaveBeenCalledWith(ACTOR_ID, { tenantId: TENANT_ID, organizationId: ORG_ID })
    const unavailable = await catchHttpError(() => decided('scope', decisionRequest(refs.scope), 'k2', withLock({ features: 'throw' })))
    expectFrozenBody(unavailable, 403, 'forbidden')
    const wildcard = await decided('scope', decisionRequest(refs.scope), 'k3', withLock({ features: ['delivery_os.*'] }))
    expect(wildcard.duplicate).toBe(false)
    expect(store.stageDecisions).toHaveLength(1)
  })

  it('idempotency_key_required, reason_required, foreign artifact and the lock header', async () => {
    const refs = await walkStages('scope')
    const noKey = await catchHttpError(() => runDecide('scope', decisionRequest(refs.scope), undefined).result)
    expectFrozenBody(noKey, 400, 'idempotency_key_required')
    const noReason = await catchHttpError(() => decided('scope', decisionRequest(refs.scope, { verdict: 'rejected' }), 'k1'))
    expectFrozenBody(noReason, 422, 'reason_required')
    const foreign = await catchHttpError(() => decided('scope', decisionRequest({ ...refs.scope, artifactId: FOREIGN_ARTIFACT_ID }), 'k2'))
    expectFrozenBody(foreign, 422, 'foreign_reference')
    const missingLock = await catchHttpError(() => decided('scope', decisionRequest(refs.scope), 'k3', { headers: {} }))
    expectFrozenBody(missingLock, 428, 'optimistic_lock_required')
    const stale = await catchHttpError(() => decided('scope', decisionRequest(refs.scope), 'k4', { headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: STALE_UPDATED_AT } }))
    expect(stale.body.code).toBe('optimistic_lock_conflict')
    const unpinned = await catchHttpError(() => {
      store.projects[0].flowTemplateSnapshot = null
      return decided('scope', decisionRequest(refs.scope), 'k5')
    })
    expectFlowBody(unpinned, 422, 'flow_not_pinned')
    expect(store.stageDecisions).toHaveLength(0)
  })

  it('recovers a unique violation on the idempotency key as replay or conflict', async () => {
    const refs = await walkStages('scope')
    const approvedBody = decisionRequest(refs.scope)
    const winner: Row = {
      id: FOREIGN_ARTIFACT_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      stageId: 'scope',
      artifactId: refs.scope.artifactId,
      subjectHash: refs.scope.contentHash,
      subjectVersion: 1,
      verdict: 'approved',
      reason: null,
      actorUserId: ACTOR_ID,
      decidedAt: UPDATED_AT,
      clientApproverName: null,
      idempotencyKey: 'k1',
      requestHash: hashStageDecisionRequest(stageDecisionRequestSchema.parse(approvedBody)),
      templateHash: hashFlowTemplate(DEFAULT_FLOW_TEMPLATE),
    }
    let loads = 0
    mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Row) => {
      const found = rows(entity).filter((row) => matches(row, where))
      if (entity === DeliveryFlowStageDecision) {
        loads += 1
        if (loads === 2) store.stageDecisions.push(winner)
      }
      return found
    })
    const { result, em } = runDecide('scope', approvedBody, 'k1', withLock({ uniqueRace: true }))
    const replay = await result
    expect(em.persist).toHaveBeenCalledTimes(1)
    expect(em.persist.mock.results[0].type).toBe('throw')
    expect(replay).toMatchObject({ decisionId: FOREIGN_ARTIFACT_ID, duplicate: true, currency: 'approved', verdict: 'approved' })
    expect(store.stageDecisions).toHaveLength(1)
    expect(mockEmitDeliveryOsEvent.mock.calls.filter((call) => call[0] === 'delivery_os.stage.decided')).toHaveLength(0)

    store.stageDecisions = []
    loads = 0
    const raced = runDecide('scope', decisionRequest(refs.scope, { verdict: 'rejected', reason: 'no' }), 'k1', withLock({ uniqueRace: true }))
    const conflict = await catchHttpError(() => raced.result)
    expect(raced.em.persist.mock.results[0].type).toBe('throw')
    expectFrozenBody(conflict, 409, 'idempotency_conflict')
  })

  it('a new Scope version keeps every old decision in history and the last approved artifact stays reported', async () => {
    const refs = await walkStages('ux')
    await approveStage('ux', refs.ux, 'approve-ux')
    const beforeRows = store.stageDecisions.map((row) => JSON.stringify(row))
    await created('scope', scopeArtifact({ content: { ...loadStageArtifactFixture('scope').content, summary: 'Revised scope' } }))
    expect(store.stageDecisions.map((row) => JSON.stringify(row))).toEqual(beforeRows)
    expect(currencyOf('scope')).toBe('pending')
    expect(currencyOf('ux')).toBe('stale')
    const states = computeStageCurrency(
      DEFAULT_FLOW_TEMPLATE,
      store.stageArtifacts.map((row) => ({ id: row.id as string, stageId: row.stageId as FlowStageId, version: row.version as number, contentHash: row.contentHash as string, dependsOn: row.dependsOn as never })),
      store.stageDecisions.map((row) => ({ id: row.id as string, stageId: row.stageId as FlowStageId, artifactId: row.artifactId as string, subjectHash: row.subjectHash as string, verdict: row.verdict as 'approved', decidedAt: (row.decidedAt as Date).toISOString(), clientApproved: false })),
    )
    expect(states.scope.approvedArtifact).toEqual(refs.scope)
    expect(states.ux.approvedArtifact).toEqual(refs.ux)
  })
})

describe('delivery_os.stages.decide (F8) — comment threads', () => {
  function thread(threadKey: string, overrides: Row = {}): Row {
    return {
      id: nextId(),
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      source: 'figma',
      fileKey: 'fileA',
      threadKey,
      stageId: 'ux',
      artifactId: null,
      author: { name: 'Anna', externalId: null },
      body: 'Move the CTA',
      sourceStatus: 'open',
      triageStatus: 'new',
      deferral: null,
      updatedAt: UPDATED_AT,
      ...overrides,
    }
  }

  function blockedKeys(error: CrudHttpError): string[] {
    return (error.body.details as Array<{ path: string }>).map((detail) => detail.path)
  }

  it('an open thread on the current artifact blocks the approval until it is resolved; a triaged one still blocks', async () => {
    const refs = await walkStages('ux')
    store.commentThreads.push(thread('t-new', { artifactId: refs.ux.artifactId }), thread('t-triaged', { artifactId: refs.ux.artifactId, triageStatus: 'triaged' }))
    const blocked = await catchHttpError(() => decided('ux', decisionRequest(refs.ux), 'ux-1'))
    expectFlowBody(blocked, 422, 'blocking_comments_open')
    expect(blockedKeys(blocked)).toEqual(['threads.t-new', 'threads.t-triaged'])
    expect(store.stageDecisions.filter((row) => row.stageId === 'ux')).toHaveLength(0)
    const rejected = await decided('ux', decisionRequest(refs.ux, { verdict: 'rejected', reason: 'Feedback is open' }), 'ux-reject')
    expect(rejected.verdict).toBe('rejected')
    for (const row of store.commentThreads) row.triageStatus = 'resolved'
    expect((await decided('ux', decisionRequest(refs.ux), 'ux-2')).currency).toBe('approved')
  })

  it('a thread without a confirmed design version blocks; threads of another stage, project, organization or closed at the source do not', async () => {
    const refs = await walkStages('ux')
    store.commentThreads.push(
      thread('t-other-stage', { stageId: 'key_visual' }),
      thread('t-other-project', { projectId: FOREIGN_ARTIFACT_ID }),
      thread('t-other-org', { organizationId: FOREIGN_ORG_ID }),
      thread('t-resolved-at-source', { sourceStatus: 'resolved' }),
      thread('t-deleted-at-source', { sourceStatus: 'deleted' }),
    )
    store.commentThreads.push(thread('t-unbound'))
    const blocked = await catchHttpError(() => decided('ux', decisionRequest(refs.ux), 'ux-1'))
    expectFlowBody(blocked, 422, 'blocking_comments_open')
    expect(blockedKeys(blocked)).toEqual(['threads.t-unbound'])
  })

  it('deferredThreadKeys records hash-bound deferrals on the blocking rows only, inside the decision', async () => {
    const refs = await walkStages('ux')
    store.commentThreads.push(
      thread('t-1', { artifactId: refs.ux.artifactId }),
      thread('t-1', { fileKey: 'fileB', sourceStatus: 'resolved' }),
      thread('t-2', { artifactId: refs.ux.artifactId, triageStatus: 'resolved' }),
    )
    const approved = await decided('ux', decisionRequest(refs.ux, { deferredThreadKeys: ['t-1', 't-2'], reason: 'Client accepted the follow-up' }), 'ux-1')
    expect(approved.currency).toBe('approved')
    expect(store.stageDecisions.at(-1)).toMatchObject({ deferredThreadKeys: ['t-1'] })
    expect(store.commentThreads[0]).toMatchObject({
      triageStatus: 'deferred',
      deferral: { artifactId: refs.ux.artifactId, contentHash: refs.ux.contentHash, reason: 'Client accepted the follow-up', decidedBy: ACTOR_ID },
    })
    expect((store.commentThreads[0].updatedAt as Date).getTime()).toBeGreaterThan(UPDATED_AT.getTime())
    expect(store.commentThreads[1]).toMatchObject({ triageStatus: 'new', deferral: null, updatedAt: UPDATED_AT })
    expect(store.commentThreads[2]).toMatchObject({ triageStatus: 'resolved', deferral: null })
  })

  it('row-locks the stage threads once inside the transaction; the same key blocking in two files is deferred on both rows and stored once', async () => {
    const refs = await walkStages('ux')
    store.commentThreads.push(thread('t-1', { artifactId: refs.ux.artifactId }), thread('t-1', { fileKey: 'fileB' }))
    mockFindWithDecryption.mockClear()
    await decided('ux', decisionRequest(refs.ux, { deferredThreadKeys: ['t-1'] }), 'ux-1')
    const threadLoads = mockFindWithDecryption.mock.calls.filter((call) => call[1] === DeliveryCommentThread)
    expect(threadLoads.map((call) => (call[3] as { lockMode?: LockMode }).lockMode)).toEqual([undefined, LockMode.PESSIMISTIC_WRITE])
    expect(store.commentThreads.map((row) => row.triageStatus)).toEqual(['deferred', 'deferred'])
    expect(store.stageDecisions.at(-1)).toMatchObject({ deferredThreadKeys: ['t-1'] })
  })

  it('an unknown deferred key is a foreign reference and writes nothing', async () => {
    const refs = await walkStages('ux')
    store.commentThreads.push(thread('t-1', { artifactId: refs.ux.artifactId }))
    const error = await catchHttpError(() => decided('ux', decisionRequest(refs.ux, { deferredThreadKeys: ['t-1', 't-ghost'] }), 'ux-1'))
    expectFlowBody(error, 422, 'foreign_reference')
    expect(store.commentThreads[0].triageStatus).toBe('new')
  })

  it('a deferral bound to an older hash blocks again on the next artifact version', async () => {
    const refs = await walkStages('ux')
    store.commentThreads.push(thread('t-1'))
    await decided('ux', decisionRequest(refs.ux, { deferredThreadKeys: ['t-1'] }), 'ux-1')
    expect(store.commentThreads[0].triageStatus).toBe('deferred')
    const next = toRef(await created('ux', designArtifact('ux', [dependency('scope', refs.scope)], { content: { ...loadStageArtifactFixture('ux').content, summary: 'ux v2', screens: [] } })))
    expect(next.version).toBe(2)
    const blocked = await catchHttpError(() => decided('ux', decisionRequest(next), 'ux-2'))
    expectFlowBody(blocked, 422, 'blocking_comments_open')
    expect(blockedKeys(blocked)).toEqual(['threads.t-1'])
    const again = await decided('ux', decisionRequest(next, { deferredThreadKeys: ['t-1'] }), 'ux-3')
    expect(again.currency).toBe('approved')
    expect(store.commentThreads[0].deferral).toMatchObject({ artifactId: next.artifactId, contentHash: next.contentHash })
  })
})
