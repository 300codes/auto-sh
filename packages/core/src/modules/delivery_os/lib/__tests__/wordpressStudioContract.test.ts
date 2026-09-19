import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import { resultCheckSchema, resultManifestV1Schema, sourceRevisionSchema } from '../contracts'
import { assertRevisionKind, checkAllowedPathsForProfile, getTargetProfile } from '../targetProfiles'

const evidenceDirectory = resolve(__dirname, '../../../../../../../hackathon/delivery-demo/adapters/wordpress')

function loadEvidence(relativePath: string): unknown {
  return JSON.parse(readFileSync(resolve(evidenceDirectory, relativePath), 'utf8'))
}

const liveReportSchema = z.object({
  provenance: z.literal('live'),
  attemptId: z.uuid(),
  siteId: z.string(),
  snapshot: z.object({
    siteId: z.string(),
    creationAttemptId: z.uuid(),
    sourceRevision: sourceRevisionSchema,
    themeFiles: z.record(z.string(), z.string()),
  }),
  checks: z.array(z.unknown()).min(1),
})

describe('WordPress Studio evidence at the delivery domain boundary', () => {
  it('accepts the recorded snapshot revision and theme paths for the WordPress target', () => {
    const report = liveReportSchema.parse(loadEvidence('evidence/local-studio.live.json'))
    const profile = getTargetProfile('wordpress-theme', 1)
    if (!profile) throw new Error('[internal] Missing WordPress target profile')

    expect(report.snapshot.siteId).toBe(report.siteId)
    expect(report.snapshot.creationAttemptId).toBe(report.attemptId)
    expect(report.snapshot.sourceRevision).toMatchObject({
      kind: 'snapshot',
      externalWorkspaceId: report.siteId,
    })
    expect(assertRevisionKind(profile, report.snapshot.sourceRevision)).toEqual({ ok: true })
    expect(checkAllowedPathsForProfile(profile, Object.keys(report.snapshot.themeFiles))).toEqual({ ok: true })
  })

  it.each(['evidence/local-studio.live.json', 'fixtures/tool-evidence.fixture.json'])(
    'rejects the standalone report %s as a domain result manifest',
    (relativePath) => {
      const report = loadEvidence(relativePath)
      expect(resultManifestV1Schema.safeParse(report).success).toBe(false)
    },
  )

  it('does not accept successful local tool checks as acceptance-criterion evidence', () => {
    const report = liveReportSchema.parse(loadEvidence('evidence/local-studio.live.json'))

    for (const check of report.checks) {
      expect(resultCheckSchema.safeParse(check).success).toBe(false)
    }
  })
})
