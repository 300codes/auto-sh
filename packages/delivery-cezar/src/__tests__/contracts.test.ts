import { taskPackageSchema, resultManifestSchema, parseTaskPackage, parseResultManifest } from '../lib/contracts'
import { redactTaskPackageForLogs, redactResultManifestForLogs } from '../lib/logRedaction'
import type { TaskPackage, ResultManifest } from '../lib/contracts'

// UUIDs must match RFC 4122: group 3 starts with [1-8], group 4 starts with [89abAB]
const P_ID = '00000001-0000-4000-8000-000000000001'
const T_ID = '00000001-0000-4000-8000-000000000002'
const A_ID = '00000001-0000-4000-8000-000000000003'
const B_ID = '00000001-0000-4000-8000-000000000004'
const REQ_ID = '00000001-0000-4000-8000-000000000010'
const AC_ID = '00000001-0000-4000-8000-000000000020'

const VALID_TASK_PACKAGE: TaskPackage = {
  schemaVersion: '1',
  projectId: P_ID,
  taskId: T_ID,
  attemptId: A_ID,
  baselineId: B_ID,
  baselineHash: 'sha256:abc123def456abc123def456abc123def456abc123def456abc123def456abc1',
  targetProfileId: 'react',
  targetProfileVersion: '1',
  requirements: [
    {
      id: REQ_ID,
      title: 'User can filter the service list',
      description: 'Dropdown with category and free-text search',
    },
  ],
  ac: [
    {
      id: AC_ID,
      requirementId: REQ_ID,
      description: 'Filter by category shows only matching items',
      requiredTestIds: ['TC-REACT-FILTER-001'],
    },
  ],
  designArtifactRefs: [],
  repositoryRef: { url: 'https://github.com/example/react-app', branch: 'main' },
  baseCommit: 'abc123def456',
  allowedPaths: ['src/', 'public/'],
  validationProfile: { id: 'react-vite', version: '1' },
  limits: { maxDurationMs: 20 * 60 * 1000 },
  idempotencyKey: 'idkey-secret-value',
}

const VALID_RESULT_MANIFEST: ResultManifest = {
  schemaVersion: '1',
  taskId: T_ID,
  attemptId: A_ID,
  baselineId: B_ID,
  baselineHash: 'sha256:abc123def456abc123def456abc123def456abc123def456abc123def456abc1',
  externalRunId: 'run-853be9d6',
  baseCommit: 'abc123def456',
  resultCommit: 'def789abc012',
  changedPaths: ['src/ServiceList.tsx', 'src/ServiceList.test.tsx'],
  artifacts: [{ path: 'dist/index.js', hash: 'sha256:aaa' }],
  checks: [
    {
      checkId: 'TC-REACT-FILTER-001',
      acIds: [AC_ID],
      validationProfileVersion: '1',
      command: 'npm test',
      exitCode: 0,
      status: 'passed',
      sourceRevision: { kind: 'git', commitSha: 'def789abc012' },
    },
  ],
  agentDeclaration: 'cezar/claude',
  findings: [],
  usage: [{ source: 'cezar', outputTokens: 43979, costUsd: 'unknown' }],
  sourceRevision: { kind: 'git', commitSha: 'def789abc012' },
}

describe('TaskPackage v1 schema', () => {
  it('accepts a valid TaskPackage', () => {
    expect(() => taskPackageSchema.parse(VALID_TASK_PACKAGE)).not.toThrow()
  })

  it('rejects unknown schemaVersion', () => {
    expect(() =>
      taskPackageSchema.parse({ ...VALID_TASK_PACKAGE, schemaVersion: '2' }),
    ).toThrow()
  })

  it('rejects missing taskId', () => {
    const { taskId: _, ...rest } = VALID_TASK_PACKAGE
    expect(() => taskPackageSchema.parse(rest)).toThrow()
  })

  it('rejects non-uuid taskId', () => {
    expect(() =>
      taskPackageSchema.parse({ ...VALID_TASK_PACKAGE, taskId: 'not-a-uuid' }),
    ).toThrow()
  })

  it('rejects baselineHash without sha256: prefix', () => {
    expect(() =>
      taskPackageSchema.parse({ ...VALID_TASK_PACKAGE, baselineHash: 'abc123' }),
    ).toThrow()
  })

  it('rejects negative maxDurationMs', () => {
    expect(() =>
      taskPackageSchema.parse({ ...VALID_TASK_PACKAGE, limits: { maxDurationMs: -1 } }),
    ).toThrow()
  })

  it('parses via parseTaskPackage helper', () => {
    const result = parseTaskPackage(VALID_TASK_PACKAGE)
    expect(result.schemaVersion).toBe('1')
    expect(result.taskId).toBe(VALID_TASK_PACKAGE.taskId)
  })
})

describe('ResultManifest v1 schema', () => {
  it('accepts a valid ResultManifest', () => {
    expect(() => resultManifestSchema.parse(VALID_RESULT_MANIFEST)).not.toThrow()
  })

  it('rejects unknown schemaVersion', () => {
    expect(() =>
      resultManifestSchema.parse({ ...VALID_RESULT_MANIFEST, schemaVersion: '2' }),
    ).toThrow()
  })

  it('rejects invalid check status', () => {
    const badManifest = {
      ...VALID_RESULT_MANIFEST,
      checks: [{ ...VALID_RESULT_MANIFEST.checks[0], status: 'maybe' }],
    }
    expect(() => resultManifestSchema.parse(badManifest)).toThrow()
  })

  it('rejects invalid sourceRevision kind', () => {
    expect(() =>
      resultManifestSchema.parse({
        ...VALID_RESULT_MANIFEST,
        sourceRevision: { kind: 'unknown', ref: 'whatever' },
      }),
    ).toThrow()
  })

  it('accepts snapshot sourceRevision', () => {
    const withSnapshot = {
      ...VALID_RESULT_MANIFEST,
      baseCommit: undefined,
      resultCommit: undefined,
      sourceRevision: { kind: 'snapshot', contentHash: 'sha256:aaa', externalWorkspaceId: 'ws-123' },
    }
    expect(() => resultManifestSchema.parse(withSnapshot)).not.toThrow()
  })

  it('parses via parseResultManifest helper', () => {
    const result = parseResultManifest(VALID_RESULT_MANIFEST)
    expect(result.schemaVersion).toBe('1')
    expect(result.checks[0].status).toBe('passed')
  })
})

describe('Log redaction', () => {
  it('redacts idempotencyKey from TaskPackage', () => {
    const redacted = redactTaskPackageForLogs(VALID_TASK_PACKAGE)
    expect(redacted.idempotencyKey).toBe('[REDACTED]')
  })

  it('preserves projectId and taskId after redaction', () => {
    const redacted = redactTaskPackageForLogs(VALID_TASK_PACKAGE)
    expect(redacted.projectId).toBe(VALID_TASK_PACKAGE.projectId)
    expect(redacted.taskId).toBe(VALID_TASK_PACKAGE.taskId)
  })

  it('strips cacheReadTokens from ResultManifest usage', () => {
    const manifestWithCache: ResultManifest = {
      ...VALID_RESULT_MANIFEST,
      usage: [{ source: 'cezar', cacheReadTokens: 35171, outputTokens: 43979, costUsd: 'unknown' }],
    }
    const redacted = redactResultManifestForLogs(manifestWithCache)
    expect((redacted.usage[0] as Record<string, unknown>).cacheReadTokens).toBeUndefined()
    expect(redacted.usage[0].source).toBe('cezar')
  })
})
