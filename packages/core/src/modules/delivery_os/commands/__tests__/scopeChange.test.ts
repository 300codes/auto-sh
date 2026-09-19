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
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { DeliveryEvidence, type DeliveryBaseline, type DeliveryProject, type DeliveryTask } from '../../data/entities'
import { taskUpdateSchema } from '../../data/validators'
import { reserveAttempt } from '../../lib/attempts'
import { resolveActiveBaseline, type BaselineDecisionRecord } from '../../lib/baseline'
import { baselineContentV1Schema, type BaselineContentV1, type TaskPackageV1 } from '../../lib/contracts'
import {
  loadBaselineContentFixture,
  loadPlanProposalFixture,
  loadResultManifestFixture,
  loadTaskPackageFixture,
} from '../../lib/fixtures'
import { hashCanonical } from '../../lib/hash'
import { deriveProjectStatus } from '../../lib/projectStatus'
import { buildTraceability } from '../../lib/traceability'
import type { AttemptReserveResult } from '../attempts'
import type { BaselineCommandResult, BaselineImportCommandResult } from '../baselines'
import type { DecisionCommandResult } from '../decisions'
import type { ResultAcceptCommandResult } from '../evidence'
import type { PlanImportCommandResult } from '../planImport'
import {
  catchHttpError,
  detailCodes,
  draftAttachmentRows,
  emptyStore,
  expectFrozenBody,
  getHandler,
  makeApproval,
  makeBaseline,
  makeDraft,
  makeHarness,
  makeProject,
  makeRequirementsProposal,
  matches,
  ORG_ID,
  PROJECT_ID,
  rowsFor as kitRowsFor,
  TENANT_ID,
  UPDATED_AT,
  type Row,
  type Store as KitStore,
} from './baselineTestKit'

type Store = KitStore & { evidence: DeliveryEvidence[] }

const MODULE_ROOT = join(__dirname, '..', '..')
const V2_BASELINE_ID = '5a5a5a5a-5555-4555-8555-5555555555b2'
const V2_TASK_ID = '66666666-6666-4666-8666-6666666666b2'
const IMMUTABLE_SUBJECTS = [
  'baselines',
  'decisions',
  'results',
  'evidence',
  'artifacts',
  'publications',
]
const WRITE_METHODS = ['PUT', 'PATCH', 'DELETE']
const MUTATING_ACTIONS = /(^|[._])(update|delete|remove|edit|archive|replace|patch|override|expire|auto_approve)/

const createBaseline = getHandler<BaselineCommandResult>('delivery_os.baselines.create')
const importRequirements = getHandler<BaselineImportCommandResult>('delivery_os.baselines.import_requirements')
const importPlan = getHandler<PlanImportCommandResult>('delivery_os.tasks.import_plan')
const recordDecision = getHandler<DecisionCommandResult>('delivery_os.decisions.record')
const reserve = getHandler<AttemptReserveResult>('delivery_os.attempts.reserve')
const acceptResult = getHandler<ResultAcceptCommandResult>('delivery_os.results.accept')

let store: Store
let rowCounter = 0

function rowsFor(entity: unknown): Row[] {
  if (entity === DeliveryEvidence) return store.evidence as unknown as Row[]
  return kitRowsFor(store, entity)
}

function nextRowId(): string {
  rowCounter += 1
  return `7c7c7c7c-7777-4777-8777-${String(rowCounter).padStart(12, '0')}`
}

function harness(options: { headers?: Record<string, string>; sub?: string } = {}) {
  const built = makeHarness(store, options)
  built.em.create.mockImplementation((_entity: unknown, data: Row) => ({ id: nextRowId(), createdAt: UPDATED_AT, ...data }))
  built.em.persist.mockImplementation((row: Row) => {
    if ('proposalTaskKey' in row) store.tasks.push(row as unknown as DeliveryTask)
    else if ('contentHash' in row) store.baselines.push(row as unknown as DeliveryBaseline)
    else if ('payloadHash' in row) store.evidence.push(row as unknown as DeliveryEvidence)
    else store.decisions.push(row as unknown as never)
  })
  return built
}

