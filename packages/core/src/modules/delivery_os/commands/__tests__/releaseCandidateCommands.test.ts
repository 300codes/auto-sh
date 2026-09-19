/** @jest-environment node */
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findWithDecryption: jest.fn() }))
jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({ emitCrudSideEffects: jest.fn(async () => undefined) }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: jest.fn(async () => ({ translate: (key: string) => key })) }))
jest.mock('../reportQueries', () => ({ createDeliveryOsReportQueries: jest.fn() }))
jest.mock('../shared', () => ({
  ...jest.requireActual('../shared'),
  lockProjectForWrite: jest.fn(), lockScopedProjectTasks: jest.fn(async () => []), requireLockHeader: jest.fn(),
  resolveDeliveryEm: jest.fn(), requireActorUserId: jest.fn(() => '88888888-8888-4888-8888-888888888888'),
}))
import '../candidates'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { lockProjectForWrite, lockScopedProjectTasks, requireLockHeader, resolveDeliveryEm } from '../shared'
import { createDeliveryOsReportQueries } from '../reportQueries'
import { DeliveryReleaseCandidate } from '../../data/entities'
import type { DeliveryReportResponse } from '../../lib/reportContracts'
const projectId = '11111111-1111-4111-8111-111111111111'
const baselineId = '22222222-2222-4222-8222-222222222222'
const evidenceId = '33333333-3333-4333-8333-333333333333'
const scope = { tenantId: '44444444-4444-4444-8444-444444444444', organizationId: '55555555-5555-4555-8555-555555555555' }
const revision = { kind: 'git' as const, commitSha: 'b'.repeat(40) }
const input = { projectId, baselineId, sourceRevision: revision, evidenceIds: [evidenceId] }
const em = { transactional: jest.fn(), create: jest.fn((_entity, data) => ({ id: '66666666-6666-4666-8666-666666666666', ...data })), persist: jest.fn(), flush: jest.fn(async () => undefined) }
const ctx = { auth: { tenantId: scope.tenantId, orgId: scope.organizationId }, selectedOrganizationId: scope.organizationId, container: { resolve: () => ({}) } } as unknown as CommandRuntimeContext
const buildReport = jest.fn()
const execute = () => commandRegistry.get('delivery_os.release_candidates.nominate')!.execute(input, ctx)
beforeEach(() => {
  jest.clearAllMocks()
  em.transactional.mockImplementation(async (work) => work(em))
  jest.mocked(resolveDeliveryEm).mockReturnValue(em as never)
  jest.mocked(lockProjectForWrite).mockResolvedValue({ id: projectId, activeBaselineId: baselineId, updatedAt: new Date('2026-09-19T12:00:00.000Z') } as never)
  jest.mocked(createDeliveryOsReportQueries).mockReturnValue({ buildReport })
  buildReport.mockResolvedValue({ baselineHash: 'a'.repeat(64), gates: { publishable: { ok: true } }, mode: 'legacy', currentCandidate: null } as DeliveryReportResponse)
  jest.mocked(findWithDecryption).mockResolvedValue([{ id: evidenceId, sourceRevision: revision, taskId: null, kind: 'test', rawReportHash: 'a'.repeat(64) }] as never)
})
it('persists explicit B, sorted evidence and monotonic version under project and task locks', async () => {
  const result = await execute()
  expect(result).toMatchObject({ currentCandidate: { projectId, baselineId, sourceRevision: revision, version: 1, evidenceIds: [evidenceId] }, projectUpdatedAt: expect.any(String) })
  expect(requireLockHeader).toHaveBeenCalledWith(ctx)
  expect(lockProjectForWrite).toHaveBeenCalledWith(em, ctx, projectId, scope, { force: true })
  expect(lockScopedProjectTasks).toHaveBeenCalledWith(em, projectId, scope)
  expect(em.create).toHaveBeenCalledWith(DeliveryReleaseCandidate, expect.objectContaining({ ...scope, baselineId, projectId, version: 1 }))
  expect(em.persist).toHaveBeenCalledTimes(1)
  expect(findWithDecryption).toHaveBeenCalledWith(em, expect.anything(), { ...scope, projectId, baselineId, id: { $in: [evidenceId] } }, undefined, scope)
  buildReport.mockResolvedValue({ baselineHash: 'a'.repeat(64), gates: { publishable: { ok: true } }, mode: 'legacy', currentCandidate: { version: 4 } })
  expect(await execute()).toMatchObject({ currentCandidate: { version: 5 } })
})
it('rejects missing or foreign evidence, different revision, task-only tests and red reports before insertion', async () => {
  for (const rows of [[], [{ id: evidenceId, sourceRevision: { ...revision, commitSha: 'c'.repeat(40) } }], [{ id: evidenceId, sourceRevision: revision, taskId: projectId, kind: 'test', rawReportHash: 'a'.repeat(64) }]]) {
    jest.mocked(findWithDecryption).mockResolvedValue(rows as never)
    await expect(execute()).rejects.toMatchObject({ status: 422 })
  }
  jest.mocked(findWithDecryption).mockResolvedValue([{ id: evidenceId, sourceRevision: revision, kind: 'test', rawReportHash: 'a'.repeat(64) }] as never)
  buildReport.mockResolvedValue({ baselineHash: 'a'.repeat(64), gates: { publishable: { ok: false } }, mode: 'legacy', currentCandidate: null })
  await expect(execute()).rejects.toMatchObject({ status: 422, body: { code: 'report_not_green' } })
  expect(em.persist).not.toHaveBeenCalled()
})
it('rejects stale optimistic lock and inactive baseline', async () => {
  jest.mocked(lockProjectForWrite).mockRejectedValueOnce({ status: 409 })
  await expect(execute()).rejects.toMatchObject({ status: 409 })
  jest.mocked(lockProjectForWrite).mockResolvedValue({ id: projectId, activeBaselineId: evidenceId } as never)
  await expect(execute()).rejects.toMatchObject({ status: 422, body: { code: 'baseline_not_active' } })
  expect(em.persist).not.toHaveBeenCalled()
})
