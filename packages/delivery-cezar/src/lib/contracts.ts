import { z } from 'zod'

// ---------------------------------------------------------------------------
// Shared sub-schemas
// ---------------------------------------------------------------------------

export const sourceRevisionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('git'),
    commitSha: z.string().min(1),
  }),
  z.object({
    kind: z.literal('snapshot'),
    contentHash: z.string().min(1),
    externalWorkspaceId: z.string().min(1),
  }),
])

export type SourceRevision = z.infer<typeof sourceRevisionSchema>

// ---------------------------------------------------------------------------
// TaskPackage v1
// ---------------------------------------------------------------------------

const requirementSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().optional(),
})

const acSchema = z.object({
  id: z.string().uuid(),
  requirementId: z.string().uuid(),
  description: z.string().min(1),
  requiredTestIds: z.array(z.string()),
})

const designArtifactRefSchema = z.object({
  kind: z.enum(['figma_frame', 'screenshot', 'url']),
  ref: z.string(),
  snapshotHash: z.string().optional(),
})

const repositoryRefSchema = z.object({
  url: z.string().url(),
  branch: z.string().optional(),
})

const validationProfileSchema = z.object({
  id: z.string(),
  version: z.string(),
  checks: z
    .array(
      z.object({
        checkId: z.string(),
        command: z.string(),
        testIds: z.array(z.string()),
      }),
    )
    .optional(),
})

const limitsSchema = z.object({
  maxDurationMs: z.number().int().positive(),
  maxIterations: z.number().int().positive().optional(),
})

export const taskPackageSchema = z.object({
  schemaVersion: z.literal('1'),
  projectId: z.string().uuid(),
  taskId: z.string().uuid(),
  attemptId: z.string().uuid(),
  baselineId: z.string().uuid(),
  baselineHash: z.string().startsWith('sha256:'),
  targetProfileId: z.string().min(1),
  targetProfileVersion: z.string().min(1),
  requirements: z.array(requirementSchema),
  ac: z.array(acSchema),
  designArtifactRefs: z.array(designArtifactRefSchema).optional(),
  repositoryRef: repositoryRefSchema.optional(),
  baseCommit: z.string().optional(),
  allowedPaths: z.array(z.string()),
  validationProfile: validationProfileSchema,
  limits: limitsSchema,
  idempotencyKey: z.string().min(1),
})

export type TaskPackage = z.infer<typeof taskPackageSchema>

// ---------------------------------------------------------------------------
// ResultManifest v1
// ---------------------------------------------------------------------------

const artifactSchema = z.object({
  path: z.string(),
  hash: z.string(),
  sizeBytes: z.number().int().optional(),
  mimeType: z.string().optional(),
})

const checkResultSchema = z.object({
  checkId: z.string(),
  testId: z.string().optional(),
  acIds: z.array(z.string()),
  validationProfileVersion: z.string(),
  testDefinitionHash: z.string().optional(),
  command: z.string().optional(),
  exitCode: z.number().int().optional(),
  durationMs: z.number().optional(),
  status: z.enum(['passed', 'failed', 'not_run']),
  sourceRevision: sourceRevisionSchema,
  rawReportHash: z.string().optional(),
})

const findingSchema = z.object({
  id: z.string(),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
  category: z.string(),
  description: z.string(),
  path: z.string().optional(),
  line: z.number().int().optional(),
})

const usageEntrySchema = z.object({
  source: z.string(),
  inputTokens: z.number().int().optional(),
  outputTokens: z.number().int().optional(),
  cacheReadTokens: z.number().int().optional(),
  costUsd: z.union([z.number(), z.literal('unknown')]).optional(),
})

export const resultManifestSchema = z.object({
  schemaVersion: z.literal('1'),
  taskId: z.string().uuid(),
  attemptId: z.string().uuid(),
  baselineId: z.string().uuid(),
  baselineHash: z.string().startsWith('sha256:'),
  externalRunId: z.string().optional(),
  baseCommit: z.string().optional(),
  resultCommit: z.string().optional(),
  changedPaths: z.array(z.string()),
  artifacts: z.array(artifactSchema),
  checks: z.array(checkResultSchema),
  agentDeclaration: z.string().optional(),
  findings: z.array(findingSchema),
  usage: z.array(usageEntrySchema),
  sourceRevision: sourceRevisionSchema,
})

export type ResultManifest = z.infer<typeof resultManifestSchema>

export function parseTaskPackage(raw: unknown): TaskPackage {
  return taskPackageSchema.parse(raw)
}

export function parseResultManifest(raw: unknown): ResultManifest {
  return resultManifestSchema.parse(raw)
}