function lockHeaders(updatedAt: Date): Record<string, string> {
  return { [OPTIMISTIC_LOCK_HEADER_NAME]: updatedAt.toISOString() }
}

function projectLock(): Record<string, string> {
  return lockHeaders(store.projects[0].updatedAt)
}

function approve(baseline: DeliveryBaseline, kind: 'requirements' | 'design'): Promise<DecisionCommandResult> {
  const { ctx } = harness({ headers: projectLock() })
  return Promise.resolve(
    recordDecision.execute(
      { baselineId: baseline.id, kind, verdict: 'approved', subjectHash: baseline.contentHash, subjectVersion: baseline.version },
      ctx,
    ),
  )
}

function seedDraftProject(): void {
  const draftSpec = makeDraft()
  store = { ...emptyStore(), evidence: [], projects: [makeProject({ draftSpec })], attachments: draftAttachmentRows(draftSpec) }
}

function scopeChangedContent(): BaselineContentV1 {
  const content = loadBaselineContentFixture()
  return {
    ...content,
    acceptanceCriteria: [
      ...content.acceptanceCriteria,
      { id: 'AC-004', requirementId: content.requirements[0].id, description: 'Each service offers a booking button.' },
    ],
  }
}

function acIdsOf(baseline: DeliveryBaseline): string[] {
  return (baseline.content as BaselineContentV1).acceptanceCriteria.map((criterion) => criterion.id)
}

function makeTask(taskPackage: TaskPackageV1, overrides: Partial<DeliveryTask> = {}): DeliveryTask {
  return {
    id: taskPackage.taskId,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    projectId: taskPackage.projectId,
    baselineId: taskPackage.baselineId,
    title: taskPackage.title,
    description: taskPackage.description ?? null,
    acIds: taskPackage.acceptanceCriteria.map((criterion) => criterion.id),
    dependsOnTaskIds: [],
    allowedPaths: taskPackage.allowedPaths,
    targetProfileId: taskPackage.targetProfileId,
    targetProfileVersion: taskPackage.targetProfileVersion,
    status: 'ready',
    statusReason: null,
    attemptNumber: 0,
    executionAttempts: [],
    createdAt: UPDATED_AT,
    updatedAt: UPDATED_AT,
    deletedAt: null,
    ...overrides,
  } as DeliveryTask
}

function reservedOnPackage(taskPackage: TaskPackageV1) {
  const reserved = reserveAttempt([], {
    idempotencyKey: taskPackage.idempotencyKey,
    payload: { mode: 'manual_handoff', baseRevision: taskPackage.baseRevision },
    mode: 'manual_handoff',
    baselineId: taskPackage.baselineId,
    baselineHash: taskPackage.baselineHash,
    baseRevision: taskPackage.baseRevision,
    now: '2026-09-19T10:00:00.000Z',
    newAttemptId: taskPackage.attemptId,
  })
  if (!reserved.ok) throw new Error('[internal] fixture reservation failed')
  return reserved.attempt
}

type SupersededScenario = { taskPackage: TaskPackageV1; v1: DeliveryBaseline; v2: DeliveryBaseline }

function seedSupersededBaseline(): SupersededScenario {
  const taskPackage = loadTaskPackageFixture('git')
  const project = makeProject({
    id: taskPackage.projectId,
    activeBaselineId: V2_BASELINE_ID,
    repositoryRef: taskPackage.repositoryRef,
  })
  const v1 = makeBaseline(loadBaselineContentFixture(), { id: taskPackage.baselineId, projectId: project.id })
  const v2 = makeBaseline(scopeChangedContent(), { id: V2_BASELINE_ID, projectId: project.id, version: 2 })
  store = {
    ...emptyStore(),
    evidence: [],
    projects: [project],
    baselines: [v1, v2],
    decisions: [
      makeApproval(v1, 'requirements'),
      makeApproval(v1, 'design'),
      makeApproval(v2, 'requirements'),
      makeApproval(v2, 'design'),
    ],
  }
  return { taskPackage, v1, v2 }
}

