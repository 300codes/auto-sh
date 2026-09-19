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
import { DeliveryIntake, DeliveryProject } from '../../data/entities'
import { deliveryFlowErrorBodySchema, intakeResponseSchema, scopingProposalImportResponseSchema, type IntakeV1 } from '../../lib/contracts'
import { loadIntakeFixture, loadScopingProposalFixture } from '../../lib/fixtures/flow/index'
import { hashScopingProposal } from '../../lib/intakeRules'
import { issueTrustedExecution } from '../../lib/trustedExecution'
import type { IntakeUpdateCommandResult, ScopingProposalImportCommandResult } from '../intake'
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
  NEW_ROW_ID,
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

type IntakeStore = Store & { intakes: Row[] }

const WORDPRESS_PROFILE = { targetProfileId: 'wordpress-theme', targetProfileVersion: 1 }

const update = getHandler<IntakeUpdateCommandResult>('delivery_os.intake.update')
const importProposal = getHandler<ScopingProposalImportCommandResult>('delivery_os.intake.import_proposal')

let store: IntakeStore

function rows(entity: unknown): Row[] {
  if (entity === DeliveryIntake) return store.intakes
  return rowsFor(store, entity)
}

function harness(options: { headers?: Record<string, string>; orgId?: string; inProcess?: boolean; sub?: string } = {}) {
  const built = makeHarness(store, options)
  built.em.persist.mockImplementation((row: Row) => {
    if ('schemaVersion' in row && 'brief' in row) store.intakes.push(row)
  })
  const ctx: CommandRuntimeContext = options.inProcess ? { ...built.ctx, request: undefined } : built.ctx
  return { ctx, em: built.em }
}

function lockHeader(value: Date | string): Record<string, string> {
  return { [OPTIMISTIC_LOCK_HEADER_NAME]: typeof value === 'string' ? value : value.toISOString() }
}

function firstWriteHeader(): Record<string, string> {
  return lockHeader(store.projects[0].createdAt)
}

function intakeRequest(overrides: Partial<IntakeV1> & Record<string, unknown> = {}): Row {
  const fixture = loadIntakeFixture()
  const { projectId: _projectId, proposals: _proposals, ...request } = fixture
  return { ...request, step: 'scoping', brief: { ...fixture.brief, materials: [] }, ...overrides }
}

function runUpdate(intake: Row, options: Parameters<typeof harness>[0] = { headers: firstWriteHeader() }) {
  const { ctx, em } = harness(options)
  return { result: Promise.resolve(update.execute({ projectId: PROJECT_ID, intake }, ctx)), em }
}

function storedIntakeRow(overrides: Row = {}): Row {
  const fixture = loadIntakeFixture()
  return {
    id: NEW_ROW_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    schemaVersion: 'delivery.intake/v1',
    step: 'submitted',
    brief: { ...fixture.brief, materials: [] },
    questions: [],
    proposals: [],
    platform: fixture.platform,
    tools: fixture.tools,
    importedManifests: [],
    createdAt: UPDATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  }
}

function proposalInput(overrides: Row = {}): Row {
  return { projectId: PROJECT_ID, proposal: { ...loadScopingProposalFixture(), projectId: PROJECT_ID }, ...overrides }
}

beforeEach(() => {
  mockEmitDeliveryOsEvent.mockClear()
  mockFindOneWithDecryption.mockReset()
  mockFindWithDecryption.mockReset()
  mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Row) =>
    rows(entity).find((row) => matches(row, where)) ?? null,
  )
  mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Row) =>
    rows(entity).filter((row) => matches(row, where)),
  )
  store = { ...emptyStore(), projects: [makeProject(WORDPRESS_PROFILE)], intakes: [] }
})

