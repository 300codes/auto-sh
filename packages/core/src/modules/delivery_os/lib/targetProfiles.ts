import { z } from 'zod'
import {
  buildDeliveryError,
  declaredTestSchema,
  deliveryEvidenceKindSchema,
  repoRelativePathSchema,
  validationCheckDefinitionSchema,
  type DeliveryCheckResult,
  type DeliveryErrorDetail,
  type DeliveryEvidenceKind,
  type SourceRevision,
} from './contracts'

const ROOT_WILDCARD_SUFFIX = '/**'

const profileRootSchema = repoRelativePathSchema.refine(
  (root) => !root.slice(0, root.endsWith(ROOT_WILDCARD_SUFFIX) ? -ROOT_WILDCARD_SUFFIX.length : undefined).includes('*'),
  { message: 'A profile root is a file path or a directory followed by /**' },
)

export const targetProfileSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    version: z.number().int().positive(),
    label: z.string().min(1).max(200),
    revisionKind: z.enum(['git', 'snapshot']),
    allowedPathRoots: z.array(profileRootSchema).min(1).max(50),
    commandProfiles: z.record(z.string().min(1).max(64), z.object({ command: z.string().min(1).max(500) })),
    checks: z.array(validationCheckDefinitionSchema).min(1).max(50),
    testCatalogue: z.array(declaredTestSchema).max(1000),
    requiredEvidenceKinds: z.array(deliveryEvidenceKindSchema).min(1),
    permittedEvidenceKinds: z.array(deliveryEvidenceKindSchema).min(1),
  })
  .superRefine((profile, ctx) => {
    profile.checks.forEach((check, index) => {
      if (!Object.prototype.hasOwnProperty.call(profile.commandProfiles, check.commandProfileId)) {
        ctx.addIssue({ code: 'custom', path: ['checks', index, 'commandProfileId'], message: 'Unknown command profile' })
      }
    })
    const checkIds = profile.checks.map((check) => check.checkId)
    if (new Set(checkIds).size !== checkIds.length) {
      ctx.addIssue({ code: 'custom', path: ['checks'], message: 'Duplicate checkId' })
    }
    profile.requiredEvidenceKinds.forEach((kind, index) => {
      if (!profile.permittedEvidenceKinds.includes(kind)) {
        ctx.addIssue({ code: 'custom', path: ['requiredEvidenceKinds', index], message: 'Required kind is not permitted' })
      }
    })
  })
export type TargetProfile = z.infer<typeof targetProfileSchema>

export const AC_EVIDENCE_KINDS: readonly DeliveryEvidenceKind[] = ['result_manifest', 'test', 'review']

function deepFreeze<TValue>(value: TValue): TValue {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach((entry) => deepFreeze(entry))
    Object.freeze(value)
  }
  return value
}

const reactViteV1: TargetProfile = {
  id: 'react-vite',
  version: 1,
  label: 'React + Vite + TypeScript (static build)',
  revisionKind: 'git',
  allowedPathRoots: ['src/**', 'public/**', 'tests/**', 'index.html'],
  commandProfiles: {
    'vitest-report': { command: 'npm run test:report' },
    'vite-build': { command: 'npm run build' },
    oxlint: { command: 'npm run lint' },
    'npm-audit': { command: 'npm audit --audit-level=high' },
  },
  checks: [
    { checkId: 'unit-tests', commandProfileId: 'vitest-report', kind: 'test', required: true },
    { checkId: 'build', commandProfileId: 'vite-build', kind: 'build', required: true },
    { checkId: 'lint', commandProfileId: 'oxlint', kind: 'lint', required: true },
    { checkId: 'dependency-audit', commandProfileId: 'npm-audit', kind: 'scan', required: true },
  ],
  testCatalogue: [
    {
      testId: 'service catalogue AC-001: service list renders seeded services',
      file: 'src/__tests__/service-catalogue.test.tsx',
    },
  ],
  requiredEvidenceKinds: ['result_manifest', 'test', 'scan', 'deployment'],
  permittedEvidenceKinds: ['result_manifest', 'test', 'review', 'screenshot', 'deployment', 'scan'],
}