function listFiles(directory: string, accept: (path: string) => boolean): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : listFiles(path, accept)
    return accept(path) ? [path] : []
  })
}

function exportedMethods(source: string): Set<string> {
  const methods = new Set<string>()
  const declared = /export\s+(?:async\s+)?(?:function|const|let|var)\s+(GET|POST|PUT|PATCH|DELETE)\b/g
  for (const match of source.matchAll(declared)) methods.add(match[1])
  const listed = /export\s+(?:const\s+)?\{([^}]*)\}/g
  for (const match of source.matchAll(listed)) {
    for (const specifier of match[1].split(',')) {
      const exportedName = specifier.trim().split(/\s+as\s+/).pop()?.trim().split(/[\s:=]/)[0]
      if (exportedName && ['GET', 'POST', ...WRITE_METHODS].includes(exportedName)) methods.add(exportedName)
    }
  }
  return methods
}

function routeMethods(): Map<string, Set<string>> {
  const apiRoot = join(MODULE_ROOT, 'api')
  const routes = listFiles(apiRoot, (path) => path.endsWith(`${sep}route.ts`))
  return new Map(routes.map((path) => [relative(apiRoot, path).split(sep).join('/'), exportedMethods(readFileSync(path, 'utf8'))]))
}

beforeEach(() => {
  rowCounter = 0
  mockEmitDeliveryOsEvent.mockClear()
  mockFindOneWithDecryption.mockReset()
  mockFindWithDecryption.mockReset()
  mockFindOneWithDecryption.mockImplementation(
    async (_em: unknown, entity: unknown, where: Row) => rowsFor(entity).find((row) => matches(row, where)) ?? null,
  )
  mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Row) =>
    rowsFor(entity).filter((row) => matches(row, where)),
  )
})

