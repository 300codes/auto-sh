import { createHash, randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  deleteAttachmentIfExists,
  uploadAttachmentFixture,
} from '@open-mercato/core/helpers/integration/attachmentsFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { DELIVERY_SCHEMA_VERSIONS } from '../lib/contracts'
import { DELIVERY_PROJECT_ATTACHMENT_ENTITY_ID } from '../components/detail/screenUpload'
import {
  baselineCreateResponseSchema,
  decisionCreateResponseSchema,
  planImportResponseSchema,
  projectDetailSchema,
  projectUpdateResponseSchema,
  baselineListResponseSchema,
  taskListResponseSchema,
} from '../api/schemas'

/**
 * TC-DELIVERY-UI-003: both entries reach one approved baseline.
 *
 * FROM_BRIEF: project → requirements proposal → screen render → freeze →
 * two decisions → plan proposal → tasks exist and the MERGED baseline is NOT
 * active. FROM_DESIGN: project → screen first → a requirements manifest written
 * by a human → the same track. No reverse specification is performed anywhere:
 * the acceptance criteria are supplied, never derived from an image.
 *
 * Self-contained: every project is created here and archived by ITS OWN id in
 * `finally` — never "the first row of the list", which would destroy a record
 * this run never created (finding F2 of the UI-02 implementation review).
 *
 * Environment note: this spec was written against the live contracts but has
 * NOT been executed — the local database carries no `delivery_*` tables and
 * both `yarn db:migrate` and `yarn initialize` need separate approval. See the
 * UI-03 handoff.
 */

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const PNG_SHA256 = createHash('sha256').update(PNG_1X1).digest('hex')

type ProjectFixture = { id: string; updatedAt: string }

/** Everything this run created, cleaned up by id — never "the first row". */
type Created = { projectId: string | null; attachmentIds: string[] }

async function cleanup(request: APIRequestContext, token: string, created: Created): Promise<void> {
  if (created.projectId) await archiveProject(request, token, created.projectId)
  for (const attachmentId of created.attachmentIds) {
    await deleteAttachmentIfExists(request, token, attachmentId)
  }
}

async function createProject(
  request: APIRequestContext,
  token: string,
  inputMode: 'from_brief' | 'from_design',
  name: string,
): Promise<ProjectFixture> {
  const response = await apiRequest(request, 'POST', '/api/delivery_os/projects', {
    token,
    data: {
      name,
      inputMode,
      brief: `TC-DELIVERY-UI-003 fixture (${inputMode})`,
      targetProfileId: 'react-vite',
    },
  })
  expect(response.status(), `creating the ${inputMode} project`).toBe(201)
  const body = await readJsonSafe(response) as { id?: string; updatedAt?: string } | null
  expect(body?.id, 'the project create response must carry the new id').toBeTruthy()
  return { id: body!.id!, updatedAt: body!.updatedAt! }
}

async function archiveProject(request: APIRequestContext, token: string, projectId: string): Promise<void> {
  const detailResponse = await apiRequest(request, 'GET', `/api/delivery_os/projects/${projectId}`, { token })
  if (!detailResponse.ok()) return
  const detail = projectDetailSchema.parse(await readJsonSafe(detailResponse))
  if (detail.archivedAt || !detail.updatedAt) return
  await apiRequest(request, 'DELETE', `/api/delivery_os/projects?id=${projectId}`, {
    token,
    headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: detail.updatedAt },
  })
}

function requirementsManifest(projectId: string, manifestId: string) {
  return {
    schemaVersion: DELIVERY_SCHEMA_VERSIONS.requirementsProposal,
    projectId,
    manifestId,
    requirements: [
      { id: 'REQ-1', title: 'The catalogue lists the available services' },
      { id: 'REQ-2', title: 'A visitor can request a service' },
    ],
    acceptanceCriteria: [
      { id: 'AC-1', requirementId: 'REQ-1', description: 'The list renders every published service.' },
      { id: 'AC-2', requirementId: 'REQ-1', description: 'The filter narrows the list to the chosen category.' },
      { id: 'AC-3', requirementId: 'REQ-2', description: 'Submitting the form shows a confirmation.' },
    ],
    questions: [],
    risks: [],
    producedBy: { tool: 'claude-code', sessionRef: null },
  }
}

