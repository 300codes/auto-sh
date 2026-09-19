import { randomUUID } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  API,
  CLIENT_APPROVAL,
  approvalFor,
  approveAllStages,
  approveStage,
  caller,
  cancelAttempt,
  cleanupRegistry,
  createReadyTask,
  createRegistry,
  createSiblingOrgUser,
  designArtifact,
  expectError,
  expectGateRefusal,
  expectNothingLeft,
  getFlow,
  listArtifacts,
  listDecisions,
  pinProject,
  postArtifact,
  postDecision,
  projectVersion,
  recordArtifact,
  reconcileAttempt,
  reserve,
  scopeArtifact,
  seedApprovedBaseline,
  sql,
  stageCurrencies,
  taskVersion,
  withStage,
  type Call,
  type CallResult,
  type Json,
} from './flowSpecKit'

/**
 * TC-DELIVERY-FLOW-09: an upstream change after the chain was approved, against the real database.
 *
 * A new Scope version on a fully approved, pinned project makes every downstream stage `stale` without touching a
 * single row of the approved history: dispatch closes (R14 answers the frozen v1 gate code with the stale detail),
 * the old decision can no longer be re-applied to the superseded version, and the chain is rebuilt version by
 * version. While an attempt is reserved (or awaiting a confirmed stop) no new artifact version may land at all; only
 * a reconciled stop reopens the door. A sibling organisation sees none of it. Rows are hard-deleted by project id in
 * teardown.
 */

const registry = createRegistry()
const ALL_STAGES = ['scope', 'ux', 'key_visual', 'design_system_ui'] as const

function blockerKinds(flow: Json): string[] {
  return (flow.blockers as Array<{ kind: string }>).map((blocker) => blocker.kind)
}

function gateOpen(flow: Json, gate: 'dispatchable' | 'publishable'): boolean {
  return ((flow.gates as Json)[gate] as { ok: boolean }).ok
}

async function countRows(table: 'delivery_flow_stage_artifacts' | 'delivery_flow_stage_decisions', projectId: string): Promise<string> {
  const rows = await sql<{ total: string }>(`select count(*) as total from ${table} where project_id = $1`, [projectId])
  return rows[0]?.total ?? '0'
}

async function decisionIds(projectId: string): Promise<string[]> {
  const rows = await sql<{ id: string }>('select id::text as id from delivery_flow_stage_decisions where project_id = $1 order by id', [projectId])
  return rows.map((row) => row.id)
}

async function attemptStates(taskId: string): Promise<string[]> {
  const rows = await sql<{ state: string }>(
    `select entry->>'state' as state from delivery_tasks, jsonb_array_elements(execution_attempts) entry where id = $1`,
    [taskId],
  )
  return rows.map((row) => row.state)
}

async function expectAllApproved(call: Call, projectId: string): Promise<Json> {
  const flow = await getFlow(call, projectId)
  expect(stageCurrencies(flow)).toMatchObject(Object.fromEntries(ALL_STAGES.map((stageId) => [stageId, 'approved'])))
  expect(gateOpen(flow, 'dispatchable') && gateOpen(flow, 'publishable'), 'both gates open').toBe(true)
  return flow
}