describe('(1) baselines, decisions and evidence are append-only', () => {
  it('registers exactly the known delivery_os commands and none that updates or deletes an append-only record', () => {
    const ids = commandRegistry
      .list()
      .filter((id) => id.startsWith('delivery_os.'))
      .sort()
    expect(ids).toEqual([
      'delivery_os.attempts.cancel',
      'delivery_os.attempts.claim',
      'delivery_os.attempts.link_workflow',
      'delivery_os.attempts.mark_delivery',
      'delivery_os.attempts.reconcile',
      'delivery_os.attempts.reserve',
      'delivery_os.baselines.create',
      'delivery_os.baselines.import_requirements',
      'delivery_os.decisions.record',
      'delivery_os.evidence.record',
      'delivery_os.flow.link_instance',
      'delivery_os.flow.pin',
      'delivery_os.intake.import_proposal',
      'delivery_os.intake.update',
      'delivery_os.projects.create',
      'delivery_os.projects.delete',
      'delivery_os.projects.update',
      'delivery_os.publications.record',
      'delivery_os.results.accept',
      'delivery_os.stages.create_artifact',
      'delivery_os.stages.decide',
      'delivery_os.tasks.create',
      'delivery_os.tasks.delete',
      'delivery_os.tasks.import_plan',
      'delivery_os.tasks.update',
    ])
    const appendOnly = ids.filter((id) => IMMUTABLE_SUBJECTS.includes(id.split('.')[1]))
    expect(appendOnly).toEqual([
      'delivery_os.baselines.create',
      'delivery_os.baselines.import_requirements',
      'delivery_os.decisions.record',
      'delivery_os.evidence.record',
      'delivery_os.publications.record',
      'delivery_os.results.accept',
    ])
    expect(appendOnly.filter((id) => MUTATING_ACTIONS.test(id.slice('delivery_os.'.length)))).toEqual([])
    expect(appendOnly.filter((id) => commandRegistry.get(id)?.undo)).toEqual([])
  })

  it('exposes no PUT, PATCH or DELETE on any baseline, decision, result, evidence, publication or stage artifact route', () => {
    const routes = routeMethods()
    const appendOnlyRoutes = [...routes.keys()].filter((path) => IMMUTABLE_SUBJECTS.some((subject) => path.split('/').includes(subject)))
    expect(appendOnlyRoutes.sort()).toEqual([
      'baselines/[id]/decisions/route.ts',
      'projects/[id]/baselines/route.ts',
      'projects/[id]/evidence/route.ts',
      'projects/[id]/publications/route.ts',
      'projects/[id]/stages/[stageId]/artifacts/route.ts',
      'projects/[id]/stages/[stageId]/decisions/route.ts',
      'tasks/[id]/results/route.ts',
    ])
    for (const path of appendOnlyRoutes) {
      const methods = routes.get(path) ?? new Set<string>()
      expect({ path, writes: [...methods].filter((method) => WRITE_METHODS.includes(method)) }).toEqual({ path, writes: [] })
      expect(methods.has('POST')).toBe(true)
    }
  })

  it('keeps the internal attempt commands off every route and off the workflow-safe command list', () => {
    const internalIds = [
      'delivery_os.attempts.claim',
      'delivery_os.attempts.link_workflow',
      'delivery_os.attempts.mark_delivery',
      'delivery_os.flow.link_instance',
    ]
    const owners = [join('commands', 'attempts.ts'), join('commands', 'flow.ts')]
    const sources = listFiles(MODULE_ROOT, (path) => /\.tsx?$/.test(path))
    for (const owner of owners) expect(sources.some((path) => path.endsWith(owner))).toBe(true)
    const callers = sources.filter((path) => {
      if (owners.some((owner) => path.endsWith(owner))) return false
      const source = readFileSync(path, 'utf8')
      return internalIds.some((id) => source.includes(id))
    })
    expect(callers).toEqual([])
    expect(sources.filter((path) => readFileSync(path, 'utf8').includes('registerWorkflowSafeCommands'))).toEqual([])
  })

  it('has no method-folder routes that could bypass the route scan', () => {
    const methodFolders = listFiles(join(MODULE_ROOT, 'api'), (path) => path.endsWith('.ts'))
      .map((path) => relative(join(MODULE_ROOT, 'api'), path).split(sep))
      .filter((segments) => ['get', 'post', 'put', 'patch', 'delete'].includes(segments[0]))
    expect(methodFolders).toEqual([])
  })

  it('sees brace-exported update methods, so the route scan cannot pass vacuously', () => {
    const routes = routeMethods()
    expect([...(routes.get('tasks/route.ts') ?? [])]).toEqual(expect.arrayContaining(['PUT', 'DELETE']))
    expect([...(routes.get('projects/route.ts') ?? [])]).toEqual(expect.arrayContaining(['POST', 'PUT', 'DELETE', 'GET']))
    expect(exportedMethods('const handler = 1\nexport { handler as DELETE }')).toEqual(new Set(['DELETE']))
  })
})

