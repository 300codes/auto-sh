import { randomUUID } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  API,
  CLIENT_APPROVAL,
  TEMPLATE,
  approvalFor,
  approveStage,
  caller,
  cleanupRegistry,
  createOwnerOrgUser,
  createProject,
  createReadyTask,
  createRegistry,
  createSiblingOrgUser,
  createTask,
  deliverVerifiedResult,
  deployConsent,
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
  reserve,
  scopeArtifact,
  seedApprovedBaseline,
  setTaskReady,
  sql,
  stageCurrencies,
  taskVersion,
  withStage,
  type Json,
} from './flowSpecKit'

/**
 * TC-DELIVERY-FLOW-02: stage artifacts, stage decisions and the flow gate on the frozen v1 routes, on the real database.
 *
 * Owner: OSS stream (FLOW-F1). The jest route tests cover the handlers over an in-memory store; this spec proves what only
 * Postgres can: the write-once pin columns, the (project, stage, hash) artifact unique index behind the duplicate answer,
 * the (project, idempotency key) decision index behind replay and conflict, and the gate reading the append-only rows.
 *
 * The v1 project is seeded and worked BEFORE it is pinned (verified task A, ready task B, draft task C), then pinned in
 * flight: the v1 reserve route validates the task lifecycle before the flow gate and the deploy-consent route needs a green
 * report before the flow gate, so the gate is only observable on a project that already satisfies v1. That order proves a
 * template pinned onto an in-flight project cannot be bypassed through the old routes.
 *
 * ENVIRONMENT: API fixtures plus DB fixtures (`withClient` reads DATABASE_URL), so the app and the fixtures must share one
 * database. Artifacts and decisions are append-only without a delete route; teardown hard-deletes by project id and
 * `afterAll` asserts nothing is left.
 */

type Gate = { ok: boolean; blocking: Array<{ kind: string }> }
type Gates = { dispatchable: Gate; publishable: Gate }
type Detail = { path: string; code: string }
type Pending = { stageId: string; artifactId: string }

const key = (label: string): string => `tc-flow-02-${label}-${randomUUID()}`

