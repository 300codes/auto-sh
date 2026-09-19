import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { z } from 'zod'
import { isSameRevision, resultCheckSchema, resultManifestV1Schema, sourceRevisionSchema, type TaskPackageV1 } from '../contracts'
import { loadTaskPackageFixture } from '../fixtures'
import { isPathAllowed } from '../allowedPaths'
import { assertRevisionKind, checkAllowedPathsForProfile, getTargetProfile } from '../targetProfiles'

export const mappingFixtureDirectory = resolve(__dirname, '../../../../../../../hackathon/delivery-demo/adapters/wordpress/fixtures/oss-mapping')
const scopeSchema = z.object({ tenantId: z.uuid(), organizationId: z.uuid(), projectId: z.uuid() })
const snapshotSchema = z.object({
  provenance: z.literal('fixture'), scope: scopeSchema, siteId: z.string(), creationAttemptId: z.uuid(), toolExecutionId: z.string(),
  sourceRevision: sourceRevisionSchema, databaseHash: z.string(), themeFiles: z.record(z.string(), z.string()),
  artifacts: z.object({ database: z.string(), theme: z.record(z.string(), z.string()) }),
})
const bundleSchema = z.object({
  provenance: z.literal('fixture'), scope: scopeSchema,
  execution: z.object({ projectId: z.uuid(), taskId: z.uuid(), attemptId: z.uuid(), baselineId: z.uuid(), baselineHash: z.string(), targetProfileVersion: z.number(), externalRunId: z.string(), toolExecutionIds: z.array(z.string()) }),
  checks: z.array(resultCheckSchema), artifacts: z.record(z.string(), z.object({ definition: z.string(), report: z.string() })),
})
export type MappingSnapshot = z.infer<typeof snapshotSchema>
export type MappingFixture = { taskPackage: TaskPackageV1; trustedScope: z.infer<typeof scopeSchema>; base: MappingSnapshot; result: MappingSnapshot; bundle: z.infer<typeof bundleSchema> }
export const digestBytes = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
export function snapshotContentHash(snapshot: Pick<MappingSnapshot, 'databaseHash' | 'themeFiles'>): string {
  const themeFiles = Object.fromEntries(Object.entries(snapshot.themeFiles).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0))
  return digestBytes(JSON.stringify({ schemaVersion: 1, databaseHash: snapshot.databaseHash, themeFiles }))
}
export function readMappingArtifact(path: string): Buffer {
  const absolute = resolve(mappingFixtureDirectory, path)
  if (path.includes('\\') || !absolute.startsWith(`${mappingFixtureDirectory}${sep}`)) throw new Error('[internal] fixture_artifact_path_escape')
  return readFileSync(absolute)
}
export function loadMappingFixture(): MappingFixture {
  const base = snapshotSchema.parse(JSON.parse(readMappingArtifact('base-snapshot.fixture.json').toString()))
  const result = snapshotSchema.parse(JSON.parse(readMappingArtifact('result-snapshot.fixture.json').toString()))
  const bundle = bundleSchema.parse(JSON.parse(readMappingArtifact('checks.fixture.json').toString()))
  const taskPackage = loadTaskPackageFixture('snapshot')
  taskPackage.baseRevision = base.sourceRevision
  return { taskPackage, trustedScope: { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222', projectId: taskPackage.projectId }, base, result, bundle }
}
export function mapWordpressFixture(input: MappingFixture, readArtifact = readMappingArtifact) {
  const { taskPackage, trustedScope } = input
  const base = snapshotSchema.parse(input.base)
  const result = snapshotSchema.parse(input.result)
  const bundle = bundleSchema.parse(input.bundle)
  for (const scope of [base.scope, result.scope, bundle.scope]) {
    for (const key of ['tenantId', 'organizationId', 'projectId'] as const) {
      if (scope[key] !== trustedScope[key]) throw new Error('[internal] fixture_scope_mismatch')
    }
  }
  if (trustedScope.projectId !== taskPackage.projectId) throw new Error('[internal] fixture_scope_mismatch')
  for (const key of ['projectId', 'taskId', 'attemptId', 'baselineId', 'baselineHash', 'targetProfileVersion'] as const) {
    if (bundle.execution[key] !== taskPackage[key]) throw new Error('[internal] fixture_execution_mismatch')
  }
  if (bundle.execution.externalRunId !== `fixture-run-${taskPackage.attemptId}` || ![base.toolExecutionId, result.toolExecutionId].every((id) => bundle.execution.toolExecutionIds.includes(id))) throw new Error('[internal] fixture_execution_mismatch')
  const profile = getTargetProfile(taskPackage.targetProfileId, taskPackage.targetProfileVersion)
  if (!profile || profile.id !== 'wordpress-theme') throw new Error('[internal] fixture_profile_mismatch')
  for (const snapshot of [base, result]) {
    if (!assertRevisionKind(profile, snapshot.sourceRevision).ok || snapshot.sourceRevision.kind !== 'snapshot') throw new Error('[internal] fixture_revision_kind')
    if (snapshot.siteId !== base.siteId || snapshot.sourceRevision.externalWorkspaceId !== base.siteId) throw new Error('[internal] fixture_workspace_mismatch')
    if (digestBytes(readArtifact(snapshot.artifacts.database)) !== snapshot.databaseHash) throw new Error('[internal] fixture_database_hash_mismatch')
    if (Object.keys(snapshot.themeFiles).sort().join('\n') !== Object.keys(snapshot.artifacts.theme).sort().join('\n')) throw new Error('[internal] fixture_theme_artifact_mismatch')
    for (const [path, hash] of Object.entries(snapshot.themeFiles)) {
      if (!checkAllowedPathsForProfile(profile, [path]).ok) throw new Error('[internal] fixture_path_not_allowed')
      if (digestBytes(readArtifact(snapshot.artifacts.theme[path])) !== hash) throw new Error('[internal] fixture_theme_hash_mismatch')
    }
    if (snapshotContentHash(snapshot) !== snapshot.sourceRevision.contentHash) throw new Error('[internal] fixture_snapshot_hash_mismatch')
  }
  if (!isSameRevision(taskPackage.baseRevision, base.sourceRevision)) throw new Error('[internal] fixture_base_revision_mismatch')
  const changedPaths = [...new Set([...Object.keys(base.themeFiles), ...Object.keys(result.themeFiles)])].filter((path) => base.themeFiles[path] !== result.themeFiles[path]).sort()
  if (changedPaths.some((path) => !isPathAllowed(path, taskPackage.allowedPaths))) throw new Error('[internal] fixture_path_not_allowed')
  const artifacts = bundle.checks.flatMap((check) => {
    const refs = bundle.artifacts[check.checkId]
    if (!refs) throw new Error('[internal] fixture_check_artifact_missing')
    return ([['definition', check.testDefinitionHash], ['report', check.rawReportHash]] as const).map(([kind, hash]) => {
      const bytes = readArtifact(refs[kind])
      if (digestBytes(bytes) !== hash) throw new Error('[internal] fixture_check_hash_mismatch')
      return { path: refs[kind], sha256: hash, sizeBytes: bytes.length }
    })
  })
  return resultManifestV1Schema.parse({
    schemaVersion: 'delivery.result-manifest/v1', projectId: taskPackage.projectId, taskId: taskPackage.taskId,
    attemptId: taskPackage.attemptId, baselineId: taskPackage.baselineId, baselineHash: taskPackage.baselineHash,
    targetProfileVersion: taskPackage.targetProfileVersion, externalRunId: bundle.execution.externalRunId,
    baseRevision: base.sourceRevision, resultRevision: result.sourceRevision, changedPaths, artifacts, checks: bundle.checks,
    agentDeclaration: { summary: 'Synthetic mapping fixture; no tools executed and no live acceptance evidence', claimedAcIds: [] },
    findings: [], usage: { source: 'runner', values: 'unknown' },
  })
}

export function assessFixturePreview(input: { expiresAt: string; observedAt: string | null; buildId: string; observedBuildId: string | null }, now: string) {
  if (Date.parse(input.expiresAt) <= Date.parse(now)) return 'expired'
  if (!input.observedAt || !input.observedBuildId) return 'unverified'
  if (input.observedBuildId !== input.buildId || Date.parse(input.observedAt) > Date.parse(now)) return 'invalid_observation'
  return 'fixture_not_live'
}