describe('(2) a scope change after approval creates version n+1 and leaves old tasks pinned', () => {
  it('freezes v2 next to the approved v1 without touching v1, its decisions or the tasks pinned to it', async () => {
    seedDraftProject()
    const first = await createBaseline.execute({ projectId: PROJECT_ID, source: 'manual' }, harness({ headers: projectLock() }).ctx)
    const v1 = store.baselines[0]
    await approve(v1, 'requirements')
    const approved = await approve(v1, 'design')
    expect(approved.activeBaselineId).toBe(first.baselineId)
    store.tasks.push({ id: 'task-on-v1', projectId: PROJECT_ID, baselineId: v1.id, status: 'verified' } as unknown as DeliveryTask)
    const v1Snapshot = structuredClone(v1)
    const decisionsSnapshot = structuredClone(store.decisions)

    const draft = makeDraft({ acceptanceCriteria: scopeChangedContent().acceptanceCriteria })
    store.projects[0].draftSpec = draft
    const second = await createBaseline.execute({ projectId: PROJECT_ID, source: 'manual' }, harness({ headers: projectLock() }).ctx)

    expect(second).toMatchObject({ version: 2, duplicate: false })
    expect(second.baselineId).not.toBe(first.baselineId)
    expect(second.contentHash).not.toBe(first.contentHash)
    expect(store.baselines).toHaveLength(2)
    expect(store.baselines[0]).toEqual(v1Snapshot)
    expect(store.decisions).toEqual(decisionsSnapshot)
    expect(store.projects[0].activeBaselineId).toBe(v1.id)
    expect(store.tasks[0].baselineId).toBe(v1.id)

    const v2 = store.baselines[1]
    const halfApproved = await approve(v2, 'requirements')
    expect(halfApproved).toMatchObject({ activeBaselineId: v1.id, activeBaselineChanged: false })
    const switched = await approve(v2, 'design')
    expect(switched).toMatchObject({ activeBaselineId: v2.id, activeBaselineChanged: true })
    expect(store.baselines[0]).toEqual(v1Snapshot)
    expect(store.decisions.slice(0, decisionsSnapshot.length)).toEqual(decisionsSnapshot)
    expect(store.tasks[0].baselineId).toBe(v1.id)
  })

  it('offers no way to re-pin an existing task to another baseline', () => {
    const parsed = taskUpdateSchema.parse({ id: V2_TASK_ID, baselineId: V2_BASELINE_ID, title: 'Moved' })
    expect(parsed).not.toHaveProperty('baselineId')
    expect(parsed).toMatchObject({ id: V2_TASK_ID, title: 'Moved' })
  })
})

