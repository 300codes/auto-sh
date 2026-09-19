import { randomUUID } from 'node:crypto'
import { expect, type APIRequestContext } from '@playwright/test'
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import type { CommentImportBatchV1 } from '../lib/contracts'
import { API, approveStage, createPinnedProject, projectVersion, recordArtifact, scopeArtifact, type Call, type Registry } from './flowSpecKit'

export async function commentFixture(request: APIRequestContext, token: string, call: Call, registry: Registry) {
  const companyId = await createCompanyFixture(request, token, `Flow comments ${randomUUID()}`)
  let staffProjectId: string | null = null
  const cleanup = async () => {
    if (staffProjectId) await withClient(async (client) => {
      const ids = await client.query<{ id: string }>(`select id::text from staff_time_tasks where time_project_id = $1 union all select id::text from staff_time_task_comments where task_id in (select id from staff_time_tasks where time_project_id = $1) union all select id::text from staff_time_task_statuses where time_project_id = $1`, [staffProjectId])
      const resources = [staffProjectId, ...ids.rows.map((row) => row.id)]
      await client.query('delete from staff_command_idempotency where resource_id = any($1::uuid[])', [resources])
      await client.query('delete from staff_time_task_comments where task_id in (select id from staff_time_tasks where time_project_id = $1)', [staffProjectId])
      await client.query('delete from staff_time_tasks where time_project_id = $1', [staffProjectId])
      await client.query('delete from staff_time_task_statuses where time_project_id = $1', [staffProjectId])
      await client.query('delete from staff_time_project_members where time_project_id = $1', [staffProjectId])
      await client.query('delete from staff_time_projects where id = $1', [staffProjectId])
      for (const table of ['entity_indexes', 'search_tokens']) await client.query(`delete from ${table} where entity_type like 'staff:%' and entity_id = any($1::text[])`, [resources])
      await client.query(`delete from action_logs where resource_kind like 'staff%' and (resource_id = any($1::text[]) or parent_resource_id = any($1::text[]))`, [resources])
    })
    await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
  }
  try {
    const staff = await call('POST', '/api/staff/timesheets/time-projects', { body: { name: 'Comment import project', code: `flow-${randomUUID().slice(0, 8)}`, customerId: companyId, projectType: 'internal', status: 'active' } })
    expect(staff.status, JSON.stringify(staff.body)).toBe(201)
    staffProjectId = String(staff.body.id)
    const status = await call('POST', '/api/staff/timesheets/task-statuses', { body: { timeProjectId: staffProjectId, name: 'Inbox', slug: 'flow-inbox', isDefault: true, position: 0 } })
    expect(status.status, JSON.stringify(status.body)).toBe(201)
    const projectId = await createPinnedProject(call, registry, 'Flow comments')
    const scope = await recordArtifact(call, projectId, scopeArtifact(projectId))
    await approveStage(call, projectId, 'scope', scope)
    const linked = await call('PUT', `${API}/projects/${projectId}/staff-link`, { body: { staffProjectId }, lock: await projectVersion(call, projectId) })
    expect(linked.status, JSON.stringify(linked.body)).toBe(200)
    const batch: CommentImportBatchV1 = {
      schemaVersion: 'delivery.comment-import/v1', projectId, source: 'figma', fileKey: 'flow-fixture', stageId: 'ux', artifactId: null,
      fetchedAt: '2026-09-19T10:00:00.000Z', cursor: { after: null, next: 'cursor-1' },
      threads: [{ threadKey: 'thread-1', nodeId: '1:1', sourceUrl: 'https://www.figma.com/design/flow-fixture', author: { name: 'Client', email: null, externalId: 'client' }, body: 'Increase spacing', createdAt: '2026-09-19T09:00:00.000Z', updatedAt: null, status: 'open', figmaVersion: null,
        replies: [{ commentKey: 'reply-1', author: { name: 'Designer', email: null, externalId: 'designer' }, body: 'Will review', createdAt: '2026-09-19T09:30:00.000Z', editedAt: null, deleted: false }] }],
    }
    return { projectId, staffProjectId, scope, batch, cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}
