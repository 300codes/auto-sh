import { createHash, randomUUID } from 'node:crypto'
import { expect, type APIRequestContext } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { uploadAttachmentFixture, deleteAttachmentIfExists } from '@open-mercato/core/helpers/integration/attachmentsFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { projectCreateResponseSchema, projectDetailSchema, projectUpdateResponseSchema, baselineCreateResponseSchema, decisionCreateResponseSchema, taskCreateResponseSchema, taskUpdateResponseSchema, resultAcceptResponseSchema } from '../../api/schemas'
import { reserveAttemptResponseSchema, taskPackageV1Schema, type SourceRevision } from '../../lib/contracts'
import { buildResultManifest } from '../../lib/fixtures/builders'

export const reportFixturePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
export const reportFixtureHash = createHash('sha256').update(reportFixturePng).digest('hex')
export type ReportFixtureResources = { projectId?: string; attachmentIds: string[] }

export async function reportProjectVersion(request: APIRequestContext, token: string, projectId: string) {
  const response = await apiRequest(request, 'GET', `/api/delivery_os/projects/${projectId}`, { token })
  expect(response.status()).toBe(200)
  return projectDetailSchema.parse(await readJsonSafe(response)).updatedAt!
}

export async function setupReportFixture(request: APIRequestContext, token: string, resources: ReportFixtureResources, profile: 'react-vite' | 'wordpress-theme') {
  const created = await apiRequest(request, 'POST', '/api/delivery_os/projects', { token, data: {
    name: `TC-DELIVERY-REPORT ${randomUUID()}`, inputMode: 'from_design', targetProfileId: profile,
  } })
  expect(created.status()).toBe(201)
  const project = projectCreateResponseSchema.parse(await readJsonSafe(created))
  resources.projectId = project.id
  const attachment = await uploadAttachmentFixture(request, token, {
    entityId: 'delivery_os:project', recordId: project.id, fileName: 'report-source.png', mimeType: 'image/png', buffer: reportFixturePng,
  })
  resources.attachmentIds.push(attachment.id)
  const updated = await apiRequest(request, 'PUT', '/api/delivery_os/projects', { token,
    headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: project.updatedAt }, data: { id: project.id, draftSpec: {
      requirements: [{ id: 'REQ-1', title: 'The page shows the service' }],
      acceptanceCriteria: [{ id: 'AC-1', requirementId: 'REQ-1', description: 'The service is visible' }],
      acTestMap: { 'AC-1': ['tests/service.spec.ts'] }, declaredTests: [{ testId: 'tests/service.spec.ts', file: 'tests/service.spec.ts' }],
      screens: [{ name: 'Fixture screen', fileKey: 'integration-fixture', nodeId: '1:1', viewport: { width: 1, height: 1 }, attachmentId: attachment.id, sha256: reportFixtureHash, capturedAt: new Date().toISOString() }],
    } },
  })
  expect(updated.status()).toBe(200)
  const version = projectUpdateResponseSchema.parse(await readJsonSafe(updated)).updatedAt
  const frozen = await apiRequest(request, 'POST', `/api/delivery_os/projects/${project.id}/baselines`, {
    token, headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: version }, data: { source: 'manual' },
  })
  expect(frozen.status()).toBe(201)
  const baseline = baselineCreateResponseSchema.parse(await readJsonSafe(frozen))
  let projectVersion = baseline.projectUpdatedAt
  for (const kind of ['requirements', 'design'] as const) {
    const response = await apiRequest(request, 'POST', `/api/delivery_os/baselines/${baseline.baselineId}/decisions`, {
      token, headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: projectVersion },
      data: { kind, verdict: 'approved', subjectHash: baseline.contentHash, subjectVersion: baseline.version },
    })
    expect(response.status()).toBe(201)
    projectVersion = decisionCreateResponseSchema.parse(await readJsonSafe(response)).projectUpdatedAt
  }
  return { projectId: project.id, baselineId: baseline.baselineId, attachmentId: attachment.id }
}

export async function importReportResult(request: APIRequestContext, token: string, fixture: { projectId: string; baselineId: string }, revision: SourceRevision) {
  const created = await apiRequest(request, 'POST', `/api/delivery_os/projects/${fixture.projectId}/tasks`, {
    token, data: { source: 'manual', baselineId: fixture.baselineId, title: 'Integration fixture task', acIds: ['AC-1'], allowedPaths: ['tests/**'] },
  })
  expect(created.status()).toBe(201)
  const task = taskCreateResponseSchema.parse(await readJsonSafe(created))
  const ready = await apiRequest(request, 'PUT', '/api/delivery_os/tasks', {
    token, headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: task.updatedAt }, data: { id: task.id, status: 'ready' },
  })
  expect(ready.status()).toBe(200)
  const readyTask = taskUpdateResponseSchema.parse(await readJsonSafe(ready))
  const reserved = await apiRequest(request, 'POST', `/api/delivery_os/tasks/${task.id}/attempts`, {
    token, headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: readyTask.updatedAt, 'Idempotency-Key': randomUUID() },
    data: { mode: 'manual_handoff', baseRevision: revision },
  })
  expect(reserved.status()).toBe(201)
  const attempt = reserveAttemptResponseSchema.parse(await readJsonSafe(reserved))
  const exported = await apiRequest(request, 'GET', `/api/delivery_os/tasks/${task.id}/package?attemptId=${attempt.attemptId}`, { token })
  expect(exported.status()).toBe(200)
  const taskPackage = taskPackageV1Schema.parse(await readJsonSafe(exported))
  const manifest = buildResultManifest(taskPackage, { resultRevision: revision })
  const imported = await apiRequest(request, 'POST', `/api/delivery_os/tasks/${task.id}/results`, {
    token, headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: attempt.taskUpdatedAt }, data: { attemptId: attempt.attemptId, manifest },
  })
  expect(imported.status()).toBe(201)
  return { manifest, result: resultAcceptResponseSchema.parse(await readJsonSafe(imported)) }
}

export async function cleanupReportFixture(request: APIRequestContext, token: string, resources: ReportFixtureResources) {
  if (resources.projectId) {
    const updatedAt = await reportProjectVersion(request, token, resources.projectId)
    const archived = await apiRequest(request, 'DELETE', `/api/delivery_os/projects?id=${resources.projectId}`, {
      token, headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: updatedAt },
    })
    expect(archived.ok(), 'retain attachments if their owning project could not be archived').toBe(true)
  }
  const attachmentIds = [...resources.attachmentIds]
  const outcomes = await Promise.allSettled(attachmentIds.map((attachmentId) => deleteAttachmentIfExists(request, token, attachmentId)))
  const failures: unknown[] = []
  outcomes.forEach((outcome, index) => {
    if (outcome.status === 'rejected') failures.push(outcome.reason)
    else resources.attachmentIds.splice(resources.attachmentIds.indexOf(attachmentIds[index]), 1)
  })
  if (failures.length > 0) throw new AggregateError(failures, '[internal] report_fixture_attachment_cleanup_failed')
}
