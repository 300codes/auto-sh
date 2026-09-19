import { buildTaskPackageV1 } from '../taskPackage'
import { hashBaseline } from '../baseline'
import {
  resultManifestV1Schema,
  taskPackageV1Schema,
  type BaselineContentV1,
} from '../contracts'
import {
  loadBaselineContentFixture,
  loadOpenMercatoResultManifestFixture,
  loadOpenMercatoTaskPackageFixture,
} from '../fixtures'
import { checkAllowedPathsForProfile, getTargetProfile, targetProfileSchema } from '../targetProfiles'
import { reserveAttempt } from '../attempts'

const OPEN_MERCATO_PROFILE_ID = 'open-mercato-module'
const OM_COMMIT = 'f0e1d2c3b4a5f0e1d2c3b4a5f0e1d2c3b4a5f0e1'
const NOW = '2026-09-19T10:00:00.000Z'
const ACTOR_ID = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'

function requireOmProfile() {
  const profile = getTargetProfile(OPEN_MERCATO_PROFILE_ID, 1)
  if (!profile) throw new Error('[internal] open-mercato-module@1 profile is missing')
  return profile
}

describe('open-mercato-module@1 profile', () => {
  it('parses against targetProfileSchema with a non-empty testCatalogue', () => {
    const profile = requireOmProfile()
    const result = targetProfileSchema.safeParse(profile)
    expect(result.success).toBe(true)
    expect(profile.testCatalogue.length).toBeGreaterThanOrEqual(2)
    expect(profile.testCatalogue.map((t) => t.testId)).toContain(
      'open-mercato-module AC-OM-001: profile validates against schema',
    )
    expect(profile.testCatalogue.map((t) => t.testId)).toContain(
      'open-mercato-module AC-OM-002: OM profile uses git revision',
    )
  })

  it('has allowedPathRoots scoped to the auto-sh monorepo module path', () => {
    const profile = requireOmProfile()
    expect(profile.allowedPathRoots).toContain('packages/core/src/modules/**')
    expect(profile.allowedPathRoots).not.toContain('src/modules/**')
  })

  it('accepts paths inside packages/core/src/modules/**', () => {
    const profile = requireOmProfile()
    const result = checkAllowedPathsForProfile(profile, [
      'packages/core/src/modules/delivery_os/lib/**',
      'packages/core/src/modules/example/index.ts',
    ])
    expect(result.ok).toBe(true)
  })

  it('rejects paths outside packages/core/src/modules/** with path_not_allowed', () => {
    const profile = requireOmProfile()
    const outsidePaths = [
      'src/modules/example/index.ts',
      'packages/enterprise/src/modules/delivery_agents/index.ts',
      'apps/mercato/src/app/page.tsx',
    ]
    const result = checkAllowedPathsForProfile(profile, outsidePaths)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.body.code).toBe('path_not_allowed')
  })

  it('has jest-module, typecheck and yarn-audit command profiles', () => {
    const profile = requireOmProfile()
    expect(Object.keys(profile.commandProfiles)).toEqual(
      expect.arrayContaining(['jest-module', 'typecheck', 'yarn-audit']),
    )
    expect(profile.checks.map((c) => c.commandProfileId)).toEqual(
      expect.arrayContaining(['jest-module', 'typecheck', 'yarn-audit']),
    )
  })
})

describe('buildTaskPackageV1 with open-mercato-module inputs', () => {
  it('produces a valid TaskPackageV1 with open-mercato-module profile', () => {
    const profile = requireOmProfile()
    const pkg = loadOpenMercatoTaskPackageFixture()
    const baselineContentRaw = loadBaselineContentFixture()
    const content: BaselineContentV1 = {
      ...baselineContentRaw,
      requirements: pkg.requirements,
      acceptanceCriteria: pkg.acceptanceCriteria,
      screens: [],
      acTestMap: {
        'AC-OM-001': ['open-mercato-module AC-OM-001: profile validates against schema'],
        'AC-OM-002': ['open-mercato-module AC-OM-002: OM profile uses git revision'],
      },
      manualChecks: {},
      declaredTests: profile.testCatalogue,
    }
    // Hash must be consistent: compute from content, then reserve the attempt with that hash.
    const contentHash = hashBaseline(content)
    const reserveResult = reserveAttempt([], {
      idempotencyKey: pkg.idempotencyKey,
      payload: { mode: 'manual_handoff', baseRevision: pkg.baseRevision },
      mode: 'manual_handoff',
      baselineId: pkg.baselineId,
      baselineHash: contentHash,
      baseRevision: pkg.baseRevision,
      now: NOW,
      newAttemptId: pkg.attemptId,
    })
    if (!reserveResult.ok) throw new Error('[internal] fixture reservation failed')

    const buildResult = buildTaskPackageV1({
      project: { id: pkg.projectId, repositoryRef: pkg.repositoryRef, limits: pkg.limits },
      task: {
        id: pkg.taskId,
        projectId: pkg.projectId,
        baselineId: pkg.baselineId,
        title: pkg.title,
        description: pkg.description ?? null,
        acIds: pkg.acceptanceCriteria.map((ac) => ac.id),
        allowedPaths: pkg.allowedPaths,
        targetProfileId: profile.id,
        targetProfileVersion: profile.version,
      },
      baseline: { id: pkg.baselineId, projectId: pkg.projectId, contentHash, content },
      attempt: reserveResult.attempt,
      profile,
    })

    expect(buildResult.ok).toBe(true)
    if (!buildResult.ok) return
    expect(buildResult.taskPackage.targetProfileId).toBe('open-mercato-module')
    expect(buildResult.taskPackage.targetProfileVersion).toBe(1)
    expect(buildResult.taskPackage.validationProfile.checks.map((c) => c.commandProfileId)).toEqual(
      expect.arrayContaining(['jest-module', 'typecheck', 'yarn-audit']),
    )
    expect(taskPackageV1Schema.safeParse(buildResult.taskPackage).success).toBe(true)
  })
})

describe('OM PoC fixtures', () => {
  it('task-package.open-mercato.v1.json parses against taskPackageV1Schema', () => {
    const pkg = loadOpenMercatoTaskPackageFixture()
    expect(pkg.targetProfileId).toBe('open-mercato-module')
    expect(pkg.baseRevision.kind).toBe('git')
    expect(pkg.designArtifactRefs).toHaveLength(0)
    expect(pkg.allowedPaths[0]).toMatch(/^packages\/core\/src\/modules\//)
    expect(taskPackageV1Schema.safeParse(pkg).success).toBe(true)
  })

  it('result-manifest.open-mercato.v1.json parses against resultManifestV1Schema', () => {
    const manifest = loadOpenMercatoResultManifestFixture()
    expect(manifest.baseRevision.kind).toBe('git')
    expect(manifest.resultRevision.kind).toBe('git')
    expect(manifest.checks.map((c) => c.commandProfileId)).toEqual(
      expect.arrayContaining(['jest-module', 'typecheck', 'yarn-audit']),
    )
    expect(manifest.checks.find((c) => c.commandProfileId === 'jest-module')?.acIds).toContain('AC-OM-001')
    expect(resultManifestV1Schema.safeParse(manifest).success).toBe(true)
  })

  it('result manifest has no vite-build or npm-audit commandProfileId entries', () => {
    const manifest = loadOpenMercatoResultManifestFixture()
    const commandProfiles = manifest.checks.map((c) => c.commandProfileId)
    expect(commandProfiles).not.toContain('vite-build')
    expect(commandProfiles).not.toContain('npm-audit')
    expect(commandProfiles).not.toContain('oxlint')
  })
})
