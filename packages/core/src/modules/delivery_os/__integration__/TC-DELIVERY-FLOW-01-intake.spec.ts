import { randomUUID } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import type { IntakeQuestion, IntakeStep } from '../lib/contracts'
import {
  API,
  PROFILE,
  caller,
  cleanupRegistry,
  createProject,
  createRegistry,
  createSiblingOrgUser,
  expectError,
  expectNothingLeft,
  intakeFixture,
  projectVersion,
  scopingProposalFixture,
  sql,
  type Call,
  type CallResult,
  type Json,
} from './flowSpecKit'

/**
 * TC-DELIVERY-FLOW-01: F1 intake (brief wizard autosave + scoping proposal import) against the real database.
 *
 * The jest route tests cover the same handlers over an in-memory store; this spec proves what only Postgres can: the
 * empty default before the first write leaves no `delivery_intakes` row, the intake version is independent of the
 * project version (a concurrent project rename does not invalidate the intake lock, a stale intake lock still
 * conflicts), the proposal import is idempotent by (manifestId, hash) on the stored row, and the organisation scope
 * filter hides the owner's intake from a sibling organisation. Rows are hard-deleted by project id in teardown.
 */

const registry = createRegistry()

function draft(step: IntakeStep, overrides: Json = {}): Json {
  const { projectId: _projectId, proposals: _proposals, ...request } = intakeFixture()
  return { ...request, step, brief: { ...request.brief, materials: [] }, ...overrides }
}

function proposalFor(projectId: string, overrides: Json = {}): Json {
  return { ...scopingProposalFixture(), projectId, ...overrides }
}

function intakeOf(result: CallResult): Json {
  return result.body.intake as Json
}

function proposalIds(result: CallResult): string[] {
  return (intakeOf(result).proposals as Array<{ proposalId: string }>).map((ref) => ref.proposalId)
}

async function getIntake(call: Call, projectId: string): Promise<CallResult> {
  const read = await call('GET', `${API}/projects/${projectId}/intake`)
  expect(read.status, `F1 read: ${JSON.stringify(read.body)}`).toBe(200)
  return read
}

function putIntake(call: Call, projectId: string, body: Json, lock: string | null): Promise<CallResult> {
  return call('PUT', `${API}/projects/${projectId}/intake`, { body, lock: lock ?? undefined })
}

function importProposal(call: Call, projectId: string, body: Json, lock: string | null): Promise<CallResult> {
  return call('POST', `${API}/projects/${projectId}/intake/proposals`, { body, lock: lock ?? undefined })
}

async function intakeRows(projectId: string): Promise<string> {
  const rows = await sql<{ total: string }>('select count(*) as total from delivery_intakes where project_id = $1', [projectId])
  return rows[0]?.total ?? '0'
}

