/** @jest-environment node */

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback?: string) => fallback ?? _key }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => require('../../api/__tests__/routeTestKit').findMock)
jest.mock('@open-mercato/shared/lib/di/container', () => require('../../api/__tests__/routeTestKit').containerMock)
jest.mock('@open-mercato/shared/lib/auth/server', () => require('../../api/__tests__/routeTestKit').authServerMock)
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => require('../../api/__tests__/routeTestKit').organizationScopeMock)
jest.mock('../../events', () => ({ emitDeliveryOsEvent: jest.fn(async () => undefined) }))

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import '@open-mercato/core/modules/delivery_os/commands'
import { POST as CREATE_PROJECT, PUT as UPDATE_PROJECT } from '../../api/projects/route'
import { GET as PROJECT_DETAIL } from '../../api/projects/[id]/route'
import { POST as CREATE_BASELINE } from '../../api/projects/[id]/baselines/route'
import { POST as DECIDE } from '../../api/baselines/[id]/decisions/route'
import { POST as CREATE_TASK } from '../../api/projects/[id]/tasks/route'
import { PUT as UPDATE_TASK } from '../../api/tasks/route'
import { POST as RESERVE } from '../../api/tasks/[id]/attempts/route'
import { GET as PACKAGE } from '../../api/tasks/[id]/package/route'
import { POST as IMPORT_RESULT } from '../../api/tasks/[id]/results/route'
import { POST as RECORD_EVIDENCE } from '../../api/projects/[id]/evidence/route'
import { POST as DEPLOY } from '../../api/projects/[id]/deploy-decisions/route'
import { POST as RELEASE } from '../../api/projects/[id]/release-decisions/route'
import { apiRequest, em, readBody, resetRouteState, routeParams, routeState } from '../../api/__tests__/routeTestKit'
import { draftAttachmentRows, makeDraft } from './baselineTestKit'
import { formatRevisionRef } from '../reportQueries'
import { DeliveryBaseline, DeliveryDecision, DeliveryEvidence } from '../../data/entities'
import { buildResultManifest } from '../../lib/fixtures/builders'
import { TARGET_PROFILES } from '../../lib/targetProfiles'
import type { TaskPackageV1 } from '../../lib/contracts'

type Json = Record<string, unknown>
type Row = Record<string, unknown>

const MODULE_ROOT = join(__dirname, '..', '..')
const HISTORY_ENTITIES = [
  'DeliveryBaseline',
  'DeliveryEvidence',
  'DeliveryDecision',
  'DeliveryFlowStageArtifact',
  'DeliveryFlowStageDecision',
]
const FORBIDDEN_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'em.remove / removeAndFlush / nativeDelete', pattern: /\.remove\(|removeAndFlush|nativeDelete/ },
  { label: 'command undo handler', pattern: /\bundo\s*[:(]/ },
  { label: 'em.assign / Object.assign on a row', pattern: /\bassign\(/ },
  { label: 'nativeUpdate on a history entity', pattern: new RegExp(`nativeUpdate\\(\\s*(${HISTORY_ENTITIES.join('|')})`) },
  { label: 'property assignment on a baseline/evidence/decision variable', pattern: /\b[A-Za-z]*(?:aseline|vidence|ecision)[A-Za-z]*\.[A-Za-z]+\s*(?:=|\+=|\|\|=|\?\?=)[^=>]/ },
]

function listSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (name === '__tests__') return []
    if (statSync(path).isDirectory()) return listSources(path)
    return name.endsWith('.ts') ? [path] : []
  })
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function findViolations(sources: Record<string, string>): string[] {
  return Object.entries(sources).flatMap(([file, source]) =>
    stripComments(source)
      .split('\n')
      .flatMap((line, index) =>
        FORBIDDEN_PATTERNS.filter(({ pattern }) => pattern.test(line)).map(({ label }) => `${file}:${index + 1} ${label}`),
      ),
  )
}

function readSources(subdir: string): Record<string, string> {
  return Object.fromEntries(listSources(join(MODULE_ROOT, subdir)).map((path) => [relative(MODULE_ROOT, path), readFileSync(path, 'utf8')]))
}