function planManifest(projectId: string, baselineId: string, baselineHash: string, manifestId: string) {
  return {
    schemaVersion: DELIVERY_SCHEMA_VERSIONS.planProposal,
    projectId,
    baselineId,
    baselineHash,
    manifestId,
    architectureSummary: 'One page, one store, no server state.',
    tasks: [
      {
        proposalTaskKey: 'T-1',
        title: 'Render the catalogue list',
        description: 'List the services with a category filter.',
        acIds: ['AC-1', 'AC-2'],
        dependsOn: [],
        allowedPaths: ['src/features/catalogue'],
      },
      {
        proposalTaskKey: 'T-2',
        title: 'Build the request form',
        description: 'A validated form with a confirmation state.',
        acIds: ['AC-3'],
        dependsOn: ['T-1'],
        allowedPaths: ['src/features/request'],
      },
    ],
    acTestMap: {
      'AC-1': ['tests/catalogue.spec.ts'],
      'AC-2': ['tests/catalogue.spec.ts'],
      'AC-3': ['tests/request.spec.ts'],
    },
    declaredTests: [
      { testId: 'tests/catalogue.spec.ts', file: 'tests/catalogue.spec.ts' },
      { testId: 'tests/request.spec.ts', file: 'tests/request.spec.ts' },
    ],
    producedBy: { tool: 'claude-code', sessionRef: null },
  }
}

/** Uploads the render the way the dialog does: multipart, scoped to the project. */
async function uploadRender(request: APIRequestContext, token: string, projectId: string): Promise<string> {
  const uploaded = await uploadAttachmentFixture(request, token, {
    entityId: DELIVERY_PROJECT_ATTACHMENT_ENTITY_ID,
    recordId: projectId,
    fileName: 'screen.png',
    mimeType: 'image/png',
    buffer: PNG_1X1,
  })
  return uploaded.id
}

/** Appends a screen through the full read → parse → replace cycle the UI performs. */
async function addScreen(
  request: APIRequestContext,
  token: string,
  project: ProjectFixture,
  attachmentId: string,
  name: string,
): Promise<string> {
  const detailResponse = await apiRequest(request, 'GET', `/api/delivery_os/projects/${project.id}`, { token })
  expect(detailResponse.ok(), 'reading the project before replacing its draft').toBe(true)
  const detail = projectDetailSchema.parse(await readJsonSafe(detailResponse))
  const draft = detail.draftSpec as Record<string, unknown>
  const screens = Array.isArray(draft.screens) ? draft.screens : []
  const response = await apiRequest(request, 'PUT', '/api/delivery_os/projects', {
    token,
    headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: detail.updatedAt! },
    data: {
      id: project.id,
      draftSpec: {
        ...draft,
        screens: [...screens, {
          name,
          fileKey: '5wOkFtN959W4MFmgRuaU8S',
          nodeId: '3:2',
          viewport: { width: 1440, height: 1024 },
          attachmentId,
          sha256: PNG_SHA256,
          capturedAt: new Date().toISOString(),
        }],
      },
    },
  })
  expect(response.status(), 'appending the screen to the draft').toBe(200)
  return projectUpdateResponseSchema.parse(await readJsonSafe(response)).updatedAt
}

async function decide(
  request: APIRequestContext,
  token: string,
  baselineId: string,
  projectVersion: string,
  body: Record<string, unknown>,
) {
  return apiRequest(request, 'POST', `/api/delivery_os/baselines/${baselineId}/decisions`, {
    token,
    headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: projectVersion },
    data: body,
  })
}

