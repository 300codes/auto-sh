import { createHash } from 'node:crypto'
import { z } from 'zod'
import { isPathAllowed } from './allowedPaths'
import {
  isSameRevision, repoRelativePathSchema, resultCheckSchema, resultManifestV1Schema,
  sha256Schema, sourceRevisionSchema, taskPackageV1Schema, usageSchema,
} from './contracts'
import { checkReportedChecks } from './resultChecks'
import { checkAllowedPathsForProfile, getTargetProfile } from './targetProfiles'

const scopeSchema = z.strictObject({ tenantId: z.uuid(), organizationId: z.uuid(), projectId: z.uuid() })
const snapshotSchema = z.strictObject({
  schemaVersion: z.literal(1), provenance: z.literal('live'), siteId: sha256Schema,
  creationAttemptId: z.uuid(), toolExecutionId: z.uuid(), sourceRevision: sourceRevisionSchema,
  themeFiles: z.record(repoRelativePathSchema, sha256Schema), databaseHash: sha256Schema,
  capturedAt: z.iso.datetime({ offset: true }),
})
const artifactSchema = z.strictObject({
  path: repoRelativePathSchema,
  bytes: z.custom<Uint8Array>((value) => value instanceof Uint8Array).refine((bytes) => bytes.byteLength <= 512 * 1024 * 1024),
})
const frozenSnapshotSchema = z.strictObject({
  scope: scopeSchema, snapshot: snapshotSchema,
  database: artifactSchema, theme: z.record(repoRelativePathSchema, artifactSchema),
})
const correlationSchema = z.strictObject({
  projectId: z.uuid(), taskId: z.uuid(), attemptId: z.uuid(), baselineId: z.uuid(),
  baselineHash: sha256Schema, targetProfileId: z.string(), targetProfileVersion: z.number().int().positive(),
  packageSchemaVersion: z.literal('delivery.task-package/v1'), externalRunId: z.string().min(1).max(200),
})
const inputSchema = z.strictObject({
  taskPackage: taskPackageV1Schema,
  trusted: z.strictObject({
    scope: scopeSchema, siteId: sha256Schema, creationAttemptId: z.uuid(),
    execution: correlationSchema,
    baseToolExecutionId: z.uuid(), resultToolExecutionId: z.uuid(),
  }),
  base: frozenSnapshotSchema, result: frozenSnapshotSchema,
  execution: correlationSchema,
  checks: z.array(z.strictObject({ check: resultCheckSchema, definition: artifactSchema, report: artifactSchema })).max(1000),
  usage: usageSchema,
})
export type WordpressResultMappingInput = z.input<typeof inputSchema>

function hashBytes(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}
export function wordpressSnapshotContentHash(snapshot: { databaseHash: string; themeFiles: Record<string, string> }): string {
  const themeFiles = Object.fromEntries(Object.entries(snapshot.themeFiles).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0))
  return hashBytes(JSON.stringify({ schemaVersion: 1, databaseHash: snapshot.databaseHash, themeFiles }))
}

function refuse(code: string): never {
  throw new Error(`[internal] wordpress_result_${code}`)
}