describe('(3) a late result of the old baseline never credits the new one', () => {
  it('rejects the result relabelled for the new baseline and stores the real one as evidence of the old baseline only', async () => {
    const { taskPackage, v1, v2 } = seedSupersededBaseline()
    store.tasks = [makeTask(taskPackage, { status: 'executing', attemptNumber: 1, executionAttempts: [reservedOnPackage(taskPackage)] })]
    const manifest = loadResultManifestFixture('git')

    const relabelled = await catchHttpError(() =>
      acceptResult.execute(
        {
          taskId: taskPackage.taskId,
          attemptId: taskPackage.attemptId,
          source: 'manual',
          manifest: { ...manifest, baselineId: v2.id, baselineHash: v2.contentHash },
        },
        harness().ctx,
      ),
    )
    expectFrozenBody(relabelled, 422, 'baseline_mismatch')
    expect(detailCodes(relabelled)).toEqual(['baseline_mismatch', 'baseline_mismatch'])
    expect(store.evidence).toHaveLength(0)

    const accepted = await acceptResult.execute(
      { taskId: taskPackage.taskId, attemptId: taskPackage.attemptId, source: 'manual', manifest },
      harness().ctx,
    )
    expect(accepted).toMatchObject({ duplicate: false, taskStatus: 'awaiting_review' })
    expect(store.evidence).toHaveLength(1)
    expect(store.evidence[0]).toMatchObject({ id: accepted.evidenceId, baselineId: v1.id, kind: 'result_manifest' })
    expect(store.tasks[0].baselineId).toBe(v1.id)
    expect(store.projects[0].activeBaselineId).toBe(v2.id)
  })

  it('keeps the old evidence out of the traceability and progress of the active baseline', async () => {
    const { taskPackage, v1, v2 } = seedSupersededBaseline()
    store.tasks = [makeTask(taskPackage, { status: 'executing', attemptNumber: 1, executionAttempts: [reservedOnPackage(taskPackage)] })]
    await acceptResult.execute(
      { taskId: taskPackage.taskId, attemptId: taskPackage.attemptId, source: 'manual', manifest: loadResultManifestFixture('git') },
      harness().ctx,
    )
    const verifiedOldTask = { ...store.tasks[0], status: 'verified' as const }
    const evidence = store.evidence.map((item) => ({
      id: item.id,
      projectId: item.projectId,
      baselineId: item.baselineId,
      taskId: item.taskId ?? null,
      kind: item.kind,
      sourceRevision: item.sourceRevision ?? null,
      rawReportHash: item.rawReportHash ?? null,
      createdAt: UPDATED_AT,
    }))
    const traceFor = (baseline: DeliveryBaseline) =>
      buildTraceability({
        projectId: baseline.projectId,
        baseline: {
          id: baseline.id,
          projectId: baseline.projectId,
          requirements: (baseline.content as BaselineContentV1).requirements,
          acceptanceCriteria: (baseline.content as BaselineContentV1).acceptanceCriteria,
        },
        tasks: [verifiedOldTask],
        evidence,
        limit: 1000,
      })

    const activeTrace = traceFor(v2)
    expect(activeTrace.baselineId).toBe(v2.id)
    expect(activeTrace.rows.filter((row) => row.evidenceId !== null || row.taskId !== null)).toEqual([])
    expect(activeTrace.rows.map((row) => row.acId)).toEqual(expect.arrayContaining(['AC-004']))
    expect(traceFor(v1).rows.filter((row) => row.evidenceId === evidence[0].id).length).toBeGreaterThan(0)

    const newTask = { ...verifiedOldTask, id: V2_TASK_ID, baselineId: v2.id, status: 'ready' as const }
    const mislabelled = { ...evidence[0], id: 'evidence-of-v1-naming-v2-task', taskId: V2_TASK_ID }
    const mixedTrace = buildTraceability({
      projectId: v2.projectId,
      baseline: {
        id: v2.id,
        projectId: v2.projectId,
        requirements: (v2.content as BaselineContentV1).requirements,
        acceptanceCriteria: (v2.content as BaselineContentV1).acceptanceCriteria,
      },
      tasks: [verifiedOldTask, newTask],
      evidence: [...evidence, mislabelled],
      limit: 1000,
    })
    expect(mixedTrace.rows.some((row) => row.taskId === V2_TASK_ID)).toBe(true)
    expect(mixedTrace.rows.filter((row) => row.evidenceId !== null)).toEqual([])

    const statusWithActive = (activeBaselineId: string) =>
      deriveProjectStatus({
        project: { deletedAt: null, activeBaselineId },
        baselines: [v1, v2].map((baseline) => ({ id: baseline.id, acIds: acIdsOf(baseline) })),
        tasks: [verifiedOldTask],
        evidence,
        decisions: [],
      })
    const active = statusWithActive(v2.id)
    expect(active.progress).toEqual({ proven: 0, total: acIdsOf(v2).length, unit: 'ac', percent: 0 })
    expect(active.status).toBe('planning')
    expect(active.taskCounts.verified).toBe(0)
    expect(statusWithActive(v1.id).progress.proven).toBe(verifiedOldTask.acIds.length)
  })
})

describe('(4) reserve on a task pinned to a superseded baseline is refused', () => {
  it('answers 422 baseline_not_active, writes nothing, and still reserves a task pinned to the active baseline', async () => {
    const { taskPackage, v2 } = seedSupersededBaseline()
    const oldTask = makeTask(taskPackage)
    const newTask = makeTask(taskPackage, { id: V2_TASK_ID, baselineId: v2.id })
    store.tasks = [oldTask, newTask]
    const body = (taskId: string, key: string) => ({
      taskId,
      idempotencyKey: key,
      mode: 'manual_handoff',
      baseRevision: taskPackage.baseRevision,
    })

    const { ctx } = harness({ headers: lockHeaders(oldTask.updatedAt) })
    const refused = await catchHttpError(() => reserve.execute(body(oldTask.id, 'scope-key-old'), ctx))
    expectFrozenBody(refused, 422, 'baseline_not_active')
    expect(detailCodes(refused)).toEqual(['baseline_not_active'])
    expect(oldTask).toMatchObject({ status: 'ready', attemptNumber: 0, executionAttempts: [] })
    expect(oldTask.updatedAt).toBe(UPDATED_AT)
    expect(mockEmitDeliveryOsEvent).not.toHaveBeenCalled()

    const reserved = await reserve.execute(body(newTask.id, 'scope-key-new'), harness({ headers: lockHeaders(newTask.updatedAt) }).ctx)
    expect(reserved).toMatchObject({ created: true, taskId: V2_TASK_ID, baselineId: v2.id, baselineHash: v2.contentHash })
  })
})

