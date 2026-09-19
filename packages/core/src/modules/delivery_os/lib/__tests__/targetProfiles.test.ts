import {
  AC_EVIDENCE_KINDS,
  TARGET_PROFILES,
  assertRevisionKind,
  checkAllowedPathsForProfile,
  countsAsAcEvidence,
  getLatestTargetProfile,
  getTargetProfile,
  isEvidenceKindPermitted,
  isPathWithinProfileRoots,
  pickLatestProfile,
  targetProfileSchema,
  type TargetProfile,
} from '../targetProfiles'
import { checkAcyclic, findDependencyCycle } from '../dag'
import { deliveryErrorBodySchema, deliveryEvidenceKindSchema } from '../contracts'

const gitRevision = { kind: 'git' as const, commitSha: 'c'.repeat(40) }
const snapshotRevision = { kind: 'snapshot' as const, contentHash: 'e'.repeat(64), externalWorkspaceId: 'wp-local-1' }

function requireProfile(id: string, version: number): TargetProfile {
  const profile = getTargetProfile(id, version)
  if (!profile) throw new Error(`[internal] missing profile ${id}@${version}`)
  return profile
}

const reactProfile = requireProfile('react-vite', 1)
const openMercatoProfile = requireProfile('open-mercato-module', 1)
const wordpressProfile = requireProfile('wordpress-theme', 1)

describe('target profiles', () => {
  it('publishes the three v1 profiles, each valid against the profile schema', () => {
    expect(TARGET_PROFILES.map((profile) => `${profile.id}@${profile.version}`)).toEqual([
      'react-vite@1',
      'open-mercato-module@1',
      'wordpress-theme@1',
    ])
    for (const profile of TARGET_PROFILES) {
      expect(targetProfileSchema.safeParse(profile).success).toBe(true)
    }
  })

  it('rejects a profile whose check references an unknown command profile or repeats a checkId', () => {
    const unknownCommand = { ...reactProfile, checks: [{ ...reactProfile.checks[0], commandProfileId: 'missing' }] }
    const duplicateCheck = { ...reactProfile, checks: [reactProfile.checks[0], reactProfile.checks[0]] }
    expect(targetProfileSchema.safeParse(unknownCommand).success).toBe(false)
    expect(targetProfileSchema.safeParse(duplicateCheck).success).toBe(false)
  })

  it('returns undefined for an unknown id or version', () => {
    expect(getTargetProfile('react-vite', 2)).toBeUndefined()
    expect(getTargetProfile('angular', 1)).toBeUndefined()
    expect(getTargetProfile('', 1)).toBeUndefined()
  })

  it('resolves the newest version of a known profile id and nothing for an unknown id', () => {
    for (const profile of TARGET_PROFILES) {
      const newest = Math.max(...TARGET_PROFILES.filter((candidate) => candidate.id === profile.id).map((candidate) => candidate.version))
      expect(getLatestTargetProfile(profile.id)?.version).toBe(newest)
    }
    expect(getLatestTargetProfile('angular')).toBeUndefined()
    expect(getLatestTargetProfile('')).toBeUndefined()
  })

  it('picks the highest version whatever the order of the list', () => {
    const base = TARGET_PROFILES[0]
    const versions = [2, 3, 1].map((version) => ({ ...base, version }))
    expect(pickLatestProfile(versions, base.id)?.version).toBe(3)
    expect(pickLatestProfile([...versions].reverse(), base.id)?.version).toBe(3)
    expect(pickLatestProfile(versions, 'angular')).toBeUndefined()
  })

  it('is immutable data', () => {
    expect(Object.isFrozen(reactProfile)).toBe(true)
    expect(Object.isFrozen(reactProfile.allowedPathRoots)).toBe(true)
    expect(() => {
      ;(reactProfile.allowedPathRoots as string[]).push('..')
    }).toThrow()
  })

  it('declares git for React and OM and snapshot for WordPress', () => {
    expect(reactProfile.revisionKind).toBe('git')
    expect(openMercatoProfile.revisionKind).toBe('git')
    expect(wordpressProfile.revisionKind).toBe('snapshot')
  })

  it('pins scan checks for React and OM so a missing scan can block publication', () => {
    expect(reactProfile.checks.some((check) => check.kind === 'scan' && check.required)).toBe(true)
    expect(openMercatoProfile.checks.some((check) => check.kind === 'scan' && check.required)).toBe(true)
    expect(reactProfile.testCatalogue.map((test) => test.testId)).toContain(
      'service catalogue AC-001: service list renders seeded services',
    )
  })
})

describe('assertRevisionKind', () => {
  it('rejects a snapshot revision for the React profile with revision_kind_mismatch', () => {
    const result = assertRevisionKind(reactProfile, snapshotRevision)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(422)
    expect(result.body.code).toBe('revision_kind_mismatch')
    expect(deliveryErrorBodySchema.safeParse(result.body).success).toBe(true)
  })

  it('accepts a snapshot revision for the WordPress profile and rejects a git one', () => {
    expect(assertRevisionKind(wordpressProfile, snapshotRevision)).toEqual({ ok: true })
    const gitForWordpress = assertRevisionKind(wordpressProfile, gitRevision)
    expect(gitForWordpress.ok).toBe(false)
    if (!gitForWordpress.ok) expect(gitForWordpress.body.code).toBe('revision_kind_mismatch')
  })

  it('accepts a git revision for the React and OM profiles', () => {
    expect(assertRevisionKind(reactProfile, gitRevision)).toEqual({ ok: true })
    expect(assertRevisionKind(openMercatoProfile, gitRevision)).toEqual({ ok: true })
  })
})