export function mapWordpressResult(value: WordpressResultMappingInput) {
  const input = inputSchema.parse(value)
  const { taskPackage, trusted } = input
  const profile = getTargetProfile(taskPackage.targetProfileId, taskPackage.targetProfileVersion)
  if (!profile || profile.id !== 'wordpress-theme') refuse('profile_mismatch')
  if (trusted.scope.projectId !== taskPackage.projectId) refuse('scope_mismatch')
  if (!checkAllowedPathsForProfile(profile, taskPackage.allowedPaths).ok) refuse('path_not_allowed')
  for (const execution of [trusted.execution, input.execution]) {
    for (const key of ['projectId', 'taskId', 'attemptId', 'baselineId', 'baselineHash', 'targetProfileId', 'targetProfileVersion'] as const) {
      if (execution[key] !== taskPackage[key]) refuse('correlation_mismatch')
    }
    if (execution.packageSchemaVersion !== taskPackage.schemaVersion || execution.externalRunId !== trusted.execution.externalRunId) refuse('correlation_mismatch')
  }
  const snapshotArtifacts = [input.base, input.result].flatMap((frozen) => [frozen.database, ...Object.values(frozen.theme)])
  const checkArtifacts = input.checks.flatMap(({ definition, report }) => [definition, report])
  const allArtifacts = [...snapshotArtifacts, ...checkArtifacts]
  if (new Set(allArtifacts.map(({ path }) => path)).size > 200) refuse('artifact_count_limit')
  if (checkArtifacts.some(({ bytes }) => bytes.byteLength > 8 * 1024 * 1024) || checkArtifacts.reduce((sum, { bytes }) => sum + bytes.byteLength, 0) > 64 * 1024 * 1024) refuse('check_size_limit')
  if (allArtifacts.reduce((sum, { bytes }) => sum + bytes.byteLength, 0) > 1216 * 1024 * 1024) refuse('artifact_size_limit')
  const artifacts = new Map<string, { path: string; sha256: string; sizeBytes: number }>()
  function verifyArtifact(artifact: z.infer<typeof artifactSchema>, expectedHash: string): void {
    const sha256 = hashBytes(artifact.bytes)
    if (sha256 !== expectedHash) refuse('artifact_hash_mismatch')
    const existing = artifacts.get(artifact.path)
    if (existing && existing.sha256 !== sha256) refuse('artifact_path_collision')
    artifacts.set(artifact.path, { path: artifact.path, sha256, sizeBytes: artifact.bytes.byteLength })
  }
  for (const [kind, frozen] of [['base', input.base], ['result', input.result]] as const) {
    for (const key of ['tenantId', 'organizationId', 'projectId'] as const) {
      if (frozen.scope[key] !== trusted.scope[key]) refuse('scope_mismatch')
    }
    const snapshot = frozen.snapshot
    if (snapshot.siteId !== trusted.siteId || snapshot.sourceRevision.kind !== 'snapshot' || snapshot.sourceRevision.externalWorkspaceId !== trusted.siteId) refuse('workspace_mismatch')
    if (snapshot.creationAttemptId !== trusted.creationAttemptId || snapshot.toolExecutionId !== trusted[kind === 'base' ? 'baseToolExecutionId' : 'resultToolExecutionId']) refuse('snapshot_binding_mismatch')
    const paths = Object.keys(snapshot.themeFiles).sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
    if (paths.length === 0 || paths.length > 2048 || JSON.stringify(paths) !== JSON.stringify(Object.keys(frozen.theme).sort((left, right) => left < right ? -1 : left > right ? 1 : 0))) refuse('theme_artifact_mismatch')
    verifyArtifact(frozen.database, snapshot.databaseHash)
    let themeBytes = 0
    for (const path of paths) {
      const artifact = frozen.theme[path]
      themeBytes += artifact.bytes.byteLength
      if (artifact.bytes.byteLength > 16 * 1024 * 1024 || themeBytes > 64 * 1024 * 1024) refuse('theme_size_limit')
      verifyArtifact(artifact, snapshot.themeFiles[path])
    }
    const contentHash = wordpressSnapshotContentHash(snapshot)
    if (contentHash !== snapshot.sourceRevision.contentHash) refuse('snapshot_hash_mismatch')
  }
  if (!isSameRevision(taskPackage.baseRevision, input.base.snapshot.sourceRevision)) refuse('base_revision_mismatch')
  const before = input.base.snapshot.themeFiles
  const after = input.result.snapshot.themeFiles
  const changedPaths = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((path) => before[path] !== after[path]).sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
  if (!checkAllowedPathsForProfile(profile, changedPaths).ok) refuse('path_not_allowed')
  if (changedPaths.some((path) => !isPathAllowed(path, taskPackage.allowedPaths))) refuse('path_not_allowed')
  const checks = input.checks.map(({ check, definition, report }) => {
    verifyArtifact(definition, check.testDefinitionHash)
    verifyArtifact(report, check.rawReportHash)
    if (check.status === 'passed' && check.exitCode !== 0) refuse('check_status_mismatch')
    if (check.status === 'not_run' && check.exitCode !== null) refuse('check_status_mismatch')
    return check
  })
  const checked = checkReportedChecks({
    checks, resultRevision: input.result.snapshot.sourceRevision, validationProfile: taskPackage.validationProfile,
    acceptanceCriteriaIds: taskPackage.acceptanceCriteria.map((criterion) => criterion.id),
    knownTestIds: [...new Set(Object.values(taskPackage.validationProfile.requiredTests).flat())],
  })
  if (!checked.ok) refuse(checked.body.code)
  return resultManifestV1Schema.parse({
    schemaVersion: 'delivery.result-manifest/v1', projectId: taskPackage.projectId, taskId: taskPackage.taskId,
    attemptId: taskPackage.attemptId, baselineId: taskPackage.baselineId, baselineHash: taskPackage.baselineHash,
    targetProfileVersion: taskPackage.targetProfileVersion, externalRunId: trusted.execution.externalRunId,
    baseRevision: input.base.snapshot.sourceRevision, resultRevision: input.result.snapshot.sourceRevision,
    changedPaths, artifacts: [...artifacts.values()], checks, findings: [], usage: input.usage,
  })
}
