import { createHash, randomUUID } from 'node:crypto'
import { request as playwrightRequest, type APIRequestContext, type APIResponse } from '@playwright/test'
import { z } from 'zod'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { baselineCreateResponseSchema, decisionCreateResponseSchema, projectCreateResponseSchema, projectDetailSchema, taskCreateResponseSchema, taskDtoSchema } from '@open-mercato/core/modules/delivery_os/api/schemas'
import { baselineContentV1Schema, reserveAttemptResponseSchema, taskPackageV1Schema } from '@open-mercato/core/modules/delivery_os/lib/contracts'
import baselineContentFixture from '../../modules/delivery_os/lib/fixtures/baseline-content.v1.json' with { type: 'json' }
import { draftSpecV1Schema } from '@open-mercato/core/modules/delivery_os/data/validators'
import { apiRequest, getAuthToken } from './api'
import { createOrganizationFixture, createRoleFixture, createUserFixture, setRoleAclFeatures } from './authFixtures'
import { uploadAttachmentFixture } from './attachmentsFixtures'
import { getTokenScope, readJsonSafe } from './generalFixtures'
import { createDeliveryFixtureLedger, type DeliveryFixtureResource } from './deliveryFixtureLedger'

const environmentSchema = z.object({
  environmentId: z.string().trim().min(1),
  baseUrl: z.url().refine((value) => {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash
  }),
  disposalPlan: z.string().trim().min(1),
  bootstrapEmail: z.email(),
  bootstrapPassword: z.string().min(1),
})
export type DeliveryFixtureEnvironment = z.infer<typeof environmentSchema>

const rowSchema = z.object({ id: z.uuid(), updatedAt: z.string().nullable().optional() }).passthrough()
const listSchema = z.object({ items: z.array(rowSchema) })
const aclSchema = z.object({ isSuperAdmin: z.boolean(), features: z.array(z.string()), organizations: z.array(z.string()).nullable() })
const scopeSchema = z.object({ tenantId: z.uuid(), organizationId: z.uuid() })
export type DeliveryFixtureScope = z.infer<typeof scopeSchema>
export type DeliveryFixtureActor = DeliveryFixtureScope & { userId: string; roleId: string; features: readonly string[] }

type RequestOptions = { data?: unknown; updatedAt?: string; idempotencyKey?: string; expectedStatus?: number; selectedOrganizationId?: string }
type ProjectFixture = DeliveryFixtureScope & { id: string; actor: DeliveryFixtureActor }
type ActorSession = DeliveryFixtureScope & { request: APIRequestContext; token: string }

const operatorFeatures = [
  'delivery_os.projects.view', 'delivery_os.projects.manage', 'delivery_os.baselines.approve',
  'delivery_os.results.import', 'delivery_os.attempts.manage', 'delivery_os.attempts.reconcile',
  'attachments.view', 'attachments.manage',
]
const restrictedFeatures = {
  viewer: ['delivery_os.projects.view'],
  manager: ['delivery_os.projects.view', 'delivery_os.projects.manage'],
  approver: ['delivery_os.projects.view', 'delivery_os.baselines.approve'],
  importer: ['delivery_os.projects.view', 'delivery_os.results.import'],
  attemptManager: ['delivery_os.projects.view', 'delivery_os.attempts.manage'],
  reconciler: ['delivery_os.projects.view', 'delivery_os.attempts.reconcile'],
}

export function readDeliveryFixtureEnvironment(): { ok: true; value: DeliveryFixtureEnvironment } | { ok: false; reason: string } {
  const parsed = environmentSchema.safeParse({
    environmentId: process.env.OM_DELIVERY_QA_ENVIRONMENT_ID,
    baseUrl: process.env.BASE_URL,
    disposalPlan: process.env.OM_DELIVERY_QA_DISPOSAL_PLAN,
    bootstrapEmail: process.env.OM_DELIVERY_QA_BOOTSTRAP_EMAIL,
    bootstrapPassword: process.env.OM_DELIVERY_QA_BOOTSTRAP_PASSWORD,
  })
  if (!parsed.success) return { ok: false, reason: 'not_run/environment: configure dedicated delivery QA environment, disposal plan and bootstrap credentials' }
  return { ok: true, value: parsed.data }
}

async function requireResponse(response: APIResponse, expected: number[]): Promise<void> {
  if (!expected.includes(response.status())) {
    throw new Error(`[internal] Delivery fixture HTTP status ${response.status()}, expected ${expected.join('/')}`)
  }
}

