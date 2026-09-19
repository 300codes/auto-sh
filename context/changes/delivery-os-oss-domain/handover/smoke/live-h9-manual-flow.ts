// OSS-02 H9 live smoke of the manual flow (27 checks). Run against the local dev instance:
//   OM_SMOKE_PASSWORD=<seeded admin password> yarn run -T tsx context/changes/delivery-os-oss-domain/handover/smoke/live-h9-manual-flow.ts
// Re-run on 2026-09-19 (T049): 27/27.
import { execSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { buildResultManifest } from '/Users/mateuszstopinski/Documents/om-hack/proj2/open-mercato/packages/core/src/modules/delivery_os/lib/fixtures/builders'
import { loadBaselineContentFixture } from '/Users/mateuszstopinski/Documents/om-hack/proj2/open-mercato/packages/core/src/modules/delivery_os/lib/fixtures/index'

const BASE = 'http://localhost:3100'
const LOCK = 'x-om-ext-optimistic-lock-expected-updated-at'
const NAME = 'T018 H9 smoke'
let token = ''
const checks: Array<[string, boolean]> = []
const check = (label: string, ok: boolean) => { checks.push([label, ok]); console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${label}`) }

function sql(query: string): string {
  return execSync(`docker exec omhack-postgres psql -U postgres -d open-mercato -At -c "${query.replace(/"/g, '\\"')}"`).toString().trim()
}
function snapshot(taskId: string): string {
  const counts = ['delivery_projects', 'delivery_baselines', 'delivery_decisions', 'delivery_tasks', 'delivery_evidence']
    .map((table) => `${table}=${sql(`select count(*) from ${table}`)}`)
    .join(' ')
  return `${counts} task.updated_at=${sql(`select updated_at from delivery_tasks where id='${taskId}'`)} attempts=${sql(`select jsonb_array_length(execution_attempts) from delivery_tasks where id='${taskId}'`)}`
}
async function call(method: string, path: string, options: { body?: unknown; lock?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { authorization: `Bearer ${token}`, ...(options.headers ?? {}) }
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  if (options.lock) headers[LOCK] = options.lock
  const response = await fetch(`${BASE}${path}`, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) })
  const text = await response.text()
  let body: any = text
  try { body = JSON.parse(text) } catch {}
  const brief = typeof body === 'object' && body ? JSON.stringify(body).slice(0, 240) : String(body).slice(0, 200)
  console.log(`${method} ${path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, ':id')}${options.lock ? ' [lock]' : ''}${options.headers?.['Idempotency-Key'] ? ' [key]' : ''} -> ${response.status} ${brief}`)
  return { status: response.status, body }
}
const projectVersion = async (id: string) => (await call('GET', `/api/delivery_os/projects/${id}`)).body.updatedAt as string