describe('(5) decisions bind to one hash and version and never approve by themselves', () => {
  function seedTwoVersions(): { v1: DeliveryBaseline; v2: DeliveryBaseline } {
    const v1 = makeBaseline()
    const v2 = makeBaseline(scopeChangedContent(), { id: V2_BASELINE_ID, version: 2 })
    store = {
      ...emptyStore(),
      evidence: [],
      projects: [makeProject({ activeBaselineId: v1.id })],
      baselines: [v1, v2],
      decisions: [makeApproval(v1, 'requirements'), makeApproval(v1, 'design')],
    }
    return { v1, v2 }
  }

  it('refuses to approve v2 with the hash or version of v1 and keeps v1 active', async () => {
    const { v1, v2 } = seedTwoVersions()
    const attempts = [
      { subjectHash: v1.contentHash, subjectVersion: v1.version, detail: ['subject_hash_mismatch', 'subject_version_mismatch'] },
      { subjectHash: v1.contentHash, subjectVersion: v2.version, detail: ['subject_hash_mismatch'] },
      { subjectHash: v2.contentHash, subjectVersion: v1.version, detail: ['subject_version_mismatch'] },
    ]
    for (const attempt of attempts) {
      const { ctx } = harness({ headers: projectLock() })
      const error = await catchHttpError(() =>
        recordDecision.execute(
          { baselineId: v2.id, kind: 'requirements', verdict: 'approved', subjectHash: attempt.subjectHash, subjectVersion: attempt.subjectVersion },
          ctx,
        ),
      )
      expectFrozenBody(error, 409, 'subject_hash_mismatch')
      expect(detailCodes(error)).toEqual(attempt.detail)
    }
    expect(store.decisions).toHaveLength(2)
    expect(store.projects[0].activeBaselineId).toBe(v1.id)

    await approve(v2, 'requirements')
    const result = await approve(v2, 'design')
    expect(result).toMatchObject({ activeBaselineId: v2.id, activeBaselineChanged: true })
  })

  it('lets the second of two contradictory decisions on the same hash lose with 409', async () => {
    const { v2 } = seedTwoVersions()
    const sharedHeaders = projectLock()
    const decision = (verdict: 'approved' | 'rejected') => ({
      baselineId: v2.id,
      kind: 'design',
      verdict,
      subjectHash: v2.contentHash,
      subjectVersion: v2.version,
      ...(verdict === 'rejected' ? { reason: 'The booking button is missing on mobile' } : {}),
    })
    await recordDecision.execute(decision('approved'), harness({ headers: sharedHeaders }).ctx)
    const error = await catchHttpError(() => recordDecision.execute(decision('rejected'), harness({ headers: sharedHeaders }).ctx))
    expect(error.status).toBe(409)
    expect(error.body.code).toBe('optimistic_lock_conflict')
    expect(store.decisions.filter((row) => row.subjectId === v2.id).map((row) => row.verdict)).toEqual(['approved'])
  })

  it('has no approval path without a signed-in human and none that fires after a timeout', async () => {
    const { v2 } = seedTwoVersions()
    const { ctx } = harness({ headers: projectLock(), sub: 'system-timer' })
    const noActor = await catchHttpError(() =>
      recordDecision.execute(
        { baselineId: v2.id, kind: 'requirements', verdict: 'approved', subjectHash: v2.contentHash, subjectVersion: v2.version },
        ctx,
      ),
    )
    expectFrozenBody(noActor, 403, 'forbidden')
    expect(detailCodes(noActor)).toEqual(['actor_required'])

    const writers = listFiles(MODULE_ROOT, (path) => path.endsWith('.ts'))
      .filter((path) =>
        /\b(create|insert|insertMany|nativeInsert|upsert|upsertMany)\(\s*DeliveryDecision\b|new DeliveryDecision\(/.test(
          readFileSync(path, 'utf8'),
        ),
      )
      .map((path) => relative(MODULE_ROOT, path).split(sep).join('/'))
    expect(writers).toEqual(['commands/decisions.ts'])
    const pointerWriters = listFiles(MODULE_ROOT, (path) => path.endsWith('.ts'))
      .filter((path) => /\bactiveBaselineId\s*=[^=]/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(MODULE_ROOT, path).split(sep).join('/'))
    expect(pointerWriters).toEqual(['commands/decisions.ts'])

    const requirementsOnly: BaselineDecisionRecord[] = [
      {
        kind: 'requirements',
        verdict: 'approved',
        subjectHash: v2.contentHash,
        subjectVersion: v2.version,
        decidedAt: new Date('2026-09-19T09:00:00.000Z'),
      },
    ]
    jest.useFakeTimers().setSystemTime(new Date('2027-09-19T09:00:00.000Z'))
    try {
      expect(resolveActiveBaseline(requirementsOnly, v2)).toBe(false)
      expect(
        resolveActiveBaseline([...requirementsOnly, { ...requirementsOnly[0], kind: 'design' }], v2),
      ).toBe(true)
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('(6) every input produces content of the one baseline schema', () => {
  function expectBaselineSchema(baseline: DeliveryBaseline): string[] {
    const parsed = baselineContentV1Schema.safeParse(baseline.content)
    expect(parsed.success).toBe(true)
    expect(baseline.contentHash).toBe(hashCanonical(baseline.content))
    return Object.keys(baseline.content as Row)
      .filter((key) => key !== 'importedManifests')
      .sort()
  }

  it('freezes the manual draft, the requirements proposal and the plan proposal into baselineContentV1', async () => {
    seedDraftProject()
    const manual = await createBaseline.execute({ projectId: PROJECT_ID, source: 'manual' }, harness({ headers: projectLock() }).ctx)
    const manualRow = store.baselines.find((row) => row.id === manual.baselineId) as DeliveryBaseline
    expect(manualRow.source).toBe('manual')

    seedDraftProject()
    const requirements = await importRequirements.execute(
      { projectId: PROJECT_ID, source: 'requirements_proposal', manifest: makeRequirementsProposal() },
      harness({ headers: projectLock() }).ctx,
    )
    const requirementsRow = store.baselines.find((row) => row.id === requirements.baselineId) as DeliveryBaseline
    expect(requirementsRow.source).toBe('requirements_proposal')
    await approve(requirementsRow, 'requirements')
    await approve(requirementsRow, 'design')
    expect(store.projects[0].activeBaselineId).toBe(requirementsRow.id)

    const plan = await importPlan.execute(
      {
        projectId: PROJECT_ID,
        source: 'plan_proposal',
        manifest: {
          ...loadPlanProposalFixture(),
          projectId: PROJECT_ID,
          baselineId: requirementsRow.id,
          baselineHash: requirementsRow.contentHash,
        },
      },
      harness({ headers: projectLock() }).ctx,
    )
    const planRow = store.baselines.find((row) => row.id === plan.baselineId) as DeliveryBaseline
    expect(planRow).toMatchObject({ source: 'plan_proposal', parentBaselineId: requirementsRow.id, version: 2 })
    expect(store.tasks).toHaveLength(loadPlanProposalFixture().tasks.length)
    expect(store.tasks.every((task) => task.baselineId === planRow.id)).toBe(true)

    const keySets = [manualRow, requirementsRow, planRow].map(expectBaselineSchema)
    expect(keySets[1]).toEqual(keySets[0])
    expect(keySets[2]).toEqual(keySets[0])
  })
})
