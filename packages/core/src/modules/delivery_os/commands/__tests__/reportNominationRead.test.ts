/** @jest-environment node */
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findWithDecryption: jest.fn(), findOneWithDecryption: jest.fn() }))
jest.mock('../reportContext', () => ({ ...jest.requireActual('../reportContext'), loadReportContext: jest.fn() }))
jest.mock('../evidence', () => ({ requireVerifiedBaselineContent: jest.fn(() => ({})) }))
jest.mock('../tasks', () => ({ findProjectBaseline: jest.fn() }))
jest.mock('../../lib/deliveryReport', () => ({ buildDeliveryReport: jest.fn((input) => ({ revision: input.revision })) }))
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { DeliveryEvidence } from '../../data/entities'
import { buildDeliveryReport } from '../../lib/deliveryReport'
import { loadReportContext } from '../reportContext'
import { findProjectBaseline } from '../tasks'
import { createDeliveryOsReportQueries } from '../reportQueries'

const revisionB = { kind: 'git' as const, commitSha: 'b'.repeat(40) }
const scope = { tenantId: 'tenant', organizationId: 'organization' }
const project = { id: 'project', activeBaselineId: 'baseline', targetProfileId: 'react-vite', targetProfileVersion: 1, updatedAt: new Date() }
const candidate = { id: 'candidate', version: 1, baselineId: 'baseline', baselineHash: 'hash', projectId: 'project', sourceRevision: revisionB, evidenceIds: ['integration'], createdAt: new Date().toISOString() }
const em = { fork: jest.fn() }
beforeEach(() => {
  jest.clearAllMocks()
  em.fork.mockReturnValue(em)
  jest.mocked(findOneWithDecryption).mockResolvedValue(project as never)
  jest.mocked(loadReportContext).mockResolvedValue({ mode: 'legacy', flow: null, currentCandidate: candidate })
  jest.mocked(findProjectBaseline).mockImplementation(async (_em, id) => ({ id, projectId: 'project', contentHash: 'hash' }) as never)
  jest.mocked(findWithDecryption).mockImplementation(async (_em, entity) => entity === DeliveryEvidence ? [{ id: 'later-task-c', kind: 'result', projectId: 'project', baselineId: 'baseline', sourceRevision: { kind: 'git', commitSha: 'c'.repeat(40) }, payload: {}, createdAt: new Date() }] as never : [])
})
it('passes nominated integration B to the report builder despite newer result C', async () => {
  const report = await createDeliveryOsReportQueries(em as unknown as EntityManager).buildReport(scope, 'project')
  expect(report.revision).toEqual(revisionB)
  expect(report.currentCandidate).toEqual(candidate)
  expect(buildDeliveryReport).toHaveBeenCalledWith(expect.objectContaining({ revision: revisionB, evidence: [expect.objectContaining({ id: 'later-task-c' })] }))
})
it('does not carry a nomination across an active baseline change', async () => {
  jest.mocked(findOneWithDecryption).mockResolvedValue({ ...project, activeBaselineId: 'next-baseline' } as never)
  await createDeliveryOsReportQueries(em as unknown as EntityManager).buildReport(scope, 'project')
  expect(buildDeliveryReport).toHaveBeenCalledWith(expect.objectContaining({ revision: null, baseline: expect.objectContaining({ id: 'next-baseline' }) }))
})
it('preserves an explicitly requested historical revision', async () => {
  const history = { kind: 'git' as const, commitSha: 'a'.repeat(40) }
  const report = await createDeliveryOsReportQueries(em as unknown as EntityManager).buildReport(scope, 'project', { baselineId: 'baseline', revision: history })
  expect(report.revision).toEqual(history)
})