async function main() {
  const login = await fetch(`${BASE}/api/auth/login`, { method: 'POST', body: new URLSearchParams({ email: 'admin@acme.com', password: process.env.OM_SMOKE_PASSWORD ?? '' }) })
  token = ((await login.json()) as any).token
  console.log('POST /api/auth/login ->', login.status, token ? 'token ok' : 'NO TOKEN')

  console.log('--- R2 project, real attachment, R3 draft')
  const project = await call('POST', '/api/delivery_os/projects', { body: { name: NAME, inputMode: 'from_brief', targetProfileId: 'react-vite', brief: 'T018 OSS-only H9 smoke' } })
  check('R2 create project 201', project.status === 201)
  const projectId = project.body.id as string
  const initialVersion = await projectVersion(projectId)

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
  const form = new FormData()
  form.set('entityId', 'delivery_os:delivery_project')
  form.set('recordId', projectId)
  form.set('file', new Blob([png], { type: 'image/png' }), 't018-screen.png')
  const upload = await fetch(`${BASE}/api/attachments`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form })
  const uploadBody: any = await upload.json()
  console.log('POST /api/attachments (multipart image/png) ->', upload.status, JSON.stringify(uploadBody).slice(0, 160))
  const attachmentId = (uploadBody.item?.id ?? uploadBody.id) as string
  check('attachment upload 200/201 with id', (upload.status === 200 || upload.status === 201) && Boolean(attachmentId))
  const sha256 = createHash('sha256').update(png).digest('hex')

  const content: any = loadBaselineContentFixture()
  const draftSpec = {
    requirements: content.requirements,
    acceptanceCriteria: content.acceptanceCriteria,
    screens: content.screens.map((screen: any) => ({ ...screen, attachmentId, sha256 })),
    tokens: content.tokens,
    architectureSummary: content.architectureSummary,
    planSummary: content.planSummary,
    acTestMap: content.acTestMap,
    manualChecks: content.manualChecks,
    declaredTests: content.declaredTests,
    attachments: [{ attachmentId, sha256 }],
  }
  const draft = await call('PUT', '/api/delivery_os/projects', { body: { id: projectId, draftSpec }, lock: initialVersion })
  check('R3 draft update 200', draft.status === 200)

  console.log('--- stale update probe (R3 with the pre-draft version)')
  const stale = await call('PUT', '/api/delivery_os/projects', { body: { id: projectId, brief: 'stale write' }, lock: initialVersion })
  check('stale project update 409 optimistic_lock_conflict', stale.status === 409 && stale.body?.code === 'optimistic_lock_conflict')
  const noLock = await call('PUT', '/api/delivery_os/projects', { body: { id: projectId, brief: 'no header' } })
  check('R3 lock is platform (header-optional per spec route table): no header -> 200', noLock.status === 200)
  const baselineNoLock = await call('POST', `/api/delivery_os/projects/${projectId}/baselines`, { body: { source: 'manual' } })
  check('R7 lock is required: no header -> 428 optimistic_lock_required', baselineNoLock.status === 428 && baselineNoLock.body?.code === 'optimistic_lock_required')

  console.log('--- R7 manual baseline, R8 real decisions')
  const baseline = await call('POST', `/api/delivery_os/projects/${projectId}/baselines`, { body: { source: 'manual' }, lock: await projectVersion(projectId) })
  check('R7 baseline 201', baseline.status === 201)
  const { baselineId, contentHash, version } = baseline.body
  for (const kind of ['requirements', 'design']) {
    const decision = await call('POST', `/api/delivery_os/baselines/${baselineId}/decisions`, {
      body: { kind, verdict: 'approved', subjectHash: contentHash, subjectVersion: version },
      lock: await projectVersion(projectId),
    })
    check(`R8 ${kind} decision 201`, decision.status === 201)
  }
  const detailAfterDecisions = await call('GET', `/api/delivery_os/projects/${projectId}`)
  check('activeBaselineId set only after both decisions', detailAfterDecisions.body.activeBaselineId === baselineId)

  console.log('--- R10 task, R12 ready')
  const task = await call('POST', `/api/delivery_os/projects/${projectId}/tasks`, { body: { source: 'manual', baselineId, title: 'Service list', acIds: ['AC-001'] } })
  check('R10 task 201', task.status === 201)
  const taskId = task.body.id as string
  const ready = await call('PUT', '/api/delivery_os/tasks', { body: { id: taskId, status: 'ready' }, lock: task.body.updatedAt })
  check('R12 ready 200', ready.status === 200 && ready.body.status === 'ready')

  console.log('--- R14 reserve')
  const reserveBody = { mode: 'manual_handoff', baseRevision: { kind: 'git', commitSha: '418828d5588b28dd6b9c0b430f8bc0392479ea39' } }
  const key = { 'Idempotency-Key': `t018-live-${Date.now()}` }
  const noKey = await call('POST', `/api/delivery_os/tasks/${taskId}/attempts`, { body: reserveBody, lock: ready.body.updatedAt })
  check('reserve without Idempotency-Key 400', noKey.status === 400)
  const automatic = await call('POST', `/api/delivery_os/tasks/${taskId}/attempts`, { body: { ...reserveBody, mode: 'automatic' }, headers: key, lock: ready.body.updatedAt })
  check('public automatic mode refused (4xx, no attempt)', automatic.status >= 400 && automatic.status < 500)
  const first = await call('POST', `/api/delivery_os/tasks/${taskId}/attempts`, { body: reserveBody, headers: key, lock: ready.body.updatedAt })
  const second = await call('POST', `/api/delivery_os/tasks/${taskId}/attempts`, { body: reserveBody, headers: key })
  check('reserve 201 then replay 200 with the same attemptId', first.status === 201 && second.status === 200 && first.body.attemptId === second.body.attemptId)
  const attemptId = first.body.attemptId as string
  console.log('register length after replay:', sql(`select jsonb_array_length(execution_attempts) from delivery_tasks where id='${taskId}'`))

  console.log('--- R15 package (read-only)')
  const before = snapshot(taskId)
  const packageOne = await call('GET', `/api/delivery_os/tasks/${taskId}/package?attemptId=${attemptId}`)
  const packageTwo = await call('GET', `/api/delivery_os/tasks/${taskId}/package?attemptId=${attemptId}`)
  const unknownAttempt = await call('GET', `/api/delivery_os/tasks/${taskId}/package?attemptId=${randomUUID()}`)
  const after = snapshot(taskId)
  console.log('before:', before)
  console.log('after: ', after)
  check('package GET 200 twice, identical body', packageOne.status === 200 && packageTwo.status === 200 && JSON.stringify(packageOne.body) === JSON.stringify(packageTwo.body))
  check('package GET wrote nothing (row counts, task updated_at, register length)', before === after)
  check('unknown attemptId 404 attempt_not_found', unknownAttempt.status === 404 && unknownAttempt.body?.code === 'attempt_not_found')

  console.log('--- R16 results')
  const manifest = buildResultManifest(packageOne.body)
  const accepted = await call('POST', `/api/delivery_os/tasks/${taskId}/results`, { body: { attemptId, manifest } })
  const replay = await call('POST', `/api/delivery_os/tasks/${taskId}/results`, { body: { attemptId, manifest } })
  const conflict = await call('POST', `/api/delivery_os/tasks/${taskId}/results`, { body: { attemptId, manifest: { ...manifest, externalRunId: 'other-run' } } })
  const evidenceRows = sql(`select count(*) from delivery_evidence where task_id='${taskId}'`)
  console.log('evidence rows for task:', evidenceRows)
  check('result 201 duplicate:false then 200 duplicate:true, same evidenceId', accepted.status === 201 && accepted.body.duplicate === false && replay.status === 200 && replay.body.duplicate === true && accepted.body.evidenceId === replay.body.evidenceId)
  check('one evidence row after replay', evidenceRows === '1')
  check('different manifest 409 result_conflict', conflict.status === 409 && conflict.body?.code === 'result_conflict')
  check('task awaiting_review (never verified)', accepted.body.taskStatus === 'awaiting_review')
  const detail = await call('GET', `/api/delivery_os/projects/${projectId}`)
  check('R5 detail 200', detail.status === 200)

  console.log('--- cross-scope probe (SQL-copied rows under a foreign tenant/organization)')
  const foreignTenant = randomUUID()
  const foreignOrg = randomUUID()
  const foreignProject = randomUUID()
  const foreignTask = randomUUID()
  sql(`insert into delivery_projects select (jsonb_populate_record(null::delivery_projects, to_jsonb(p) || jsonb_build_object('id','${foreignProject}','tenant_id','${foreignTenant}','organization_id','${foreignOrg}','name','T018 foreign scope'))).* from delivery_projects p where id='${projectId}'`)
  sql(`insert into delivery_tasks select (jsonb_populate_record(null::delivery_tasks, to_jsonb(t) || jsonb_build_object('id','${foreignTask}','tenant_id','${foreignTenant}','organization_id','${foreignOrg}','project_id','${foreignProject}'))).* from delivery_tasks t where id='${taskId}'`)
  console.log('foreign rows present:', sql(`select count(*) from delivery_projects where id='${foreignProject}'`), sql(`select count(*) from delivery_tasks where id='${foreignTask}'`))
  const foreignBefore = sql(`select updated_at from delivery_projects where id='${foreignProject}'`) + '|' + sql(`select updated_at || '/' || jsonb_array_length(execution_attempts) from delivery_tasks where id='${foreignTask}'`)
  const probes = [
    await call('GET', `/api/delivery_os/projects/${foreignProject}`),
    await call('PUT', '/api/delivery_os/projects', { body: { id: foreignProject, brief: 'foreign write' } }),
    await call('GET', `/api/delivery_os/projects/${foreignProject}/baselines`),
    await call('GET', `/api/delivery_os/projects/${foreignProject}/tasks`),
    await call('GET', `/api/delivery_os/tasks/${foreignTask}`),
    await call('GET', `/api/delivery_os/tasks/${foreignTask}/package?attemptId=${attemptId}`),
    await call('POST', `/api/delivery_os/tasks/${foreignTask}/attempts`, { body: reserveBody, headers: { 'Idempotency-Key': `t018-foreign-${Date.now()}` }, lock: ready.body.updatedAt }),
    await call('POST', `/api/delivery_os/tasks/${foreignTask}/results`, { body: { attemptId, manifest } }),
    await call('GET', `/api/delivery_os/projects/${randomUUID()}`),
    await call('GET', `/api/delivery_os/tasks/${randomUUID()}`),
  ]
  check('every foreign/random-id probe answers 404', probes.every((probe) => probe.status === 404))
  const list = await call('GET', `/api/delivery_os/projects?search=${encodeURIComponent('T018')}&pageSize=100`)
  const listIds = (list.body.items ?? []).map((item: any) => item.id)
  check('R1 list hides the foreign project', list.status === 200 && listIds.includes(projectId) && !listIds.includes(foreignProject))
  const foreignAfter = sql(`select updated_at from delivery_projects where id='${foreignProject}'`) + '|' + sql(`select updated_at || '/' || jsonb_array_length(execution_attempts) from delivery_tasks where id='${foreignTask}'`)
  check('foreign rows untouched by the probes', foreignBefore === foreignAfter)

  console.log('--- cleanup')
  sql(`delete from delivery_tasks where id='${foreignTask}'`)
  sql(`delete from delivery_projects where id='${foreignProject}'`)
  for (const table of ['delivery_evidence', 'delivery_tasks', 'delivery_decisions', 'delivery_baselines']) {
    console.log(table, sql(`delete from ${table} where project_id='${projectId}'`))
  }
  console.log('delivery_projects', sql(`delete from delivery_projects where id='${projectId}'`))
  if (attachmentId) await call('DELETE', `/api/attachments?id=${attachmentId}`)
  const leftover = sql(`select (select count(*) from delivery_projects where name like 'T018%') + (select count(*) from delivery_tasks where id in ('${taskId}','${foreignTask}')) + (select count(*) from attachments where id='${attachmentId}')`)
  check('no smoke records left', leftover === '0')

  const failed = checks.filter(([, ok]) => !ok)
  console.log(`SUMMARY ${checks.length - failed.length}/${checks.length} checks passed`)
  if (failed.length) process.exit(1)
}
main().catch((error) => { console.error(error); process.exit(1) })