test.describe('TC-DELIVERY-FLOW-01: intake autosave and scoping proposals on the real database', () => {
  test.afterAll(async ({ request }) => {
    await expectNothingLeft(request, registry)
  })

  test('autosave, independent intake version, frozen profile, proposal import and submit gate', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    try {
      const call = caller(request, token)
      const project = await createProject(call, registry, 'TC-DELIVERY-FLOW-01 intake')
      const projectId = project.id

      const empty = await getIntake(call, projectId)
      expect(intakeOf(empty)).toMatchObject({ projectId, step: 'brief', questions: [], proposals: [], platform: { chosen: null } })
      expect(empty.body.targetProfile).toEqual({ ...PROFILE })
      const initialLock = empty.body.updatedAt as string
      expect(await intakeRows(projectId), 'no row before the first write').toBe('0')

      expectError(await putIntake(call, projectId, draft('brief'), null), 428, 'optimistic_lock_required', 'F2 without lock')
      expect(await intakeRows(projectId), 'no row after the refused write').toBe('0')

      const forged = intakeFixture().proposals
      const first = await putIntake(call, projectId, draft('brief', { proposals: forged }), initialLock)
      expect(first.status, `F2 first save: ${JSON.stringify(first.body)}`).toBe(200)
      expect(intakeOf(first).proposals, 'forged proposals are stripped').toEqual([])
      expect(intakeOf(first).step).toBe('brief')
      expect(await intakeRows(projectId), 'one row after the first write').toBe('1')
      const resumed = await getIntake(call, projectId)
      expect(resumed.body, 'GET resumes exactly the saved draft').toEqual(first.body)

      const renamed = await call('PUT', `${API}/projects`, { body: { id: projectId, name: 'Renamed portal' }, lock: await projectVersion(call, projectId) })
      expect(renamed.status, `R3 rename: ${JSON.stringify(renamed.body)}`).toBe(200)
      expectError(await putIntake(call, projectId, draft('scoping'), initialLock), 409, 'optimistic_lock_conflict', 'F2 stale intake lock')
      const second = await putIntake(call, projectId, draft('scoping'), first.body.updatedAt as string)
      expect(second.status, `F2 scoping: ${JSON.stringify(second.body)}`).toBe(200)
      expect(intakeOf(second).step).toBe('scoping')

      const base = draft('scoping')
      const platform = base.platform as { chosen: Json }
      const otherProfile = { ...base, platform: { ...platform, chosen: { ...platform.chosen, profileId: 'react-vite' } } }
      expectError(await putIntake(call, projectId, otherProfile, second.body.updatedAt as string), 422, 'target_profile_frozen', 'F2 other profile')

      const created = await importProposal(call, projectId, proposalFor(projectId), second.body.updatedAt as string)
      expect(created.status, `F3 import: ${JSON.stringify(created.body)}`).toBe(201)
      expect(created.body).toMatchObject({ projectId, duplicate: false, manifestId: scopingProposalFixture().manifestId })
      const manifestId = created.body.manifestId as string
      const afterImport = await getIntake(call, projectId)
      expect(proposalIds(afterImport)).toEqual([manifestId])
      expect(afterImport.body.updatedAt).toBe(created.body.intakeUpdatedAt)
      const mergedQuestions = intakeOf(afterImport).questions as IntakeQuestion[]
      expect(mergedQuestions.map((question) => question.id)).toEqual(['Q-001'])
      expect(mergedQuestions[0]?.answer, 'an agent re-ask never erases the human answer').not.toBeNull()

      const replay = await importProposal(call, projectId, proposalFor(projectId), null)
      expect(replay.status, `F3 replay: ${JSON.stringify(replay.body)}`).toBe(200)
      expect(replay.body).toEqual({ ...created.body, duplicate: true })
      const proposalLock = (await getIntake(call, projectId)).body.updatedAt as string
      const fixtureScope = scopingProposalFixture().scope
      const otherContent = proposalFor(projectId, { scope: { ...fixtureScope, summary: 'Rewritten scope summary' } })
      expectError(await importProposal(call, projectId, otherContent, proposalLock), 409, 'idempotency_conflict', 'F3 same manifest other hash')
      expectError(await importProposal(call, projectId, proposalFor(randomUUID()), proposalLock), 422, 'foreign_reference', 'F3 foreign project')
      expect(proposalIds(await getIntake(call, projectId))).toEqual([manifestId])
      expect(await intakeRows(projectId), 'still one row after the imports').toBe('1')

      const fixtureQuestion = intakeFixture().questions[0]
      const unanswered = [{ ...fixtureQuestion, answer: null }]
      let lock = proposalLock
      for (const step of ['platform', 'review'] as const) {
        const advanced = await putIntake(call, projectId, draft(step, { questions: unanswered }), lock)
        expect(advanced.status, `F2 ${step}: ${JSON.stringify(advanced.body)}`).toBe(200)
        expect(intakeOf(advanced).step).toBe(step)
        lock = advanced.body.updatedAt as string
      }
      const blocked = await putIntake(call, projectId, draft('submitted', { questions: unanswered }), lock)
      expectError(blocked, 422, 'intake_step_invalid', 'F2 submit with an unanswered blocking question')
      const details = blocked.body.details as Array<{ code: string }>
      expect(details.map((detail) => detail.code)).toContain('blocking_question_unanswered')
      expect(proposalIds(await getIntake(call, projectId)), 'the imported proposal reference survives every autosave').toEqual([manifestId])

      const submitted = await putIntake(call, projectId, draft('submitted', { questions: [fixtureQuestion] }), lock)
      expect(submitted.status, `F2 submitted: ${JSON.stringify(submitted.body)}`).toBe(200)
      expect(intakeOf(submitted).step).toBe('submitted')
      expect(await intakeRows(projectId), 'one row at the end').toBe('1')
    } finally {
      await cleanupRegistry(request, token, registry)
    }
  })

  test('a sibling organisation user gets 404 on the intake routes and writes nothing', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    try {
      const call = caller(request, token)
      const project = await createProject(call, registry, 'TC-DELIVERY-FLOW-01 intake scope')
      const projectId = project.id
      const initialLock = (await getIntake(call, projectId)).body.updatedAt as string
      const saved = await putIntake(call, projectId, draft('brief'), initialLock)
      expect(saved.status, `F2 owner save: ${JSON.stringify(saved.body)}`).toBe(200)
      const ownerLock = saved.body.updatedAt as string
      const rowsBefore = await sql('select updated_at, step, brief, questions, proposals, imported_manifests from delivery_intakes where project_id = $1', [projectId])

      const foreign = await createSiblingOrgUser(request, token, registry, 'intake')
      const foreignCall = caller(request, foreign.token)
      const probes: Array<[string, () => Promise<CallResult>]> = [
        ['F1 read', () => foreignCall('GET', `${API}/projects/${projectId}/intake`)],
        ['F2 save with the owner lock', () => putIntake(foreignCall, projectId, draft('scoping'), ownerLock)],
        ['F3 import with the owner lock', () => importProposal(foreignCall, projectId, proposalFor(projectId), ownerLock)],
      ]
      for (const [label, probe] of probes) {
        const result = await probe()
        expectError(result, 404, 'not_found', `${label} as org B user`)
        expect(JSON.stringify(result.body), `${label} leaks nothing`).not.toContain(projectId)
      }

      expect(await intakeRows(projectId), 'row count unchanged').toBe('1')
      expect(await sql('select updated_at, step, brief, questions, proposals, imported_manifests from delivery_intakes where project_id = $1', [projectId]), 'owner row untouched').toEqual(rowsBefore)
    } finally {
      await cleanupRegistry(request, token, registry)
    }
  })
})