async function parsedResponse<Output>(response: APIResponse, schema: z.ZodType<Output>, expected = [200]): Promise<Output> {
  await requireResponse(response, expected)
  const parsed = schema.safeParse(await readJsonSafe(response))
  if (!parsed.success) throw new Error('[internal] Delivery fixture response did not match its contract')
  return parsed.data
}

export async function createDeliveryFixtureSession(
  environment: DeliveryFixtureEnvironment,
  identity: { runId: string; testId: string; retry: number },
  afterCreate?: (resource: DeliveryFixtureResource) => void,
) {
  const config = environmentSchema.parse(environment)
  if (!process.env.BASE_URL || new URL(process.env.BASE_URL).origin !== new URL(config.baseUrl).origin) {
    throw new Error('[internal] Delivery fixture BASE_URL differs from its dedicated environment')
  }
  const label = `${identity.runId.slice(0, 12)}-${identity.testId.slice(0, 18)}-retry${identity.retry}`.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 45)
  const namespace = `${label}-${randomUUID()}`
  const bootstrap = await playwrightRequest.newContext({ baseURL: config.baseUrl, maxRedirects: 0 })
  let bootstrapToken: string
  try {
    bootstrapToken = await getAuthToken(bootstrap, config.bootstrapEmail, config.bootstrapPassword)
  } catch {
    await bootstrap.dispose()
    throw new Error('[internal] Delivery fixture bootstrap login failed')
  }
  const ledger = createDeliveryFixtureLedger()
  const sessions = new Map<string, ActorSession>()
  const scopes: Partial<Record<'A1' | 'A2' | 'B1', DeliveryFixtureScope>> = {}
  const operators: Partial<Record<'A1' | 'A2' | 'B1', DeliveryFixtureActor>> = {}
  const actors: Partial<Record<keyof typeof restrictedFeatures, DeliveryFixtureActor>> = {}
  const projects: Partial<Record<'A1' | 'A2' | 'B1', ProjectFixture>> = {}
  const ownedTasks = new Map<string, { actor: DeliveryFixtureActor; projectId: string }>()
  const neverDispatchedAttempts = new Set<string>()
  const unmanagedMutations: Array<{ method: string; path: string; status: number | null; ids: string[] }> = []
  let provisioned = false

  function registered(resource: DeliveryFixtureResource, dependencies: string[], cleanup: () => Promise<void>, retained = true): void {
    ledger.register(resource, dependencies, cleanup, retained)
    afterCreate?.({ ...resource })
  }

  function scopeFor(key: 'A1' | 'A2' | 'B1'): DeliveryFixtureScope {
    const scope = scopes[key]
    if (!scope) throw new Error('[internal] Delivery fixture scope is not provisioned')
    return scope
  }

  function sessionFor(actor: DeliveryFixtureActor): ActorSession {
    const session = sessions.get(actor.userId)
    if (!session || session.tenantId !== actor.tenantId || session.organizationId !== actor.organizationId) throw new Error('[internal] Unknown delivery fixture actor or scope')
    return session
  }

  async function request(actor: DeliveryFixtureActor, method: string, path: string, options: RequestOptions = {}) {
    if (!path.startsWith('/api/')) throw new Error('[internal] Delivery fixture requests must use API paths')
    const session = sessionFor(actor)
    let response: APIResponse
    try {
      response = await apiRequest(session.request, method, path, {
        token: session.token, data: options.data, retryTransport: false,
        headers: {
          Cookie: `om_selected_org=${options.selectedOrganizationId ? z.uuid().parse(options.selectedOrganizationId) : actor.organizationId}; om_selected_tenant=${actor.tenantId}`,
          ...(options.updatedAt ? { [OPTIMISTIC_LOCK_HEADER_NAME]: options.updatedAt } : {}),
          ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
        },
      })
    } catch (error) {
      if (method !== 'GET') unmanagedMutations.push({ method, path, status: null, ids: [] })
      throw error
    }
    if (options.expectedStatus && options.expectedStatus >= 400 && response.ok() && method !== 'GET') {
      const mutation = { method, path, status: response.status(), ids: [] as string[] }
      unmanagedMutations.push(mutation)
      const body = z.object({ id: z.uuid().optional(), attemptId: z.uuid().optional(), baselineId: z.uuid().optional(), evidenceId: z.uuid().optional() }).safeParse(await readJsonSafe(response))
      mutation.ids = body.success ? Object.values(body.data).filter((value): value is string => typeof value === 'string') : []
    }
    return response
  }

  async function adminRequest(method: string, path: string, tenantId?: string, data?: unknown, updatedAt?: string) {
    return apiRequest(bootstrap, method, path, {
      token: bootstrapToken, data, retryTransport: false,
      headers: {
        Cookie: tenantId ? `om_selected_tenant=${tenantId}` : '',
        ...(updatedAt ? { [OPTIMISTIC_LOCK_HEADER_NAME]: updatedAt } : {}),
      },
    })
  }

  async function cleanupDirectory(resource: DeliveryFixtureResource, path: string, query: string): Promise<void> {
    const read = () => adminRequest('GET', `${path}?${query}`, resource.tenantId)
    const before = await parsedResponse(await read(), listSchema)
    const record = before.items.find((item) => item.id === resource.id)
    if (!record) return
    await requireResponse(await adminRequest('DELETE', `${path}?id=${resource.id}`, resource.tenantId, undefined, record.updatedAt ?? undefined), [200])
    const after = await parsedResponse(await read(), listSchema)
    if (after.items.some((item) => item.id === resource.id)) throw new Error('[internal] Delivery fixture directory cleanup was not effective')
  }

  async function createTenant(key: string): Promise<string> {
    const created = await parsedResponse(await adminRequest('POST', '/api/directory/tenants', undefined, { name: `${namespace}-${key}` }), rowSchema, [201])
    const resource: DeliveryFixtureResource = { kind: 'tenant', id: created.id }
    registered(resource, [], () => cleanupDirectory(resource, '/api/directory/tenants', `id=${created.id}`))
    return created.id
  }

  async function createOrganization(tenantId: string, key: 'A1' | 'A2' | 'B1') {
    const id = await createOrganizationFixture(bootstrap, bootstrapToken, { tenantId, name: `${namespace}-${key}` })
    const scope = { tenantId, organizationId: id }
    scopes[key] = scope
    const resource: DeliveryFixtureResource = { ...scope, id, kind: 'organization' }
    registered(resource, [tenantId], () => cleanupDirectory(resource, '/api/directory/organizations', `view=manage&tenantId=${tenantId}&ids=${id}`))
  }

  async function createActor(scope: DeliveryFixtureScope, name: string, features: string[]): Promise<DeliveryFixtureActor> {
    const roleId = await createRoleFixture(bootstrap, bootstrapToken, { tenantId: scope.tenantId, name: `${namespace}-${name}` })
    const roleResource: DeliveryFixtureResource = { ...scope, id: roleId, kind: 'role' }
    registered(roleResource, [scope.organizationId], () => cleanupDirectory(roleResource, '/api/auth/roles', `id=${roleId}&tenantId=${scope.tenantId}`), false)
    await setRoleAclFeatures(bootstrap, bootstrapToken, { roleId, features, organizations: [scope.organizationId] })
    const acl = await parsedResponse(await adminRequest('GET', `/api/auth/roles/acl?roleId=${roleId}&tenantId=${scope.tenantId}`, scope.tenantId), aclSchema)
    if (acl.isSuperAdmin || JSON.stringify([...acl.features].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))) !== JSON.stringify([...features].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))) || JSON.stringify(acl.organizations) !== JSON.stringify([scope.organizationId])) {
      throw new Error('[internal] Delivery fixture role ACL differs from the requested least-privilege grant')
    }
    const email = `${randomUUID()}@delivery-fixture.invalid`
    const password = `Qa-${randomUUID()}-${randomUUID()}`
    const userId = await createUserFixture(bootstrap, bootstrapToken, { email, password, organizationId: scope.organizationId, roles: [roleId], name: `${namespace}-${name}` })
    const userResource: DeliveryFixtureResource = { ...scope, id: userId, kind: 'user' }
    registered(userResource, [roleId, scope.organizationId], () => cleanupDirectory(userResource, '/api/auth/users', `id=${userId}`), false)
    const context = await playwrightRequest.newContext({ baseURL: config.baseUrl, maxRedirects: 0 })
    try {
      const token = await getAuthToken(context, email, password)
      const tokenScope = getTokenScope(token)
      if (tokenScope.userId !== userId || tokenScope.tenantId !== scope.tenantId || tokenScope.organizationId !== scope.organizationId) {
        throw new Error('[internal] Delivery fixture actor scope differs from provisioning')
      }
      sessions.set(userId, { ...scope, request: context, token })
    } catch {
      await context.dispose()
      throw new Error('[internal] Delivery fixture actor login or scope validation failed')
    }
    return { ...scope, userId, roleId, features: [...features] }
  }

  async function readProject(project: ProjectFixture) {
    return parsedResponse(await request(project.actor, 'GET', `/api/delivery_os/projects/${project.id}`), projectDetailSchema)
  }

  async function createProject(actor: DeliveryFixtureActor, suffix: string, options: { inputMode?: 'from_brief' | 'from_design' } = {}): Promise<ProjectFixture> {
    const created = await parsedResponse(await request(actor, 'POST', '/api/delivery_os/projects', {
      data: { name: `${namespace}-${suffix}`, inputMode: options.inputMode ?? 'from_brief', targetProfileId: 'react-vite', targetProfileVersion: 1 },
    }), projectCreateResponseSchema, [201])
    const project = { id: created.id, actor, tenantId: actor.tenantId, organizationId: actor.organizationId }
    registered({ kind: 'project', id: project.id, tenantId: actor.tenantId, organizationId: actor.organizationId }, [actor.userId], async () => {
      const before = await readProject(project)
      if (!before.archivedAt) {
        if (!before.updatedAt) throw new Error('[internal] Project cleanup requires its current version')
        await requireResponse(await request(actor, 'DELETE', `/api/delivery_os/projects?id=${project.id}`, { updatedAt: before.updatedAt }), [200])
      }
      if (!(await readProject(project)).archivedAt) throw new Error('[internal] Project was not archived')
    })
    return project
  }

  async function uploadDraft(project: ProjectFixture) {
    const session = sessionFor(project.actor)
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64')
    const uploaded = await uploadAttachmentFixture(session.request, session.token, {
      entityId: 'delivery_os:delivery_project', recordId: project.id,
      fileName: `${namespace}.png`, mimeType: 'image/png', buffer: bytes,
    })
    registered({ kind: 'attachment', id: uploaded.id, tenantId: project.tenantId, organizationId: project.organizationId }, [project.actor.userId], async () => {
      if (!(await readProject(project)).archivedAt) throw new Error('[internal] Attachment cleanup requires its project to be archived')
      const path = `/api/attachments?entityId=delivery_os:delivery_project&recordId=${project.id}`
      const before = await parsedResponse(await request(project.actor, 'GET', path), listSchema)
      if (!before.items.some((item) => item.id === uploaded.id)) return
      await requireResponse(await request(project.actor, 'DELETE', `/api/attachments?id=${uploaded.id}`), [200])
      const after = await parsedResponse(await request(project.actor, 'GET', path), listSchema)
      if (after.items.some((item) => item.id === uploaded.id)) throw new Error('[internal] Attachment cleanup was not effective')
    }, false)
    const content = baselineContentV1Schema.parse(baselineContentFixture)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const draft = draftSpecV1Schema.parse({
      ...content,
      screens: content.screens.map((screen) => ({ ...screen, attachmentId: uploaded.id, sha256, capturedAt: new Date().toISOString() })),
      attachments: [{ attachmentId: uploaded.id, sha256 }],
    })
    const current = await readProject(project)
    if (!current.updatedAt) throw new Error('[internal] Draft requires project version')
    await requireResponse(await request(project.actor, 'PUT', '/api/delivery_os/projects', { data: { id: project.id, draftSpec: draft }, updatedAt: current.updatedAt }), [200])
    return draft
  }

  async function freezeBaseline(project: ProjectFixture) {
    const current = await readProject(project)
    const baseline = await parsedResponse(await request(project.actor, 'POST', `/api/delivery_os/projects/${project.id}/baselines`, {
      data: { source: 'manual' }, updatedAt: current.updatedAt ?? undefined,
    }), baselineCreateResponseSchema, [201])
    ledger.retain({ kind: 'baseline', id: baseline.baselineId, tenantId: project.tenantId, organizationId: project.organizationId })
    return baseline
  }

  async function decideBaseline(project: ProjectFixture, baseline: { baselineId: string; contentHash: string; version: number }, kind: 'requirements' | 'design', verdict: 'approved' | 'rejected' = 'approved') {
    const current = await readProject(project)
    const decision = await parsedResponse(await request(project.actor, 'POST', `/api/delivery_os/baselines/${baseline.baselineId}/decisions`, {
      updatedAt: current.updatedAt ?? undefined,
      data: { kind, verdict, subjectHash: baseline.contentHash, subjectVersion: baseline.version, ...(verdict === 'rejected' ? { reason: 'Fixture decision explicitly rejects this baseline' } : {}) },
    }), decisionCreateResponseSchema, [201])
    ledger.retain({ kind: 'decision', id: decision.decisionId, tenantId: project.tenantId, organizationId: project.organizationId })
    return decision
  }

  async function prepareBaseline(project: ProjectFixture, options: { decisions?: Array<'requirements' | 'design'> } = {}) {
    await uploadDraft(project)
    const baseline = await freezeBaseline(project)
    for (const kind of options.decisions ?? ['requirements', 'design']) await decideBaseline(project, baseline, kind)
    return baseline
  }

  async function readTask(actor: DeliveryFixtureActor, taskId: string) {
    return parsedResponse(await request(actor, 'GET', `/api/delivery_os/tasks/${taskId}`), taskDtoSchema)
  }

  async function createTask(project: ProjectFixture, baselineId: string, dependsOnTaskIds: string[] = []) {
    if (dependsOnTaskIds.some((id) => ownedTasks.get(id)?.projectId !== project.id)) throw new Error('[internal] Fixture task dependency is not owned by this project')
    const created = await parsedResponse(await request(project.actor, 'POST', `/api/delivery_os/projects/${project.id}/tasks`, {
      data: { source: 'manual', baselineId, title: `${namespace}-task`, acIds: ['AC-001'], allowedPaths: ['src/**'], dependsOnTaskIds },
    }), taskCreateResponseSchema, [201])
    registerOwnedTask(project, created.id, dependsOnTaskIds)
    return created
  }

  function registerOwnedTask(project: ProjectFixture, taskId: string, dependsOnTaskIds: string[]): void {
    ownedTasks.set(taskId, { actor: project.actor, projectId: project.id })
    registered({ kind: 'task', id: taskId, tenantId: project.tenantId, organizationId: project.organizationId }, [project.id, ...dependsOnTaskIds], async () => {
      let task = await readTask(project.actor, taskId)
      for (const attempt of task.executionAttempts) {
        if (attempt.state === 'closed' || attempt.state === 'result_received') continue
        if (!neverDispatchedAttempts.has(attempt.attemptId) || attempt.mode !== 'manual_handoff' || attempt.claimedAt || attempt.dispatchedAt || attempt.externalRunId || attempt.workflowRef || attempt.workerRef || attempt.state !== 'reserved') {
          throw new Error('[internal] Fixture cleanup requires real reconciliation of an unknown execution')
        }
        await requireResponse(await request(project.actor, 'POST', `/api/delivery_os/tasks/${task.id}/attempts/${attempt.attemptId}/reconcile`, {
          updatedAt: task.updatedAt,
          data: { resolution: 'not_started', externalEvidence: { note: 'QA fixture reserved this attempt and never dispatched an executor', observedAt: new Date().toISOString() } },
        }), [200])
        task = await readTask(project.actor, taskId)
      }
      if (!task.archivedAt) await requireResponse(await request(project.actor, 'DELETE', `/api/delivery_os/tasks?id=${task.id}`, { updatedAt: task.updatedAt }), [200])
      const after = await readTask(project.actor, taskId)
      if (!after.archivedAt || after.executionAttempts.some((attempt) => ['reserved', 'claimed', 'cancel_requested', 'reconciliation_required'].includes(attempt.state))) {
        throw new Error('[internal] Task cleanup left an active resource')
      }
    })
  }

  async function trackTasks(project: ProjectFixture, taskIds: string[]): Promise<void> {
    const pendingMutation = { method: 'POST', path: `/api/delivery_os/projects/${project.id}/tasks`, status: 201, ids: [...taskIds] }
    unmanagedMutations.push(pendingMutation)
    const pending = new Map<string, z.infer<typeof taskDtoSchema>>()
    for (const taskId of taskIds) {
      const task = await readTask(project.actor, taskId)
      if (task.projectId !== project.id) throw new Error('[internal] Imported task belongs to another fixture project')
      if (ownedTasks.has(task.id)) {
        if (ownedTasks.get(task.id)?.projectId !== project.id) throw new Error('[internal] Imported task conflicts with fixture ownership')
      } else pending.set(task.id, task)
    }
    while (pending.size > 0) {
      const next = [...pending.values()].find((task) => task.dependsOnTaskIds.every((id) => ownedTasks.get(id)?.projectId === project.id))
      if (!next) throw new Error('[internal] Imported task dependency is cyclic or not owned by this fixture')
      registerOwnedTask(project, next.id, next.dependsOnTaskIds)
      pending.delete(next.id)
    }
    unmanagedMutations.splice(unmanagedMutations.indexOf(pendingMutation), 1)
  }

  async function reserveNeverDispatched(taskId: string) {
    const owned = ownedTasks.get(taskId)
    if (!owned) throw new Error('[internal] Cannot reserve a task outside this fixture')
    let task = await readTask(owned.actor, taskId)
    if (task.status !== 'ready' && task.status !== 'changes_requested') {
      if (task.status !== 'draft' && task.status !== 'blocked') throw new Error('[internal] Fixture task is not ready for a new manual reservation')
      await requireResponse(await request(owned.actor, 'PUT', '/api/delivery_os/tasks', { data: { id: taskId, status: 'ready' }, updatedAt: task.updatedAt }), [200])
      task = await readTask(owned.actor, taskId)
    }
    const result = await parsedResponse(await request(owned.actor, 'POST', `/api/delivery_os/tasks/${taskId}/attempts`, {
      updatedAt: task.updatedAt, idempotencyKey: `fixture-${randomUUID()}`,
      data: { mode: 'manual_handoff', baseRevision: { kind: 'git', commitSha: createHash('sha1').update(namespace).digest('hex') } },
    }), reserveAttemptResponseSchema, [201])
    await trackNeverDispatchedAttempt(taskId, result.attemptId)
    const taskPackage = await parsedResponse(await request(owned.actor, 'GET', result.packageUrl), taskPackageV1Schema)
    return { ...result, taskPackage }
  }

  async function trackNeverDispatchedAttempt(taskId: string, attemptId: string): Promise<void> {
    const owned = ownedTasks.get(taskId)
    if (!owned) throw new Error('[internal] Cannot track an attempt outside this fixture')
    const task = await readTask(owned.actor, taskId)
    const attempt = task.executionAttempts.find((entry) => entry.attemptId === attemptId)
    if (!attempt || attempt.mode !== 'manual_handoff' || attempt.state !== 'reserved' || attempt.claimedAt || attempt.dispatchedAt || attempt.externalRunId || attempt.workflowRef || attempt.workerRef) {
      throw new Error('[internal] Only a reserved manual fixture attempt can be tracked as never dispatched')
    }
    if (!neverDispatchedAttempts.has(attemptId)) {
      neverDispatchedAttempts.add(attemptId)
      ledger.retain({ kind: 'attempt', id: attemptId, tenantId: owned.actor.tenantId, organizationId: owned.actor.organizationId })
    }
  }

  return {
    namespace, scopes, operators, actors, projects, ledger, unmanagedMutations, request, readProject, readTask,
    createProject, createActor, uploadDraft, freezeBaseline, decideBaseline, prepareBaseline, createTask, trackTasks, reserveNeverDispatched, trackNeverDispatchedAttempt,
    environment: { environmentId: config.environmentId, baseUrl: config.baseUrl, disposalPlan: config.disposalPlan },
    async provisionControl(): Promise<ProjectFixture> {
      if (provisioned) throw new Error('[internal] Delivery fixture cannot be provisioned twice')
      provisioned = true
      const tenantId = await createTenant('control')
      await createOrganization(tenantId, 'A1')
      const actor = await createActor(scopeFor('A1'), 'control-operator', operatorFeatures)
      operators.A1 = actor
      const project = await createProject(actor, 'control')
      projects.A1 = project
      return project
    },
    async provision(): Promise<void> {
      if (provisioned) throw new Error('[internal] Delivery fixture cannot be provisioned twice')
      provisioned = true
      const tenantA = await createTenant('A')
      const tenantB = await createTenant('B')
      await createOrganization(tenantA, 'A1')
      await createOrganization(tenantA, 'A2')
      await createOrganization(tenantB, 'B1')
      for (const key of ['A1', 'A2', 'B1'] as const) {
        const actor = await createActor(scopeFor(key), `${key}-operator`, operatorFeatures)
        operators[key] = actor
        projects[key] = await createProject(actor, key)
      }
      for (const name of Object.keys(restrictedFeatures) as Array<keyof typeof restrictedFeatures>) {
        actors[name] = await createActor(scopeFor('A1'), name, restrictedFeatures[name])
      }
    },
    async dispose(): Promise<void> {
      const results = await Promise.allSettled([
        ...[...sessions.values()].map((session) => session.request.dispose()),
        bootstrap.dispose(),
      ])
      if (results.some((result) => result.status === 'rejected')) throw new Error('[internal] Delivery fixture request context disposal failed')
    },
  }
}