test.describe('TC-DELIVERY-UI-003: both entries reach one approved baseline', () => {
  test('TC-DELIVERY-UI-003a: FROM_BRIEF runs from a requirements proposal to tasks on an approved baseline', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const created: Created = { projectId: null, attachmentIds: [] }
    let project: ProjectFixture | null = null
    try {
      project = await createProject(request, token, 'from_brief', `Delivery UI-03 brief ${randomUUID()}`)
      created.projectId = project.id

      // 1. Requirements arrive as a proposal and are frozen as v1.
      const manifestId = `req-${randomUUID()}`
      const importResponse = await apiRequest(request, 'POST', `/api/delivery_os/projects/${project.id}/baselines`, {
        token,
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: project.updatedAt },
        data: { source: 'requirements_proposal', manifest: requirementsManifest(project.id, manifestId) },
      })
      expect(importResponse.status(), 'importing the requirements proposal').toBe(201)
      const imported = baselineCreateResponseSchema.parse(await readJsonSafe(importResponse))
      expect(imported.duplicate).toBe(false)
      let projectVersion = imported.projectUpdatedAt

      // 2. Replaying the SAME manifest is a success that writes nothing.
      const replayResponse = await apiRequest(request, 'POST', `/api/delivery_os/projects/${project.id}/baselines`, {
        token,
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: projectVersion },
        data: { source: 'requirements_proposal', manifest: requirementsManifest(project.id, manifestId) },
      })
      expect(replayResponse.status(), 'a replay answers 200, not 201').toBe(200)
      const replay = baselineCreateResponseSchema.parse(await readJsonSafe(replayResponse))
      expect(replay.duplicate).toBe(true)
      expect(replay.version, 'a replay must not create a second version').toBe(imported.version)

      // 3. The design render enters the draft and the draft is frozen as v2.
      const attachmentId = await uploadRender(request, token, project.id)
      created.attachmentIds.push(attachmentId)
      projectVersion = await addScreen(request, token, { ...project, updatedAt: projectVersion }, attachmentId, 'Service list')
      const freezeResponse = await apiRequest(request, 'POST', `/api/delivery_os/projects/${project.id}/baselines`, {
        token,
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: projectVersion },
        data: { source: 'manual' },
      })
      expect(freezeResponse.status(), 'freezing the draft with requirements and a render').toBe(201)
      const frozen = baselineCreateResponseSchema.parse(await readJsonSafe(freezeResponse))
      expect(frozen.version).toBeGreaterThan(imported.version)
      projectVersion = frozen.projectUpdatedAt

      // 4. A decision bound to a stale hash is refused as a subject mismatch.
      const staleResponse = await decide(request, token, frozen.baselineId, projectVersion, {
        kind: 'requirements',
        verdict: 'approved',
        subjectHash: 'f'.repeat(64),
        subjectVersion: frozen.version,
      })
      expect(staleResponse.status(), 'a decision on a hash that is not the stored one must be refused').toBe(409)

      // 5. Both decisions activate the version. One alone does not.
      const requirementsDecision = await decide(request, token, frozen.baselineId, projectVersion, {
        kind: 'requirements',
        verdict: 'approved',
        subjectHash: frozen.contentHash,
        subjectVersion: frozen.version,
      })
      expect(requirementsDecision.status()).toBe(201)
      const afterFirst = decisionCreateResponseSchema.parse(await readJsonSafe(requirementsDecision))
      expect(afterFirst.activeBaselineId, 'one approval must not activate the baseline').not.toBe(frozen.baselineId)
      projectVersion = afterFirst.projectUpdatedAt

      const designDecision = await decide(request, token, frozen.baselineId, projectVersion, {
        kind: 'design',
        verdict: 'approved',
        subjectHash: frozen.contentHash,
        subjectVersion: frozen.version,
      })
      expect(designDecision.status()).toBe(201)
      const afterBoth = decisionCreateResponseSchema.parse(await readJsonSafe(designDecision))
      expect(afterBoth.activeBaselineId, 'both approvals activate the baseline').toBe(frozen.baselineId)
      projectVersion = afterBoth.projectUpdatedAt

      // 6. A plan written for an OLDER baseline hash is refused.
      const stalePlan = await apiRequest(request, 'POST', `/api/delivery_os/projects/${project.id}/tasks`, {
        token,
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: projectVersion },
        data: {
          source: 'plan_proposal',
          manifest: planManifest(project.id, frozen.baselineId, 'e'.repeat(64), `plan-${randomUUID()}`),
        },
      })
      expect(stalePlan.status(), 'a plan quoting the wrong baseline hash must be refused').toBe(422)

      // 7. The plan creates tasks AND a merged baseline that is deliberately NOT active.
      const planResponse = await apiRequest(request, 'POST', `/api/delivery_os/projects/${project.id}/tasks`, {
        token,
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: projectVersion },
        data: {
          source: 'plan_proposal',
          manifest: planManifest(project.id, frozen.baselineId, frozen.contentHash, `plan-${randomUUID()}`),
        },
      })
      expect(planResponse.status(), 'importing the plan proposal').toBe(201)
      const plan = planImportResponseSchema.parse(await readJsonSafe(planResponse))
      expect(plan.tasks.length, 'the manifest declares two tasks').toBe(2)
      expect(plan.version, 'the merged baseline is the next version').toBeGreaterThan(frozen.version)

      const baselinesResponse = await apiRequest(request, 'GET', `/api/delivery_os/projects/${project.id}/baselines`, { token })
      const baselines = baselineListResponseSchema.parse(await readJsonSafe(baselinesResponse))
      const merged = baselines.items.find((baseline) => baseline.id === plan.baselineId)
      expect(merged, 'the merged baseline must be listed').toBeTruthy()
      expect(merged!.isActive, 'the merged baseline needs its OWN two decisions before it is active').toBe(false)
      expect(baselines.items.find((baseline) => baseline.id === frozen.baselineId)?.isActive).toBe(true)

      const tasksResponse = await apiRequest(request, 'GET', `/api/delivery_os/projects/${project.id}/tasks`, { token })
      const tasks = taskListResponseSchema.parse(await readJsonSafe(tasksResponse))
      expect(tasks.items.map((task) => task.proposalTaskKey).sort()).toEqual(['T-1', 'T-2'])
    } finally {
      await cleanup(request, token, created)
    }
  })

  test('TC-DELIVERY-UI-003b: FROM_DESIGN starts from approved screens and hand-written requirements', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const created: Created = { projectId: null, attachmentIds: [] }
    let project: ProjectFixture | null = null
    try {
      project = await createProject(request, token, 'from_design', `Delivery UI-03 design ${randomUUID()}`)
      created.projectId = project.id

      // Screens first: FROM_DESIGN begins from the design, not from a brief.
      const attachmentId = await uploadRender(request, token, project.id)
      created.attachmentIds.push(attachmentId)
      let projectVersion = await addScreen(request, token, project, attachmentId, 'Imported screen')

      // The requirements are WRITTEN BY A HUMAN and imported through the same
      // dialog path. Nothing here derives acceptance criteria from the image.
      const manual = requirementsManifest(project.id, `req-manual-${randomUUID()}`)
      const importResponse = await apiRequest(request, 'POST', `/api/delivery_os/projects/${project.id}/baselines`, {
        token,
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: projectVersion },
        data: { source: 'requirements_proposal', manifest: { ...manual, producedBy: { tool: 'human', sessionRef: null } } },
      })
      expect(importResponse.status(), 'importing the hand-written requirements').toBe(201)
      const imported = baselineCreateResponseSchema.parse(await readJsonSafe(importResponse))
      projectVersion = imported.projectUpdatedAt

      // The frozen baseline carries the screen the project started from.
      const baselinesResponse = await apiRequest(request, 'GET', `/api/delivery_os/projects/${project.id}/baselines`, { token })
      const baselines = baselineListResponseSchema.parse(await readJsonSafe(baselinesResponse))
      const frozen = baselines.items.find((baseline) => baseline.id === imported.baselineId)
      expect(frozen, 'the imported baseline must be listed').toBeTruthy()
      const content = frozen!.content as { screens?: unknown[] }
      expect(Array.isArray(content.screens) && content.screens.length, 'the screen travels into the baseline').toBe(1)

      // From here the track is identical: two decisions activate the version.
      for (const kind of ['requirements', 'design'] as const) {
        const response = await decide(request, token, imported.baselineId, projectVersion, {
          kind,
          verdict: 'approved',
          subjectHash: imported.contentHash,
          subjectVersion: imported.version,
        })
        expect(response.status(), `recording the ${kind} decision`).toBe(201)
        projectVersion = decisionCreateResponseSchema.parse(await readJsonSafe(response)).projectUpdatedAt
      }

      const afterResponse = await apiRequest(request, 'GET', `/api/delivery_os/projects/${project.id}/baselines`, { token })
      const after = baselineListResponseSchema.parse(await readJsonSafe(afterResponse))
      expect(after.items.find((baseline) => baseline.id === imported.baselineId)?.isActive).toBe(true)
    } finally {
      await cleanup(request, token, created)
    }
  })

  test('TC-DELIVERY-UI-003c: manifests with an unknown schema version or a foreign project are refused', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const created: Created = { projectId: null, attachmentIds: [] }
    let project: ProjectFixture | null = null
    try {
      project = await createProject(request, token, 'from_brief', `Delivery UI-03 negative ${randomUUID()}`)
      created.projectId = project.id

      const unknownVersion = await apiRequest(request, 'POST', `/api/delivery_os/projects/${project.id}/baselines`, {
        token,
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: project.updatedAt },
        data: {
          source: 'requirements_proposal',
          manifest: {
            ...requirementsManifest(project.id, `req-${randomUUID()}`),
            schemaVersion: 'delivery.requirements-proposal/v2',
          },
        },
      })
      expect(
        [400, 422],
        'an unknown schemaVersion must be refused, not silently accepted',
      ).toContain(unknownVersion.status())

      const foreignProject = await apiRequest(request, 'POST', `/api/delivery_os/projects/${project.id}/baselines`, {
        token,
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: project.updatedAt },
        data: {
          source: 'requirements_proposal',
          manifest: requirementsManifest(randomUUID(), `req-${randomUUID()}`),
        },
      })
      expect(
        [400, 422],
        'a manifest naming another project must be refused',
      ).toContain(foreignProject.status())
    } finally {
      await cleanup(request, token, created)
    }
  })
})
