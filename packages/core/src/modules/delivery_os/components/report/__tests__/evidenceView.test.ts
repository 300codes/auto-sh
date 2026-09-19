import { deliveryReportV1Schema } from '../../../lib/contracts'
import fixture from '../../../lib/fixtures/delivery-report.v1.json'
import { evidenceRevisionLabel, evidenceRowKey, evidenceStatusVariant, evidenceTableRows } from '../evidenceView'

describe('report evidence presentation', () => {
  const report = deliveryReportV1Schema.parse(fixture)

  it('keeps relationships sharing evidence separate and includes the revision in their keys', () => {
    const rows = evidenceTableRows(report)
    expect(rows[0].evidenceId).toBe(rows[2].evidenceId)
    expect(rows[0].id).not.toBe(rows[2].id)
    expect(evidenceRowKey({ ...report, revision: { kind: 'git', commitSha: 'b'.repeat(40) } }, report.rows[0])).not.toBe(rows[0].id)
    expect(evidenceRowKey(report, { ...report.rows[0], deploymentEvidenceId: null })).not.toBe(rows[0].id)
  })

  it.each([null, 'missing', 'not_run', 'failed', 'manual_pending', 'unverified', 'present'])('does not turn %s into a successful proof', (status) => {
    expect(evidenceStatusVariant(status)).not.toBe('success')
  })

  it('keeps the complete snapshot workspace identity and treats absent revision as unknown', () => {
    expect(evidenceRevisionLabel({ kind: 'snapshot', contentHash: 'a'.repeat(64), externalWorkspaceId: 'studio:one' })).toBe(`snapshot:${'a'.repeat(64)}:studio:one`)
    expect(evidenceRevisionLabel(null)).toBeNull()
  })
})