describe('delivery_os append-only history (OSS-06 6.3) — static scan', () => {
  const commandSources = readSources('commands')
  const routeSources = readSources('api')

  it('scans the registered commands and every route file', () => {
    const registered = readFileSync(join(MODULE_ROOT, 'commands', 'index.ts'), 'utf8').match(/import '\.\/(\w+)'/g) ?? []
    expect(registered.length).toBeGreaterThan(0)
    for (const statement of registered) {
      const name = statement.replace(/import '\.\/|'/g, '')
      expect(Object.keys(commandSources)).toContain(join('commands', `${name}.ts`))
    }
    expect(Object.keys(routeSources).filter((file) => file.endsWith('route.ts')).length).toBeGreaterThanOrEqual(16)
  })

  it('finds no update, delete or undo path over baselines, evidence or decisions', () => {
    const sources = { ...commandSources, ...routeSources }
    const violations = findViolations(
      Object.fromEntries(Object.entries(sources).map(([file, source]) => [file, source.replace(/searchParams\.delete\(/g, 'searchParams.discard(')])),
    )
    expect(violations).toEqual([])
  })

  it('would flag an update, delete or undo path if one were added', () => {
    const negatives = [
      'baseline.contentHash = other',
      'evidence.payload = {}',
      'decision.verdict = "rejected"',
      'tx.remove(evidence)',
      'await tx.nativeDelete(DeliveryDecision, { id })',
      'await tx.nativeUpdate(DeliveryBaseline, { id }, { content })',
      'em.assign(decision, patch)',
      'undo: async () => undefined,',
    ]
    for (const line of negatives) {
      expect(findViolations({ 'synthetic.ts': line })).not.toEqual([])
    }
    expect(findViolations({ 'synthetic.ts': '// baseline.contentHash = other\ntx.create(DeliveryBaseline, data)' })).toEqual([])
  })
})

const BASE_REVISION = { kind: 'git', commitSha: '687670c20c93d6a60c2ab494419ec38636cf0a8c' }
const draft = makeDraft()
const allAcIds = (draft.acceptanceCriteria as Array<{ id: string }>).map((criterion) => criterion.id)
let clock = Date.parse('2026-09-19T08:00:00.000Z')

function historyRows(): Row[] {
  const { baselines, evidence, decisions } = routeState.store
  return [...baselines, ...evidence, ...decisions]
}

const seen = new Map<string, string>()

function assertHistoryUntouched(): void {
  for (const row of historyRows()) {
    const id = row.id as string
    const now = JSON.stringify(row)
    const before = seen.get(id)
    if (before !== undefined) expect(now).toBe(before)
    seen.set(id, now)
  }
}

async function step(response: Response, status: number): Promise<Json> {
  const body = await readBody(response)
  if (response.status !== status) expect({ status: response.status, body }).toEqual({ status })
  clock += 1000
  jest.setSystemTime(clock)
  assertHistoryUntouched()
  return body
}

async function projectVersion(projectId: string): Promise<string> {
  const body = await step(await PROJECT_DETAIL(apiRequest('GET', `/projects/${projectId}`), routeParams(projectId)), 200)
  return body.updatedAt as string
}

function taskVersion(taskId: string): string {
  const task = routeState.store.tasks.find((row) => row.id === taskId)
  if (!task) throw new Error(`[internal] task ${taskId} is not in the route store`)
  return (task.updatedAt as Date).toISOString()
}

const removalSpies = {
  remove: jest.fn(),
  removeAndFlush: jest.fn(),
  nativeDelete: jest.fn(),
  assign: jest.fn(),
}

beforeAll(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'queueMicrotask'] })
  jest.setSystemTime(clock)
  Object.assign(em, removalSpies)
})

afterAll(() => {
  jest.useRealTimers()
  for (const name of Object.keys(removalSpies)) delete (em as Row)[name]
})

beforeEach(() => {
  resetRouteState()
  seen.clear()
  for (const spy of Object.values(removalSpies)) spy.mockClear()
})