describe('delivery_os.intake.update (F2)', () => {
  it('refuses the first write without the lock header before touching the database', async () => {
    const { result, em } = runUpdate(intakeRequest(), { headers: {} })
    const error = await catchHttpError(() => result)
    expectFrozenBody(error, 428, 'optimistic_lock_required')
    expect(em.transactional).not.toHaveBeenCalled()
    expect(store.intakes).toHaveLength(0)
  })

  it('answers 409 when the first-write header differs from the project createdAt and creates nothing', async () => {
    const { result } = runUpdate(intakeRequest(), { headers: lockHeader(STALE_UPDATED_AT) })
    const error = await catchHttpError(() => result)
    expect(error.status).toBe(409)
    expect(error.body.code).toBe('optimistic_lock_conflict')
    expect(store.intakes).toHaveLength(0)
  })

  it('creates the single intake row lazily under the project row lock and leaves the project version alone', async () => {
    const before = store.projects[0].updatedAt
    const { result } = runUpdate(intakeRequest())
    const response = await result

    expect(intakeResponseSchema.safeParse(response).success).toBe(true)
    expect(response.intake).toMatchObject({ projectId: PROJECT_ID, step: 'scoping', proposals: [] })
    expect(response.targetProfile).toEqual({ profileId: 'wordpress-theme', profileVersion: 1 })
    expect(store.intakes).toHaveLength(1)
    expect(store.intakes[0]).toMatchObject({
      id: NEW_ROW_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      schemaVersion: 'delivery.intake/v1',
      step: 'scoping',
      createdBy: ACTOR_ID,
      importedManifests: [],
    })
    expect(response.updatedAt).toBe((store.intakes[0].updatedAt as Date).toISOString())
    expect(store.projects[0].updatedAt).toBe(before)
    const projectLock = mockFindOneWithDecryption.mock.calls.find(([, entity, , options]) => entity === DeliveryProject && options !== undefined)
    expect(projectLock?.[3]).toEqual({ lockMode: LockMode.PESSIMISTIC_WRITE })
    const intakeLock = mockFindOneWithDecryption.mock.calls.find(([, entity]) => entity === DeliveryIntake)
    expect(intakeLock?.[3]).toEqual({ lockMode: LockMode.PESSIMISTIC_WRITE })
    expect(mockEmitDeliveryOsEvent).not.toHaveBeenCalled()
  })

  it('strips a client-sent proposals key and keeps the server-owned references', async () => {
    await runUpdate(intakeRequest()).result
    const forged = [{ proposalId: 'forged', kind: 'scope', contentHash: 'f'.repeat(64), proposedAt: UPDATED_AT.toISOString(), status: 'accepted' }]
    const { result } = runUpdate(intakeRequest({ step: 'scoping', proposals: forged }), { headers: lockHeader(store.intakes[0].updatedAt as Date) })
    const response = await result
    expect(response.intake.proposals).toEqual([])
    expect(store.intakes[0].proposals).toEqual([])
  })

  it('locks later writes on the intake version, not the project version', async () => {
    await runUpdate(intakeRequest()).result
    const stale = await catchHttpError(() => runUpdate(intakeRequest(), { headers: firstWriteHeader() }).result)
    expect(stale.status).toBe(409)
    expect(stale.body.code).toBe('optimistic_lock_conflict')

    const { result } = runUpdate(intakeRequest({ step: 'platform' }), { headers: lockHeader(store.intakes[0].updatedAt as Date) })
    const response = await result
    expect(response.intake.step).toBe('platform')
    expect(store.intakes).toHaveLength(1)
    expect(store.intakes[0].step).toBe('platform')
  })

  it('refuses a chosen platform that differs from the frozen project profile', async () => {
    store.projects = [makeProject()]
    const error = await catchHttpError(() => runUpdate(intakeRequest()).result)
    expectFlowBody(error, 422, 'target_profile_frozen')
    expect(detailCodes(error)).toEqual(['target_profile_frozen'])
    expect(store.intakes).toHaveLength(0)
  })

  it('refuses skipping ahead and submitting with an unanswered blocking question', async () => {
    const skipped = await catchHttpError(() => runUpdate(intakeRequest({ step: 'platform' })).result)
    expectFlowBody(skipped, 422, 'intake_step_invalid')
    expect(detailCodes(skipped)).toEqual(['step_skipped'])

    const fixture = loadIntakeFixture()
    store.intakes = [storedIntakeRow({ step: 'review', questions: fixture.questions })]
    const unanswered = fixture.questions.map((question) => ({ ...question, answer: null }))
    const { result } = runUpdate(intakeRequest({ step: 'submitted', questions: unanswered }), { headers: lockHeader(UPDATED_AT) })
    const error = await catchHttpError(() => result)
    expectFlowBody(error, 422, 'intake_step_invalid')
    expect(detailCodes(error)).toEqual(['blocking_question_unanswered'])
    expect(store.intakes[0].step).toBe('review')
  })

  it('refuses duplicate stable ids as a shape error', async () => {
    const fixture = loadIntakeFixture()
    const [question] = fixture.questions
    const error = await catchHttpError(() => runUpdate(intakeRequest({ questions: [question, { ...question, text: 'again' }] })).result)
    expect(error.status).toBe(422)
    expect(error.body.code).toBe('duplicate_stable_id')
    expect(store.intakes).toHaveLength(0)
  })

  it('keeps brief and question text out of the audit snapshot', async () => {
    const fixture = loadIntakeFixture()
    const { ctx } = harness({ headers: firstWriteHeader() })
    const input = { projectId: PROJECT_ID, intake: intakeRequest({ questions: fixture.questions }) }
    const result = await update.execute(input, ctx)
    const log = await update.buildLog?.({ input, result, ctx, snapshots: {} })
    const serialized = JSON.stringify(log?.snapshotAfter)
    expect(serialized).not.toContain(fixture.questions[0].text)
    expect(serialized).not.toContain(String(fixture.brief.businessGoal))
    expect(log?.snapshotAfter).toMatchObject({ projectId: PROJECT_ID, step: 'scoping', questionCount: fixture.questions.length })
  })

  it('refuses materials that are not attachments of the session scope', async () => {
    const fixture = loadIntakeFixture()
    const error = await catchHttpError(() => runUpdate(intakeRequest({ brief: fixture.brief })).result)
    expectFrozenBody(error, 422, 'attachment_scope_mismatch')
    expect(store.intakes).toHaveLength(0)
  })

  it('hides projects of another organization', async () => {
    const error = await catchHttpError(() => runUpdate(intakeRequest(), { headers: firstWriteHeader(), orgId: FOREIGN_ORG_ID }).result)
    expectFrozenBody(error, 404, 'not_found')
  })
})

