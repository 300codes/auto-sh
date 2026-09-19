/** @jest-environment node */

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async () => null),
  findWithDecryption: jest.fn(async () => []),
}))
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createDeliveryOsReportQueries, formatRevisionRef, parseRevisionRef } from '../reportQueries'
import type { SourceRevision } from '../../lib/contracts'
import { ORG_ID, PROJECT_ID, TENANT_ID } from './baselineTestKit'

const GIT: SourceRevision = { kind: 'git', commitSha: '687670c20c93d6a60c2ab494419ec38636cf0a8c' }
const SNAPSHOT: SourceRevision = { kind: 'snapshot', contentHash: 'c'.repeat(64), externalWorkspaceId: 'wp:site:42' }
const em = { fork: () => em } as unknown as EntityManager

describe('parseRevisionRef', () => {
  it('round-trips git and snapshot refs, keeping colons inside the workspace id', () => {
    expect(parseRevisionRef(formatRevisionRef(GIT))).toEqual(GIT)
    expect(parseRevisionRef(formatRevisionRef(SNAPSHOT))).toEqual(SNAPSHOT)
    expect(formatRevisionRef(SNAPSHOT)).toBe(`snapshot:${'c'.repeat(64)}:wp:site:42`)
  })

  it('rejects anything that is not a valid SourceRevision', () => {
    const invalid = [
      '',
      GIT.kind === 'git' ? GIT.commitSha : '',
      'git:',
      'git:ABC',
      `git:${'a'.repeat(39)}`,
      `snapshot:${'c'.repeat(64)}`,
      `snapshot:${'c'.repeat(64)}:`,
      'snapshot:short:ws',
      `svn:${'a'.repeat(40)}`,
    ]
    for (const ref of invalid) expect(parseRevisionRef(ref)).toBeNull()
  })
})

describe('deliveryOsReportQueries.buildReport', () => {
  it('throws an internal error without a full scope', async () => {
    const queries = createDeliveryOsReportQueries(em)
    for (const scope of [null, { tenantId: TENANT_ID }, { tenantId: '', organizationId: ORG_ID }]) {
      await expect(queries.buildReport(scope as never, PROJECT_ID)).rejects.toThrow('[internal]')
    }
  })

  it('looks the project up with tenant and organization filters and answers 404 when absent', async () => {
    const queries = createDeliveryOsReportQueries(em)
    await expect(queries.buildReport({ tenantId: TENANT_ID, organizationId: ORG_ID }, PROJECT_ID)).rejects.toMatchObject({
      status: 404,
      body: { code: 'not_found' },
    })
    expect(jest.mocked(findOneWithDecryption).mock.calls[0][2]).toEqual({ id: PROJECT_ID, tenantId: TENANT_ID, organizationId: ORG_ID })
  })

  it('answers 404 before judging the revision when the project is not in scope', async () => {
    const queries = createDeliveryOsReportQueries(em)
    for (const revision of ['bad', { kind: 'git', commitSha: 'x' }, GIT]) {
      await expect(
        queries.buildReport({ tenantId: TENANT_ID, organizationId: ORG_ID }, PROJECT_ID, { revision: revision as never }),
      ).rejects.toMatchObject({ status: 404 })
    }
  })
})