describe('delivery_os append-only history (OSS-06 6.3) — full publication flow', () => {
  it('never removes or rewrites a baseline, evidence or decision row, and never natively updates them', async () => {
    const created = await step(
      await CREATE_PROJECT(apiRequest('POST', '/projects', { body: { name: 'Customer portal', inputMode: 'from_brief', targetProfileId: TARGET_PROFILES[0].id } })),
      201,
    )
    const projectId = created.id as string
    routeState.store.attachments.push(...draftAttachmentRows(draft))
    await step(await UPDATE_PROJECT(apiRequest('PUT', '/projects', { body: { id: projectId, draftSpec: draft }, lock: created.updatedAt as string })), 200)
    const baseline = await step(
      await CREATE_BASELINE(apiRequest('POST', `/projects/${projectId}/baselines`, { body: { source: 'manual' }, lock: await projectVersion(projectId) }), routeParams(projectId)),
      201,
    )
    const baselineId = baseline.baselineId as string
    for (const kind of ['requirements', 'design']) {
      const body = { kind, verdict: 'approved', subjectHash: baseline.contentHash, subjectVersion: baseline.version }
      await step(await DECIDE(apiRequest('POST', `/baselines/${baselineId}/decisions`, { body, lock: await projectVersion(projectId) }), routeParams(baselineId)), 201)
    }
    const task = await step(
      await CREATE_TASK(apiRequest('POST', `/projects/${projectId}/tasks`, { body: { source: 'manual', baselineId, title: 'Service catalogue', acIds: allAcIds } }), routeParams(projectId)),
      201,
    )
    const taskId = task.id as string
    await step(await UPDATE_TASK(apiRequest('PUT', '/tasks', { body: { id: taskId, status: 'ready' }, lock: task.updatedAt as string })), 200)

    const reserved = await step(
      await RESERVE(
        apiRequest('POST', `/tasks/${taskId}/attempts`, {
          body: { mode: 'manual_handoff', baseRevision: BASE_REVISION },
          lock: taskVersion(taskId),
          headers: { 'Idempotency-Key': 'append-only-a' },
        }),
        routeParams(taskId),
      ),
      201,
    )
    const attemptId = reserved.attemptId as string
    const exported = await PACKAGE(apiRequest('GET', `/tasks/${taskId}/package?attemptId=${attemptId}`), routeParams(taskId))
    const manifest = buildResultManifest((await exported.json()) as TaskPackageV1)
    await step(await IMPORT_RESULT(apiRequest('POST', `/tasks/${taskId}/results`, { body: { attemptId, manifest } }), routeParams(taskId)), 201)
    const duplicate = await step(await IMPORT_RESULT(apiRequest('POST', `/tasks/${taskId}/results`, { body: { attemptId, manifest } }), routeParams(taskId)), 200)
    expect(duplicate.duplicate).toBe(true)

    const revision = manifest.resultRevision
    const record = (body: Json) =>
      RECORD_EVIDENCE(apiRequest('POST', `/projects/${projectId}/evidence`, { body: { baselineId, ...body } }), routeParams(projectId))
    const reviewPayload = { summary: 'Checked', findings: [], verdict: 'approved', manualCheckId: 'MC-visual-001', reviewer: { kind: 'human' } }
    await step(await record({ kind: 'review', taskId, sourceRevision: revision, payload: reviewPayload }), 201)
    await step(await record({ kind: 'review', taskId, sourceRevision: revision, payload: reviewPayload }), 200)
    const buildId = `build-${formatRevisionRef(revision).slice(4, 12)}`
    const deployment = await step(
      await record({
        kind: 'deployment',
        sourceRevision: revision,
        payload: {
          url: 'https://preview.example.test',
          environment: 'preview',
          buildId,
          deployedAt: new Date(clock).toISOString(),
          uploadStatus: 'succeeded',
          verification: { status: 'verified', checkedAt: new Date(clock).toISOString(), method: 'http-probe', observedBuildId: buildId },
        },
      }),
      201,
    )
    await step(
      await DEPLOY(
        apiRequest('POST', `/projects/${projectId}/deploy-decisions`, { body: { baselineId, sourceRevision: revision, verdict: 'approved' }, lock: await projectVersion(projectId) }),
        routeParams(projectId),
      ),
      201,
    )
    await step(
      await RELEASE(
        apiRequest('POST', `/projects/${projectId}/release-decisions`, { body: { deploymentEvidenceId: deployment.evidenceId, verdict: 'approved' }, lock: await projectVersion(projectId) }),
        routeParams(projectId),
      ),
      201,
    )

    expect(routeState.store.baselines.length).toBe(1)
    expect(routeState.store.decisions.map((row) => row.kind).sort()).toEqual(['deploy', 'design', 'release', 'requirements'])
    expect(routeState.store.evidence.length).toBeGreaterThanOrEqual(3)
    for (const spy of Object.values(removalSpies)) expect(spy).not.toHaveBeenCalled()
    const nativeUpdateTargets = (em.nativeUpdate.mock.calls as unknown[][]).map((call) => call[0])
    for (const entity of [DeliveryBaseline, DeliveryEvidence, DeliveryDecision]) expect(nativeUpdateTargets).not.toContain(entity)
  })
})