test.describe('TC-DELIVERY-FLOW-02: stage approvals gate a project pinned in flight', () => {
  const registry = createRegistry()

  test.afterAll(async ({ request }) => {
    await expectNothingLeft(request, registry)
  })

  test('pin → scope → ux pending closes the v1 routes → all four approved reopens them', async ({ request }) => {
    test.slow()
    let token: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const call = caller(request, token)
      const seed = await seedApprovedBaseline(request, token, call, registry, 'approvals')
      const { projectId: id, baselineId } = seed
      const taskA = await createReadyTask(call, id, baselineId, 'Task A verified')
      const { manifest } = await deliverVerifiedResult(call, id, baselineId, taskA)
      const taskB = await createReadyTask(call, id, baselineId, 'Task B ready')
      const taskC = await createTask(call, id, baselineId, 'Task C draft')

      const legacy = await getFlow(call, id)
      expect(legacy.template, 'legacy project has no template').toBeNull()
      expect((legacy.gates as Gates).dispatchable.ok, 'legacy project is not gated').toBe(true)
      expect((legacy.blockers as Array<{ kind: string }>).map((blocker) => blocker.kind)).toContain('template_not_pinned')

      const pinned = await pinProject(call, id, await projectVersion(call, id))
      expect(pinned.status, `F4 pin: ${JSON.stringify(pinned.body)}`).toBe(201)
      expect(pinned.body.template).toMatchObject({ templateId: TEMPLATE.templateId, version: TEMPLATE.templateVersion })
      expect((pinned.body.template as { hash: string }).hash).toMatch(/^[0-9a-f]{64}$/)
      const pinReplay = await pinProject(call, id, null)
      expect(pinReplay.status, 'F4 replay without a header').toBe(200)
      expect(pinReplay.body).toEqual(pinned.body)
      expectError(await pinProject(call, id, await projectVersion(call, id), { ...TEMPLATE, templateVersion: 2 }), 409, 'flow_already_pinned', 'F4 other template')
      const pinRows = await sql('select flow_template_id, flow_template_version, flow_template_hash from delivery_projects where id = $1', [id])
      expect(pinRows[0]).toEqual({
        flow_template_id: TEMPLATE.templateId,
        flow_template_version: TEMPLATE.templateVersion,
        flow_template_hash: (pinned.body.template as { hash: string }).hash,
      })

      const scopeBody = scopeArtifact(id)
      const scopeCreated = await postArtifact(call, id, 'scope', scopeBody, await projectVersion(call, id))
      expect(scopeCreated.status, `F7 scope: ${JSON.stringify(scopeCreated.body)}`).toBe(201)
      expect(scopeCreated.body).toMatchObject({ stageId: 'scope', version: 1, duplicate: false })
      const scope = { artifactId: scopeCreated.body.artifactId as string, version: 1, contentHash: scopeCreated.body.contentHash as string }
      const scopeReplay = await postArtifact(call, id, 'scope', scopeBody, null)
      expect(scopeReplay.status, 'F7 identical content without a header').toBe(200)
      expect(scopeReplay.body).toMatchObject({ artifactId: scope.artifactId, duplicate: true })
      const artifactRows = await sql<{ total: string }>('select count(*) as total from delivery_flow_stage_artifacts where project_id = $1', [id])
      expect(artifactRows[0]?.total, 'one artifact row after the duplicate').toBe('1')

      expectError(await postDecision(call, id, 'scope', approvalFor(scope), { key: null, lock: await projectVersion(call, id) }), 400, 'idempotency_key_required', 'F8 no key')
      const scopeKey = key('scope')
      const approved = await postDecision(call, id, 'scope', approvalFor(scope), { key: scopeKey, lock: await projectVersion(call, id) })
      expect(approved.status, `F8 approve scope: ${JSON.stringify(approved.body)}`).toBe(201)
      expect(approved.body).toMatchObject({ verdict: 'approved', currency: 'approved', duplicate: false })
      const approvedReplay = await postDecision(call, id, 'scope', approvalFor(scope), { key: scopeKey, lock: null })
      expect(approvedReplay.status, 'F8 replay of the same key and body').toBe(200)
      expect(approvedReplay.body).toMatchObject({ decisionId: approved.body.decisionId, duplicate: true })
      const rejectedBody = approvalFor(scope, { verdict: 'rejected', reason: 'Wrong audience' })
      expectError(await postDecision(call, id, 'scope', rejectedBody, { key: scopeKey, lock: await projectVersion(call, id) }), 409, 'idempotency_conflict', 'F8 same key, other body')
      const wrongHash = approvalFor(scope, { subjectHash: 'f'.repeat(64) })
      expectError(await postDecision(call, id, 'scope', wrongHash, { key: key('hash'), lock: await projectVersion(call, id) }), 409, 'subject_hash_mismatch', 'F8 wrong hash')
      const decisionRows = await sql<{ total: string }>('select count(*) as total from delivery_flow_stage_decisions where project_id = $1', [id])
      expect(decisionRows[0]?.total, 'one decision row after replay and refusals').toBe('1')

      const ux = await recordArtifact(call, id, designArtifact(id, 'ux', [withStage('scope', scope)]))
      const uxPending = await getFlow(call, id)
      expect(stageCurrencies(uxPending)).toMatchObject({ scope: 'approved', ux: 'pending', key_visual: 'missing', design_system_ui: 'missing' })
      const pending = uxPending.pendingApprovals as Pending[]
      expect(pending).toHaveLength(1)
      expect(pending[0]).toMatchObject({ stageId: 'ux', artifactId: ux.artifactId })
      expect((uxPending.gates as Gates).dispatchable.ok).toBe(false)
      expect((uxPending.gates as Gates).publishable.ok).toBe(false)
      expect(uxPending.nextAction).toEqual({ kind: 'approve_stage', stageId: 'ux' })

      const gated: Array<[string, () => Promise<{ status: number; body: Json }>]> = [
        ['R12 task ready', () => setTaskReady(call, taskC.taskId, taskC.updatedAt)],
        ['R14 reserve', async () => reserve(call, taskB.taskId, (await taskVersion(call, taskB.taskId)).updatedAt)],
      ]
      for (const [label, probe] of gated) {
        const refused = await probe()
        expectGateRefusal(refused, label)
        expect(refused.body.details as Detail[], `${label}: ux detail`).toContainEqual(expect.objectContaining({ path: 'stages.ux', code: 'stage_not_approved' }))
      }
      const gatedConsent = await deployConsent(call, id, baselineId, manifest.resultRevision, await projectVersion(call, id))
      expect({ status: gatedConsent.status, code: gatedConsent.body.code }, 'R20 deploy consent on a pinned project needs a release candidate').toEqual({ status: 422, code: 'release_candidate_required' })
      const afterGate = await sql<{ status: string; attempts: number; deploys: string }>(
        `select (select status from delivery_tasks where id = $1) as status,
                (select jsonb_array_length(execution_attempts) from delivery_tasks where id = $2) as attempts,
                (select count(*) from delivery_decisions where project_id = $3 and kind = 'deploy') as deploys`,
        [taskC.taskId, taskB.taskId, id],
      )
      expect(afterGate[0], 'the gated routes wrote nothing').toEqual({ status: 'draft', attempts: 0, deploys: '0' })

      await approveStage(call, id, 'ux', ux)
      const keyVisual = await recordArtifact(call, id, designArtifact(id, 'key_visual', [withStage('scope', scope), withStage('ux', ux)]))
      expectError(
        await postDecision(call, id, 'key_visual', approvalFor(keyVisual), { key: key('kv'), lock: await projectVersion(call, id) }),
        422,
        'client_approval_required',
        'F8 key visual without the client',
      )
      const keyVisualApproved = await approveStage(call, id, 'key_visual', keyVisual, { clientApproval: CLIENT_APPROVAL })
      expect(keyVisualApproved.clientApproved).toBe(true)
      const designSystemUi = await recordArtifact(
        call,
        id,
        designArtifact(id, 'design_system_ui', [withStage('scope', scope), withStage('ux', ux), withStage('key_visual', keyVisual)]),
      )
      const designSystemApproved = await approveStage(call, id, 'design_system_ui', designSystemUi, { clientApproval: CLIENT_APPROVAL })
      expect(designSystemApproved.clientApproved).toBe(true)

      const scopeHistory = await listDecisions(call, id, 'scope')
      expect(scopeHistory.status, `F9 decisions: ${JSON.stringify(scopeHistory.body)}`).toBe(200)
      expect(scopeHistory.body.total).toBe(1)
      const scopeItem = (scopeHistory.body.items as Json[])[0]
      expect(scopeItem).toMatchObject({ decisionId: approved.body.decisionId, verdict: 'approved' })
      expect(scopeItem).not.toHaveProperty('idempotencyKey')
      expect(scopeItem).not.toHaveProperty('requestHash')
      const uxHistory = await listArtifacts(call, id, 'ux')
      expect(uxHistory.status, `F9 artifacts: ${JSON.stringify(uxHistory.body)}`).toBe(200)
      expect(uxHistory.body.total).toBe(1)
      expect((uxHistory.body.items as Json[])[0]).toMatchObject({ artifactId: ux.artifactId, version: 1 })

      const complete = await getFlow(call, id)
      expect(stageCurrencies(complete)).toMatchObject({ scope: 'approved', ux: 'approved', key_visual: 'approved', design_system_ui: 'approved' })
      expect((complete.gates as Gates).dispatchable.ok).toBe(true)
      expect((complete.gates as Gates).publishable.ok).toBe(true)
      expect(complete.pendingApprovals).toEqual([])

      const readyC = await setTaskReady(call, taskC.taskId, (await taskVersion(call, taskC.taskId)).updatedAt)
      expect(readyC.status, `R12 ready after approvals: ${JSON.stringify(readyC.body)}`).toBe(200)
      expect(readyC.body.status).toBe('ready')
      const reservedB = await reserve(call, taskB.taskId, (await taskVersion(call, taskB.taskId)).updatedAt)
      expect(reservedB.status, `R14 reserve after approvals: ${JSON.stringify(reservedB.body)}`).toBe(201)
      expect(typeof reservedB.body.attemptId).toBe('string')
      const consent = await deployConsent(call, id, baselineId, manifest.resultRevision, await projectVersion(call, id))
      expect({ status: consent.status, code: consent.body.code }, 'R20 deploy consent after approvals still needs a release candidate').toEqual({ status: 422, code: 'release_candidate_required' })

      const executing = await getFlow(call, id)
      expect((executing.gates as Gates).publishable.ok).toBe(true)
      expect((executing.gates as Gates).dispatchable.ok, 'the reserved attempt closes dispatch until it is closed').toBe(false)
      expect((executing.gates as Gates).dispatchable.blocking.map((blocker) => blocker.kind)).toEqual(['attempt_active'])
      expect(executing.pendingApprovals).toEqual([])
    } finally {
      await cleanupRegistry(request, token, registry)
    }
  })

  test('a manage-only user cannot approve (403) and a sibling organisation sees 404 on every flow route', async ({ request }) => {
    test.slow()
    let token: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const call = caller(request, token)
      const project = await createProject(call, registry, 'TC-DELIVERY-FLOW-02 scope')
      const id = project.id
      const ownerPin = await pinProject(call, id, project.updatedAt)
      expect(ownerPin.status, `F4 pin: ${JSON.stringify(ownerPin.body)}`).toBe(201)
      const scope = await recordArtifact(call, id, scopeArtifact(id))
      const countRows = () =>
        sql<{ artifacts: string; decisions: string }>(
          `select (select count(*) from delivery_flow_stage_artifacts where project_id = $1) as artifacts,
                  (select count(*) from delivery_flow_stage_decisions where project_id = $1) as decisions`,
          [id],
        )
      expect((await countRows())[0]).toEqual({ artifacts: '1', decisions: '0' })

      const manageOnly = await createOwnerOrgUser(request, token, registry, 'manage-only', ['delivery_os.projects.view', 'delivery_os.projects.manage'])
      const manageCall = caller(request, manageOnly.token)
      const forbidden = await postDecision(manageCall, id, 'scope', approvalFor(scope), { key: key('manage'), lock: await projectVersion(call, id) })
      expect(forbidden.status, `F8 manage-only approval: ${JSON.stringify(forbidden.body)}`).toBe(403)
      expect(forbidden.body).not.toHaveProperty('decisionId')
      expect(JSON.stringify(forbidden.body)).not.toContain(scope.artifactId)
      expect((await countRows())[0].decisions, 'the refused approval wrote nothing').toBe('0')

      const sibling = await createSiblingOrgUser(request, token, registry, 'stages')
      const siblingCall = caller(request, sibling.token)
      const ownerLock = await projectVersion(call, id)
      const probes: Array<[string, () => Promise<{ status: number; body: Json }>]> = [
        ['F4 pin', () => pinProject(siblingCall, id, ownerLock)],
        ['F7 scope artifact', () => postArtifact(siblingCall, id, 'scope', scopeArtifact(id), ownerLock)],
        ['F8 scope decision', () => postDecision(siblingCall, id, 'scope', approvalFor(scope), { key: key('sibling'), lock: ownerLock })],
        ['F9 artifacts', () => listArtifacts(siblingCall, id, 'scope')],
        ['F9 decisions', () => listDecisions(siblingCall, id, 'scope')],
        ['F6 flow', () => siblingCall('GET', `${API}/projects/${id}/flow`)],
      ]
      for (const [label, probe] of probes) {
        const result = await probe()
        expectError(result, 404, 'not_found', `${label} as org B user`)
        expect(JSON.stringify(result.body), `${label} leaks nothing`).not.toContain(id)
      }
      expect((await countRows())[0], 'the foreign probes wrote nothing').toEqual({ artifacts: '1', decisions: '0' })
    } finally {
      await cleanupRegistry(request, token, registry)
    }
  })
})