const openMercatoModuleV1: TargetProfile = {
  id: 'open-mercato-module',
  version: 1,
  label: 'Open Mercato app module',
  revisionKind: 'git',
  allowedPathRoots: ['src/modules/**'],
  commandProfiles: {
    'jest-module': { command: 'yarn jest --maxWorkers=2' },
    typecheck: { command: 'yarn typecheck' },
    'yarn-audit': { command: 'yarn npm audit --severity high' },
  },
  checks: [
    { checkId: 'unit-tests', commandProfileId: 'jest-module', kind: 'test', required: true },
    { checkId: 'typecheck', commandProfileId: 'typecheck', kind: 'typecheck', required: true },
    { checkId: 'dependency-audit', commandProfileId: 'yarn-audit', kind: 'scan', required: true },
  ],
  testCatalogue: [],
  requiredEvidenceKinds: ['result_manifest', 'test', 'scan'],
  permittedEvidenceKinds: ['result_manifest', 'test', 'review', 'screenshot', 'deployment', 'scan'],
}

const wordpressThemeV1: TargetProfile = {
  id: 'wordpress-theme',
  version: 1,
  label: 'WordPress block theme (workspace snapshot)',
  revisionKind: 'snapshot',
  allowedPathRoots: [
    'style.css',
    'theme.json',
    'functions.php',
    'templates/**',
    'parts/**',
    'patterns/**',
    'assets/**',
    'inc/**',
    'tests/**',
  ],
  commandProfiles: {
    'playwright-smoke': { command: 'npx playwright test' },
    'php-lint': { command: 'composer run lint' },
  },
  checks: [
    { checkId: 'smoke-tests', commandProfileId: 'playwright-smoke', kind: 'test', required: true },
    { checkId: 'lint', commandProfileId: 'php-lint', kind: 'lint', required: true },
  ],
  testCatalogue: [],
  requiredEvidenceKinds: ['result_manifest', 'screenshot'],
  permittedEvidenceKinds: ['result_manifest', 'test', 'review', 'screenshot', 'deployment', 'scan', 'reference_material'],
}

export const TARGET_PROFILES: readonly TargetProfile[] = deepFreeze([reactViteV1, openMercatoModuleV1, wordpressThemeV1])

export function getTargetProfile(id: string, version: number): TargetProfile | undefined {
  return TARGET_PROFILES.find((profile) => profile.id === id && profile.version === version)
}

export function assertRevisionKind(profile: TargetProfile, revision: SourceRevision): DeliveryCheckResult {
  if (revision.kind === profile.revisionKind) return { ok: true }
  return {
    ok: false,
    ...buildDeliveryError(
      'revision_kind_mismatch',
      `Profile ${profile.id}@${profile.version} requires a ${profile.revisionKind} revision`,
      [{ path: 'kind', code: 'revision_kind_mismatch', message: `Received ${revision.kind}` }],
    ),
  }
}

export function isPathWithinProfileRoots(profile: TargetProfile, path: string): boolean {
  if (!repoRelativePathSchema.safeParse(path).success) return false
  return profile.allowedPathRoots.some((root) => {
    if (!root.endsWith(ROOT_WILDCARD_SUFFIX)) return path === root
    const directory = root.slice(0, -ROOT_WILDCARD_SUFFIX.length)
    return path === directory || path.startsWith(`${directory}/`)
  })
}

export function checkAllowedPathsForProfile(profile: TargetProfile, paths: readonly string[]): DeliveryCheckResult {
  const details: DeliveryErrorDetail[] = []
  paths.forEach((path, index) => {
    if (!repoRelativePathSchema.safeParse(path).success) {
      details.push({ path: String(index), code: 'path_not_allowed', message: 'Path must be repository-relative without parent segments' })
    } else if (!isPathWithinProfileRoots(profile, path)) {
      details.push({ path: String(index), code: 'path_not_allowed', message: `Path is outside the ${profile.id} roots` })
    }
  })
  if (details.length === 0) return { ok: true }
  return { ok: false, ...buildDeliveryError('path_not_allowed', 'Path is not allowed for the target profile', details) }
}

export function isEvidenceKindPermitted(profile: TargetProfile, kind: DeliveryEvidenceKind): boolean {
  return profile.permittedEvidenceKinds.includes(kind)
}

export function countsAsAcEvidence(kind: DeliveryEvidenceKind): boolean {
  return AC_EVIDENCE_KINDS.includes(kind)
}