describe('delivery_os.intake.import_proposal (F3)', () => {
  const trustedExecution = issueTrustedExecution(ACTOR_ID)

  it('creates the intake, appends the proposal reference and merges questions unanswered', async () => {
    const { ctx } = harness({ headers: firstWriteHeader() })
    const result = await importProposal.execute(proposalInput(), ctx)
    const proposal = loadScopingProposalFixture()

    expect(scopingProposalImportResponseSchema.safeParse(result).success).toBe(true)
    expect(result).toMatchObject({ projectId: PROJECT_ID, manifestId: proposal.manifestId, duplicate: false })
    expect(result.manifestHash).toBe(hashScopingProposal({ ...proposal, projectId: PROJECT_ID }))
    expect(store.intakes).toHaveLength(1)
    const row = store.intakes[0]
    expect(row.importedManifests).toEqual([{ manifestId: proposal.manifestId, manifestHash: result.manifestHash }])
    expect(row.proposals).toEqual([
      expect.objectContaining({ proposalId: proposal.manifestId, kind: 'scope', contentHash: result.manifestHash, status: 'proposed' }),
    ])
    expect((row.questions as Array<{ id: string; answer: unknown }>).map((question) => [question.id, question.answer])).toEqual(
      proposal.questions.map((question) => [question.id, null]),
    )
    expect(result.intakeUpdatedAt).toBe((row.updatedAt as Date).toISOString())
    expect(mockEmitDeliveryOsEvent).not.toHaveBeenCalled()
  })

  it('replays the same manifest without a lock header and without writing', async () => {
    await importProposal.execute(proposalInput(), harness({ headers: firstWriteHeader() }).ctx)
    const { ctx, em } = harness({ headers: {} })
    const replay = await importProposal.execute(proposalInput(), ctx)
    expect(replay.duplicate).toBe(true)
    expect(replay.intakeUpdatedAt).toBe((store.intakes[0].updatedAt as Date).toISOString())
    expect(em.transactional).not.toHaveBeenCalled()
    expect(store.intakes).toHaveLength(1)
  })

  it('answers idempotency_conflict for the same manifest id with other content', async () => {
    await importProposal.execute(proposalInput(), harness({ headers: firstWriteHeader() }).ctx)
    const changed = { ...loadScopingProposalFixture(), projectId: PROJECT_ID, producedBy: { tool: 'other-agent', sessionRef: null } }
    const error = await catchHttpError(() => importProposal.execute(proposalInput({ proposal: changed }), harness({ headers: firstWriteHeader() }).ctx))
    expectFrozenBody(error, 409, 'idempotency_conflict')
    expect(store.intakes[0].importedManifests).toHaveLength(1)
  })

  it('requires the intake lock header for a new manifest over HTTP', async () => {
    const error = await catchHttpError(() => importProposal.execute(proposalInput(), harness({ headers: {} }).ctx))
    expectFrozenBody(error, 428, 'optimistic_lock_required')
    expect(store.intakes).toHaveLength(0)
  })

  it('rejects a proposal that belongs to another project as a shape error', async () => {
    const foreign = { ...loadScopingProposalFixture(), projectId: FOREIGN_ORG_ID }
    const error = await catchHttpError(() => importProposal.execute(proposalInput({ proposal: foreign }), harness({ headers: firstWriteHeader() }).ctx))
    expect(error.status).toBe(422)
    expect(error.body.code).toBe('foreign_reference')
  })

  it('refuses the trusted option over HTTP and a forged object in-process', async () => {
    const overHttp = await catchHttpError(() =>
      importProposal.execute(proposalInput({ trustedExecution }), harness({ headers: firstWriteHeader() }).ctx),
    )
    expectFrozenBody(overHttp, 403, 'forbidden')
    expect(detailCodes(overHttp)).toEqual(['trusted_execution_required'])

    const forged = JSON.parse(JSON.stringify(trustedExecution))
    const inProcess = await catchHttpError(() => importProposal.execute(proposalInput({ trustedExecution: forged }), harness({ inProcess: true }).ctx))
    expectFrozenBody(inProcess, 403, 'forbidden')
    expect(store.intakes).toHaveLength(0)
  })

  it('accepts an issued trusted execution in-process without a lock header and stamps the actor', async () => {
    const { ctx } = harness({ inProcess: true, sub: 'not-a-user' })
    const result = await importProposal.execute(proposalInput({ trustedExecution }), ctx)
    expect(result.duplicate).toBe(false)
    expect(store.intakes[0].createdBy).toBe(ACTOR_ID)
    const log = await importProposal.buildLog?.({ input: proposalInput({ trustedExecution }), result, ctx, snapshots: {} })
    expect(log).toMatchObject({ actorUserId: ACTOR_ID, resourceId: PROJECT_ID })
  })

  it('reopens a submitted intake when the proposal adds a blocking question', async () => {
    store.intakes = [storedIntakeRow()]
    const { ctx } = harness({ headers: lockHeader(UPDATED_AT) })
    await importProposal.execute(proposalInput(), ctx)
    expect(store.intakes[0].step).toBe('review')
  })

  it('refuses a stored platform choice that no longer matches the frozen profile', async () => {
    store.projects = [makeProject()]
    store.intakes = [storedIntakeRow({ step: 'platform' })]
    const error = await catchHttpError(() => importProposal.execute(proposalInput(), harness({ headers: lockHeader(UPDATED_AT) }).ctx))
    expectFlowBody(error, 422, 'target_profile_frozen')
    expect(store.intakes[0].proposals).toEqual([])
  })

  it('answers the replay shape when a concurrent import already landed the manifest under the lock', async () => {
    let raced = false
    mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Row, options?: unknown) => {
      const row = rows(entity).find((candidate) => matches(candidate, where)) ?? null
      if (entity === DeliveryIntake && options !== undefined && row === null && !raced) {
        raced = true
        const { ctx } = harness({ inProcess: true })
        await importProposal.execute(proposalInput(), ctx)
        return rows(entity).find((candidate) => matches(candidate, where)) ?? null
      }
      return row
    })
    const { ctx } = harness({ headers: firstWriteHeader() })
    const result = await importProposal.execute(proposalInput(), ctx)
    expect(result.duplicate).toBe(true)
    expect(store.intakes).toHaveLength(1)
    expect(store.intakes[0].importedManifests).toHaveLength(1)
  })
})