describe('profile path roots', () => {
  it('accepts paths and globs inside the React roots', () => {
    for (const path of ['src/**', 'src/components/ServiceList.tsx', 'public/logo.svg', 'tests/e2e/**', 'index.html']) {
      expect(isPathWithinProfileRoots(reactProfile, path)).toBe(true)
    }
    expect(checkAllowedPathsForProfile(reactProfile, ['src/**', 'index.html'])).toEqual({ ok: true })
  })

  it('rejects traversal, absolute and out-of-root paths with path_not_allowed', () => {
    const rejected = ['../secrets', '/etc/passwd', 'src/../package.json', 'package.json', 'srcfoo/x.ts', 'index.html.bak', '.github/workflows/ci.yml']
    for (const path of rejected) {
      expect(isPathWithinProfileRoots(reactProfile, path)).toBe(false)
    }
    const result = checkAllowedPathsForProfile(reactProfile, ['src/**', ...rejected])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.body.code).toBe('path_not_allowed')
    expect(result.body.details.map((detail) => detail.path)).toEqual(rejected.map((_, index) => String(index + 1)))
  })

  it('keeps WordPress roots inside the theme', () => {
    expect(isPathWithinProfileRoots(wordpressProfile, 'templates/index.html')).toBe(true)
    expect(isPathWithinProfileRoots(wordpressProfile, 'wp-config.php')).toBe(false)
  })
})

describe('evidence kinds', () => {
  it('permits reference_material only for WordPress and never counts it as AC evidence', () => {
    expect(isEvidenceKindPermitted(wordpressProfile, 'reference_material')).toBe(true)
    expect(isEvidenceKindPermitted(reactProfile, 'reference_material')).toBe(false)
    expect(isEvidenceKindPermitted(openMercatoProfile, 'reference_material')).toBe(false)
    expect(countsAsAcEvidence('reference_material')).toBe(false)
  })

  it('counts only results, tests and reviews as AC evidence', () => {
    const counted = deliveryEvidenceKindSchema.options.filter((kind) => countsAsAcEvidence(kind))
    expect(counted).toEqual([...AC_EVIDENCE_KINDS])
    expect(counted).toEqual(['result_manifest', 'test', 'review'])
  })
})

describe('dependency cycles', () => {
  it('finds a two-task cycle and returns the path', () => {
    expect(findDependencyCycle([
      { key: 'A', dependsOn: ['B'] },
      { key: 'B', dependsOn: ['A'] },
    ])).toEqual(['A', 'B', 'A'])
  })

  it('finds a longer cycle behind an acyclic prefix and a self-loop', () => {
    expect(findDependencyCycle([
      { key: 'root', dependsOn: ['A'] },
      { key: 'A', dependsOn: ['B'] },
      { key: 'B', dependsOn: ['C'] },
      { key: 'C', dependsOn: ['A'] },
    ])).toEqual(['A', 'B', 'C', 'A'])
    expect(findDependencyCycle([{ key: 'A', dependsOn: ['A'] }])).toEqual(['A', 'A'])
  })

  it('accepts a diamond DAG and ignores unknown dependency keys', () => {
    const diamond = [
      { key: 'A', dependsOn: [] },
      { key: 'B', dependsOn: ['A'] },
      { key: 'C', dependsOn: ['A', 'external'] },
      { key: 'D', dependsOn: ['B', 'C'] },
    ]
    expect(findDependencyCycle(diamond)).toBeNull()
    expect(checkAcyclic(diamond)).toEqual({ ok: true })
  })

  it('unions duplicate keys instead of letting a later node hide a cycle', () => {
    expect(findDependencyCycle([
      { key: 'A', dependsOn: ['B'] },
      { key: 'B', dependsOn: ['A'] },
      { key: 'A', dependsOn: [] },
    ])).toEqual(['A', 'B', 'A'])
  })

  it('handles a 10 000-node chain without overflowing the stack', () => {
    const chain = Array.from({ length: 10_000 }, (_, index) => ({ key: `N${index}`, dependsOn: index > 0 ? [`N${index - 1}`] : [] }))
    expect(findDependencyCycle(chain)).toBeNull()
    const cyclic = [...chain.slice(1), { key: 'N0', dependsOn: ['N9999'] }]
    expect(findDependencyCycle(cyclic)?.length).toBe(10_001)
  })

  it('reports cycle with status 422', () => {
    const result = checkAcyclic([
      { key: 'A', dependsOn: ['B'] },
      { key: 'B', dependsOn: ['A'] },
    ])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(422)
    expect(result.body.code).toBe('cycle')
  })
})