test.describe('TC-DELIVERY-FLOW-09: upstream change makes downstream stale and closes dispatch', () => {
  test.afterAll(async ({ request }) => {
    await expectNothingLeft(request, registry)
  })

  test('new scope version → downstream stale, gate closed, history intact, chain rebuilt, active attempt blocks versions', async ({ request }) => {
    test.slow()
    let token: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const call = caller(request, token)
      const seed = await seedApprovedBaseline(request, token, call, registry, 'TC-DELIVERY-FLOW-09 upstream')
      const id = seed.projectId
      const pinned = await pinProject(call, id, await projectVersion(call, id))
      expect(pinned.status, `F4 pin: ${JSON.stringify(pinned.body)}`).toBe(201)
      const chain = await approveAllStages(call, id)
      await expectAllApproved(call, id)
      const task = await createReadyTask(call, id, seed.baselineId, 'Booking page')
      const approvedIds = await decisionIds(id)
      expect(approvedIds, 'one approval per stage').toHaveLength(4)

      const scopeV2Result = await postArtifact(call, id, 'scope', scopeArtifact(id, 'Second scope version: add a gallery page'), await projectVersion(call, id))
      expect(scopeV2Result.status, `F7 scope v2: ${JSON.stringify(scopeV2Result.body)}`).toBe(201)
      expect(scopeV2Result.body).toMatchObject({ version: 2, duplicate: false, downstreamNowStale: ['ux', 'key_visual', 'design_system_ui'] })
      const scopeV2 = { artifactId: scopeV2Result.body.artifactId as string, version: 2, contentHash: scopeV2Result.body.contentHash as string }
      const afterScope = await getFlow(call, id)
      expect(stageCurrencies(afterScope)).toMatchObject({ scope: 'pending', ux: 'stale', key_visual: 'stale', design_system_ui: 'stale' })
      expect(gateOpen(afterScope, 'dispatchable')).toBe(false)
      expect(blockerKinds(afterScope)).toContain('decision_pending')
      expect(blockerKinds(afterScope)).toContain('upstream_not_approved')
      expect(afterScope.nextAction).toEqual({ kind: 'approve_stage', stageId: 'scope' })

      const refused = await reserve(call, task.taskId, (await taskVersion(call, task.taskId)).updatedAt)
      expectGateRefusal(refused, 'R14 reserve after the scope change')
      const refusedDetails = refused.body.details as Array<{ code: string; path: string }>
      expect(refusedDetails.map((detail) => detail.path)).toContain('stages.scope')
      expect(refusedDetails.some((detail) => detail.code === 'stage_dependency_stale' && detail.path === 'stages.ux'), 'ux is stale').toBe(true)
      expect(await attemptStates(task.taskId), 'no attempt reserved').toEqual([])

      const uxHistory = await listDecisions(call, id, 'ux')
      expect(uxHistory.status, `F9 ux decisions: ${JSON.stringify(uxHistory.body)}`).toBe(200)
      expect(uxHistory.body.total).toBe(1)
      expect((uxHistory.body.items as Json[])[0]).toMatchObject({ verdict: 'approved', artifactId: chain.ux.artifactId })
      const scopeVersions = await listArtifacts(call, id, 'scope')
      expect(scopeVersions.status, `F9 scope artifacts: ${JSON.stringify(scopeVersions.body)}`).toBe(200)
      expect(scopeVersions.body.total).toBe(2)
      expect((scopeVersions.body.items as Array<{ version: number }>).map((item) => item.version)).toEqual([2, 1])
      expect(await decisionIds(id), 'the four approvals stay, none deleted').toEqual(approvedIds)

      const replayOld = await postDecision(call, id, 'scope', approvalFor(chain.scope), { key: `tc-flow-09-${randomUUID()}`, lock: await projectVersion(call, id) })
      expectError(replayOld, 409, 'stage_artifact_stale', 'F8 approving the superseded scope v1')
      await approveStage(call, id, 'scope', scopeV2)
      const afterScopeApproval = await getFlow(call, id)
      expect(stageCurrencies(afterScopeApproval)).toMatchObject({ scope: 'approved', ux: 'stale' })
      expect(gateOpen(afterScopeApproval, 'dispatchable')).toBe(false)
      expect(blockerKinds(afterScopeApproval), 'ux is bound to the superseded scope hash').toContain('upstream_stale')
      const uxV2 = await recordArtifact(call, id, designArtifact(id, 'ux', [withStage('scope', scopeV2)]))
      expect(uxV2.version).toBe(2)
      await approveStage(call, id, 'ux', uxV2)
      expect(stageCurrencies(await getFlow(call, id))).toMatchObject({ ux: 'approved', key_visual: 'stale' })

      const keyVisualV2 = await recordArtifact(call, id, designArtifact(id, 'key_visual', [withStage('scope', scopeV2), withStage('ux', uxV2)]))
      await approveStage(call, id, 'key_visual', keyVisualV2, { clientApproval: CLIENT_APPROVAL })
      const designSystemUiV2 = await recordArtifact(
        call,
        id,
        designArtifact(id, 'design_system_ui', [withStage('scope', scopeV2), withStage('ux', uxV2), withStage('key_visual', keyVisualV2)]),
      )
      await approveStage(call, id, 'design_system_ui', designSystemUiV2, { clientApproval: CLIENT_APPROVAL })
      await expectAllApproved(call, id)

      const reserved = await reserve(call, task.taskId, (await taskVersion(call, task.taskId)).updatedAt)
      expect(reserved.status, `R14 reserve on the rebuilt chain: ${JSON.stringify(reserved.body)}`).toBe(201)
      const attemptId = reserved.body.attemptId as string
      const uxV3 = designArtifact(id, 'ux', [withStage('scope', scopeV2)], 'Third UX version while an attempt runs')
      const artifactsBefore = await countRows('delivery_flow_stage_artifacts', id)
      const blockedByReserved = await postArtifact(call, id, 'ux', uxV3, await projectVersion(call, id))
      expectError(blockedByReserved, 409, 'attempt_active', 'F7 ux v3 while reserved')
      expect(await countRows('delivery_flow_stage_artifacts', id), 'no artifact row while reserved').toBe(artifactsBefore)

      const cancelled = await cancelAttempt(call, task.taskId, attemptId, (await taskVersion(call, task.taskId)).updatedAt)
      expect(cancelled.status, `R17 cancel: ${JSON.stringify(cancelled.body)}`).toBe(200)
      expect(cancelled.body).toMatchObject({ attemptId, state: 'cancel_requested' })
      expect(await attemptStates(task.taskId)).toEqual(['cancel_requested'])
      const blockedByCancelRequested = await postArtifact(call, id, 'ux', uxV3, await projectVersion(call, id))
      expectError(blockedByCancelRequested, 409, 'attempt_active', 'F7 ux v3 while the stop is unconfirmed')
      expect(await countRows('delivery_flow_stage_artifacts', id), 'no artifact row while cancel requested').toBe(artifactsBefore)

      const reconciled = await reconcileAttempt(call, task.taskId, attemptId, (await taskVersion(call, task.taskId)).updatedAt, 'stopped')
      expect(reconciled.status, `R18 reconcile: ${JSON.stringify(reconciled.body)}`).toBe(200)
      expect(reconciled.body).toMatchObject({ attemptId, resolution: 'stopped', taskStatus: 'ready' })
      expect((await taskVersion(call, task.taskId)).status).toBe('ready')
      const uxV3Result = await postArtifact(call, id, 'ux', uxV3, await projectVersion(call, id))
      expect(uxV3Result.status, `F7 ux v3 after reconcile: ${JSON.stringify(uxV3Result.body)}`).toBe(201)
      expect(uxV3Result.body).toMatchObject({ version: 3, downstreamNowStale: ['key_visual', 'design_system_ui'] })
      const afterUxV3 = await getFlow(call, id)
      expect(stageCurrencies(afterUxV3)).toMatchObject({ scope: 'approved', ux: 'pending', key_visual: 'stale', design_system_ui: 'stale' })
      expect(gateOpen(afterUxV3, 'dispatchable')).toBe(false)
      expectGateRefusal(await reserve(call, task.taskId, (await taskVersion(call, task.taskId)).updatedAt), 'R14 reserve after ux v3')
    } finally {
      await cleanupRegistry(request, token, registry)
    }
  })

  test('a sibling organisation user gets 404 on artifacts, decisions and flow status of the owner and changes nothing', async ({ request }) => {
    test.slow()
    let token: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const call = caller(request, token)
      const seed = await seedApprovedBaseline(request, token, call, registry, 'TC-DELIVERY-FLOW-09 foreign')
      const id = seed.projectId
      const pinned = await pinProject(call, id, await projectVersion(call, id))
      expect(pinned.status, `F4 pin: ${JSON.stringify(pinned.body)}`).toBe(201)
      const chain = await approveAllStages(call, id)
      const artifactsBefore = await countRows('delivery_flow_stage_artifacts', id)
      const approvalsBefore = await countRows('delivery_flow_stage_decisions', id)
      const ownerLock = await projectVersion(call, id)

      const foreign = await createSiblingOrgUser(request, token, registry, 'upstream')
      const foreignCall = caller(request, foreign.token)
      const probes: Array<[string, () => Promise<CallResult>]> = [
        ['F7 scope v2', () => postArtifact(foreignCall, id, 'scope', scopeArtifact(id, 'Foreign scope version'), ownerLock)],
        ['F8 ux decision', () => postDecision(foreignCall, id, 'ux', approvalFor(chain.ux), { key: `tc-flow-09-${randomUUID()}`, lock: ownerLock })],
        ['F9 artifacts', () => listArtifacts(foreignCall, id, 'scope')],
        ['F9 decisions', () => listDecisions(foreignCall, id, 'ux')],
        ['F6 flow', () => foreignCall('GET', `${API}/projects/${id}/flow`)],
      ]
      for (const [label, probe] of probes) {
        const result = await probe()
        expectError(result, 404, 'not_found', `${label} as org B user`)
        expect(JSON.stringify(result.body), `${label} leaks nothing`).not.toContain(id)
      }

      expect(await countRows('delivery_flow_stage_artifacts', id), 'artifact rows untouched').toBe(artifactsBefore)
      expect(await countRows('delivery_flow_stage_decisions', id), 'approval rows untouched').toBe(approvalsBefore)
      await expectAllApproved(call, id)
    } finally {
      await cleanupRegistry(request, token, registry)
    }
  })
})
