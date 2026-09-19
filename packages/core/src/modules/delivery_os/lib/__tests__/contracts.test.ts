import {
  ACTIVE_ATTEMPT_STATES,
  DELIVERY_CONTRACT_VERSION,
  DELIVERY_EXECUTION_CONTEXT_CONTRACT,
  DELIVERY_SCHEMA_VERSIONS,
  baselineContentV1Schema,
  buildDeliveryError,
  deliveryDocumentSchemas,
  deliveryErrorBodySchema,
  deliveryErrorCodes,
  designManifestV1Schema,
  executionAttemptSchema,
  executionAttemptsSchema,
  executionWidgetContextV1Schema,
  parseVersioned,
  planProposalV1Schema,
  requirementsProposalV1Schema,
  resultManifestV1Schema,
  sourceRevisionSchema,
  taskPackageV1Schema,
} from '../contracts'

const projectId = '11111111-1111-4111-8111-111111111111'
const taskId = '22222222-2222-4222-8222-222222222222'
const attemptId = '33333333-3333-4333-8333-333333333333'
const baselineId = '44444444-4444-4444-8444-444444444444'
const attachmentId = '55555555-5555-4555-8555-555555555555'
const actorUserId = '66666666-6666-4666-8666-666666666666'
const baselineHash = 'a'.repeat(64)
const otherHash = 'b'.repeat(64)
const baseCommit = 'c'.repeat(40)
const resultCommit = 'd'.repeat(40)
const testId = 'ServiceList AC-001: service list renders seeded services'

const gitRevision = (commitSha: string) => ({ kind: 'git' as const, commitSha })
const snapshotRevision = (contentHash: string) => ({
  kind: 'snapshot' as const,
  contentHash,
  externalWorkspaceId: 'wp-local-1',
})

const requirements = [{ id: 'REQ-1', title: 'Service list' }]
const acceptanceCriteria = [{ id: 'AC-001', requirementId: 'REQ-1', description: 'Seeded services are listed' }]
const screen = {
  fileKey: 'figmaFile',
  nodeId: '1:2',
  name: 'Service list',
  viewport: { width: 1440, height: 900 },
  attachmentId,
  sha256: otherHash,
  capturedAt: '2026-09-19T08:00:00.000Z',
}

function buildTaskPackage(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: DELIVERY_SCHEMA_VERSIONS.taskPackage,
    projectId,
    taskId,
    attemptId,
    baselineId,
    baselineHash,
    targetProfileId: 'react-vite',
    targetProfileVersion: 1,
    title: 'Service list with filtering',
    requirements,
    acceptanceCriteria,
    designArtifactRefs: [screen],
    repositoryRef: 'delivery-demo-react',
    baseRevision: gitRevision(baseCommit),
    baseCommit,
    allowedPaths: ['src/features/services/**'],
    validationProfile: {
      version: 1,
      requiredTests: { 'AC-001': [testId] },
      checks: [{ checkId: 'unit', commandProfileId: 'vitest', kind: 'test', required: true }],
    },
    limits: { maxParallelTasks: 2, maxCorrectionRounds: 2, attemptTimeoutMinutes: 20 },
    idempotencyKey: 'reserve-task-1-round-0',
    ...overrides,
  }
}

function buildCheck(overrides: Record<string, unknown> = {}) {
  return {
    checkId: 'unit-ac-001',
    testId,
    acIds: ['AC-001'],
    commandProfileId: 'vitest',
    validationProfileVersion: 1,
    testDefinitionHash: otherHash,
    status: 'passed',
    exitCode: 0,
    durationMs: 1200,
    sourceRevision: gitRevision(resultCommit),
    rawReportHash: baselineHash,
    ...overrides,
  }
}

function buildResultManifest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: DELIVERY_SCHEMA_VERSIONS.resultManifest,
    projectId,
    taskId,
    attemptId,
    baselineId,
    baselineHash,
    targetProfileVersion: 1,
    externalRunId: 'cezar-run-42',
    baseRevision: gitRevision(baseCommit),
    resultRevision: gitRevision(resultCommit),
    baseCommit,
    resultCommit,
    changedPaths: ['src/features/services/ServiceList.tsx'],
    artifacts: [{ path: 'reports/vitest-report.json', sha256: baselineHash }],
    checks: [buildCheck()],
    agentDeclaration: { summary: 'All tests pass', claimedAcIds: ['AC-001'] },
    findings: [],
    usage: { source: 'subscription', values: 'unknown' },
    ...overrides,
  }
}

function buildBaselineContent(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: DELIVERY_SCHEMA_VERSIONS.baselineContent,
    requirements,
    acceptanceCriteria,
    screens: [{ ...screen, fileKey: null, nodeId: null }],
    tokens: { color: { primary: '#112233' } },
    architectureSummary: null,
    planSummary: null,
    acTestMap: { 'AC-001': [testId] },
    manualChecks: {},
    declaredTests: [{ testId, file: 'src/features/services/ServiceList.test.tsx' }],
    attachments: [{ attachmentId, sha256: otherHash }],
    resolvedComments: [],
    importedManifestHashes: [],
    ...overrides,
  }
}

function buildPlanProposal(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: DELIVERY_SCHEMA_VERSIONS.planProposal,
    projectId,
    baselineId,
    baselineHash,
    manifestId: 'plan-2026-09-19-1',
    architectureSummary: 'Feature folders with a shared service store',
    tasks: [
      {
        proposalTaskKey: 'list',
        title: 'Service list',
        description: 'Render and filter services',
        acIds: ['AC-001'],
        dependsOn: [],
        allowedPaths: ['src/features/services/**'],
      },
      {
        proposalTaskKey: 'form',
        title: 'Service form',
        description: 'Create a service',
        acIds: ['AC-001'],
        dependsOn: ['list'],
        allowedPaths: ['src/features/service-form/**'],
      },
    ],
    acTestMap: { 'AC-001': [testId] },
    declaredTests: [{ testId, file: 'src/features/services/ServiceList.test.tsx' }],
    ...overrides,
  }
}

function buildAttempt(overrides: Record<string, unknown> = {}) {
  return {
    attemptId,
    idempotencyKey: 'reserve-task-1-round-0',
    payloadHash: otherHash,
    mode: 'manual_handoff',
    state: 'reserved',
    baselineId,
    baselineHash,
    baseRevision: gitRevision(baseCommit),
    baseCommit,
    reservedAt: '2026-09-19T08:00:00.000Z',
    claimedAt: null,
    workerRef: null,
    externalRunId: null,
    workflowRef: null,
    workflowStepId: null,
    dispatchedAt: null,
    cancellationRequestedAt: null,
    stopConfirmation: null,
    reconciliation: null,
    resultEvidenceId: null,
    completionDelivery: null,
    lastDeliveryError: null,
    closedAt: null,
    outcome: null,
    ...overrides,
  }
}

function attemptUuid(index: number): string {
  return `77777777-7777-4777-8777-${String(index).padStart(12, '0')}`
}

function expectFailure(result: ReturnType<typeof parseVersioned>) {
  if (result.ok) throw new Error('[internal] expected a failed parse')
  return result
}

function issueCodes(result: { success: boolean; error?: { issues: Array<{ code: string; params?: Record<string, unknown> }> } }) {
  return (result.error?.issues ?? []).map((issue) => issue.params?.deliveryCode ?? issue.code)
}

describe('delivery_os contracts v1', () => {
  it('exposes the frozen version constants', () => {
    expect(DELIVERY_CONTRACT_VERSION).toBe(1)
    expect(DELIVERY_EXECUTION_CONTEXT_CONTRACT).toBe('delivery_os.project.execution.v1')
    expect(DELIVERY_SCHEMA_VERSIONS.taskPackage).toBe('delivery.task-package/v1')
    expect(DELIVERY_SCHEMA_VERSIONS.resultManifest).toBe('delivery.result-manifest/v1')
  })

  describe('parseVersioned', () => {
    it('parses a known document and reports its version', () => {
      const result = parseVersioned(deliveryDocumentSchemas, buildTaskPackage())
      if (!result.ok || result.schemaVersion !== DELIVERY_SCHEMA_VERSIONS.taskPackage) {
        throw new Error('[internal] expected a parsed task package')
      }
      expect(result.data.attemptId).toBe(attemptId)
    })

    it.each([
      ['unknown version', buildTaskPackage({ schemaVersion: 'delivery.task-package/v2' })],
      ['undefined version', { ...buildTaskPackage(), schemaVersion: undefined }],
      ['absent version key', Object.fromEntries(Object.entries(buildTaskPackage()).filter(([key]) => key !== 'schemaVersion'))],
      ['numeric version', buildTaskPackage({ schemaVersion: 1 })],
      ['inherited key', buildTaskPackage({ schemaVersion: 'constructor' })],
      ['non-object input', 'delivery.task-package/v1'],
      ['null input', null],
    ])('rejects %s with unsupported_schema_version', (_label, input) => {
      const result = expectFailure(parseVersioned(deliveryDocumentSchemas, input))
      expect(result.status).toBe(422)
      expect(result.body.code).toBe('unsupported_schema_version')
      expect(deliveryErrorBodySchema.safeParse(result.body).success).toBe(true)
    })

    it('rejects the version before looking at the shape', () => {
      const result = expectFailure(parseVersioned(deliveryDocumentSchemas, { schemaVersion: 'delivery.unknown/v9', taskId: 5 }))
      expect(result.body.code).toBe('unsupported_schema_version')
      expect(result.body.details).toHaveLength(1)
      expect(result.body.details[0].path).toBe('schemaVersion')
    })

    it('rejects a valid document posted where another document type is expected', () => {
      const onlyManifests = { [DELIVERY_SCHEMA_VERSIONS.resultManifest]: resultManifestV1Schema }
      expect(parseVersioned(onlyManifests, buildResultManifest()).ok).toBe(true)
      const result = expectFailure(parseVersioned(onlyManifests, buildTaskPackage()))
      expect(result.body.code).toBe('unsupported_schema_version')
    })

    it('reports shape problems as validation_failed with paths', () => {
      const result = expectFailure(parseVersioned(deliveryDocumentSchemas, buildTaskPackage({ taskId: 'not-a-uuid' })))
      expect(result.status).toBe(400)
      expect(result.body.code).toBe('validation_failed')
      expect(result.body.details.map((detail) => detail.path)).toContain('taskId')
    })

    it('reports validation_failed when a shape problem and a rule violation occur together', () => {
      const input = buildTaskPackage({ allowedPaths: ['/etc/passwd'], targetProfileVersion: 0 })
      const result = expectFailure(parseVersioned(deliveryDocumentSchemas, input))
      expect(result.body.code).toBe('validation_failed')
      expect(result.body.details.map((detail) => detail.code)).toContain('path_not_allowed')
    })

    it('rejects a snapshot revision that carries a commit sha inside a document', () => {
      const input = buildTaskPackage({
        baseRevision: { ...snapshotRevision(otherHash), commitSha: baseCommit },
        baseCommit: undefined,
      })
      const result = expectFailure(parseVersioned(deliveryDocumentSchemas, input))
      expect(result.body.code).toBe('validation_failed')
      expect(result.body.details[0]).toMatchObject({ path: 'baseRevision', code: 'unrecognized_keys' })
    })

    it('rejects a document nested deeper than the limit without throwing', () => {
      let tokens: Record<string, unknown> = {}
      for (let index = 0; index < 5000; index += 1) tokens = { child: tokens }
      const manifest = { schemaVersion: DELIVERY_SCHEMA_VERSIONS.designManifest, screens: [screen], tokens }
      const result = expectFailure(parseVersioned(deliveryDocumentSchemas, manifest))
      expect(result.status).toBe(413)
      expect(result.body.code).toBe('payload_too_large')
      expect(parseVersioned(deliveryDocumentSchemas, { ...manifest, tokens: { color: { primary: { value: '#000' } } } }).ok).toBe(true)
    })

    it('reports a rule violation with its delivery code and status', () => {
      const result = expectFailure(parseVersioned(deliveryDocumentSchemas, buildTaskPackage({ baseCommit: undefined })))
      expect(result.status).toBe(422)
      expect(result.body.code).toBe('revision_kind_mismatch')
      expect(result.body.details[0]).toMatchObject({ path: 'baseCommit', code: 'revision_kind_mismatch' })
    })
  })

  describe('source revision', () => {
    it('accepts git and snapshot variants', () => {
      expect(sourceRevisionSchema.safeParse(gitRevision(baseCommit)).success).toBe(true)
      expect(sourceRevisionSchema.safeParse(snapshotRevision(baselineHash)).success).toBe(true)
    })

    it('rejects a snapshot that carries a commit sha', () => {
      expect(sourceRevisionSchema.safeParse({ ...snapshotRevision(baselineHash), commitSha: baseCommit }).success).toBe(false)
    })

    it('rejects a git revision without or with a malformed commit sha', () => {
      expect(sourceRevisionSchema.safeParse({ kind: 'git' }).success).toBe(false)
      expect(sourceRevisionSchema.safeParse(gitRevision('HEAD')).success).toBe(false)
    })

    it('rejects an unknown revision kind', () => {
      expect(sourceRevisionSchema.safeParse({ kind: 'svn', revision: '12' }).success).toBe(false)
    })
  })

  describe('task package', () => {
    it('accepts a git package with baseCommit and a snapshot package without it', () => {
      expect(taskPackageV1Schema.safeParse(buildTaskPackage()).success).toBe(true)
      const snapshotPackage = buildTaskPackage({ baseRevision: snapshotRevision(otherHash), baseCommit: undefined })
      expect(taskPackageV1Schema.safeParse(snapshotPackage).success).toBe(true)
    })

    it('rejects a git package without baseCommit', () => {
      expect(issueCodes(taskPackageV1Schema.safeParse(buildTaskPackage({ baseCommit: undefined })))).toEqual([
        'revision_kind_mismatch',
      ])
    })

    it('rejects a git package whose baseCommit differs from the revision', () => {
      expect(issueCodes(taskPackageV1Schema.safeParse(buildTaskPackage({ baseCommit: resultCommit })))).toEqual([
        'revision_kind_mismatch',
      ])
    })

    it('rejects a snapshot package with an invented baseCommit', () => {
      const result = taskPackageV1Schema.safeParse(buildTaskPackage({ baseRevision: snapshotRevision(otherHash) }))
      expect(issueCodes(result)).toEqual(['revision_kind_mismatch'])
    })

    it.each([
      ['/etc/passwd'],
      ['../outside/file.ts'],
      ['src/../../secret'],
      ['C:\\repo\\file.ts'],
      ['~/.ssh/id_rsa'],
      ['src//file.ts'],
      ['./src/file.ts'],
      ['src/file.ts\n'],
    ])(
      'rejects the allowed path %s',
      (path) => {
        const result = taskPackageV1Schema.safeParse(buildTaskPackage({ allowedPaths: [path] }))
        expect(issueCodes(result)).toContain('path_not_allowed')
      },
    )

    it('rejects required tests for an acceptance criterion outside the package', () => {
      const validationProfile = { version: 1, requiredTests: { 'AC-999': [testId] }, checks: [] }
      expect(issueCodes(taskPackageV1Schema.safeParse(buildTaskPackage({ validationProfile })))).toEqual(['unknown_ac'])
    })

    it('keeps an acceptance criterion with an empty required test set parseable', () => {
      const validationProfile = { version: 1, requiredTests: { 'AC-001': [] }, checks: [] }
      expect(taskPackageV1Schema.safeParse(buildTaskPackage({ validationProfile })).success).toBe(true)
    })
  })

  describe('result manifest', () => {
    it('accepts a git manifest and a snapshot manifest without commits', () => {
      expect(resultManifestV1Schema.safeParse(buildResultManifest()).success).toBe(true)
      const snapshotManifest = buildResultManifest({
        baseRevision: snapshotRevision(baselineHash),
        resultRevision: snapshotRevision(otherHash),
        baseCommit: undefined,
        resultCommit: undefined,
        checks: [buildCheck({ sourceRevision: snapshotRevision(otherHash) })],
      })
      expect(resultManifestV1Schema.safeParse(snapshotManifest).success).toBe(true)
    })

    it('rejects a git manifest without resultCommit', () => {
      expect(issueCodes(resultManifestV1Schema.safeParse(buildResultManifest({ resultCommit: undefined })))).toEqual([
        'revision_kind_mismatch',
      ])
    })

    it('rejects a snapshot manifest with an invented commit', () => {
      const manifest = buildResultManifest({
        baseRevision: snapshotRevision(baselineHash),
        resultRevision: snapshotRevision(otherHash),
        baseCommit: undefined,
        checks: [buildCheck({ sourceRevision: snapshotRevision(otherHash) })],
      })
      expect(issueCodes(resultManifestV1Schema.safeParse(manifest))).toEqual(['revision_kind_mismatch'])
    })

    it('rejects mixed revision kinds and a missing result revision', () => {
      const mixed = buildResultManifest({
        resultRevision: snapshotRevision(otherHash),
        resultCommit: undefined,
        checks: [buildCheck({ sourceRevision: snapshotRevision(otherHash) })],
      })
      expect(issueCodes(resultManifestV1Schema.safeParse(mixed))).toEqual(['revision_kind_mismatch'])
      expect(resultManifestV1Schema.safeParse(buildResultManifest({ resultRevision: undefined })).success).toBe(false)
    })

    it.each([['passed'], ['failed'], ['not_run']])('accepts the check status %s', (status) => {
      expect(resultManifestV1Schema.safeParse(buildResultManifest({ checks: [buildCheck({ status })] })).success).toBe(true)
    })

    it.each([['skipped'], ['todo'], ['PASS'], ['unknown']])('rejects the check status %s', (status) => {
      expect(resultManifestV1Schema.safeParse(buildResultManifest({ checks: [buildCheck({ status })] })).success).toBe(false)
    })

    it('requires the raw report hash and the test definition hash on every check', () => {
      const withoutReport = buildResultManifest({ checks: [buildCheck({ rawReportHash: undefined })] })
      const withoutDefinition = buildResultManifest({ checks: [buildCheck({ testDefinitionHash: 'abc' })] })
      expect(resultManifestV1Schema.safeParse(withoutReport).success).toBe(false)
      expect(resultManifestV1Schema.safeParse(withoutDefinition).success).toBe(false)
    })

    it('rejects a check that ran on another revision than the result', () => {
      const otherCommit = buildResultManifest({ checks: [buildCheck({ sourceRevision: gitRevision(baseCommit) })] })
      const otherKind = buildResultManifest({ checks: [buildCheck({ sourceRevision: snapshotRevision(otherHash) })] })
      expect(issueCodes(resultManifestV1Schema.safeParse(otherCommit))).toEqual(['revision_mismatch'])
      expect(issueCodes(resultManifestV1Schema.safeParse(otherKind))).toEqual(['revision_mismatch'])
    })

    it('rejects duplicate check ids', () => {
      const manifest = buildResultManifest({ checks: [buildCheck(), buildCheck()] })
      expect(issueCodes(resultManifestV1Schema.safeParse(manifest))).toEqual(['duplicate_stable_id'])
    })

    it('keeps unknown usage distinct from a measured zero', () => {
      const unknownUsage = resultManifestV1Schema.parse(buildResultManifest())
      const zeroUsage = resultManifestV1Schema.parse(
        buildResultManifest({ usage: { source: 'provider', values: { costUsd: 0, totalTokens: 0 } } }),
      )
      expect(unknownUsage.usage.values).toBe('unknown')
      expect(zeroUsage.usage.values).toEqual({ costUsd: 0, totalTokens: 0 })
      expect(zeroUsage.usage.values).not.toBe('unknown')
    })

    it('rejects empty, null and negative usage values', () => {
      for (const values of [{}, null, { costUsd: -1 }, 0]) {
        const manifest = buildResultManifest({ usage: { source: 'provider', values } })
        expect(resultManifestV1Schema.safeParse(manifest).success).toBe(false)
      }
    })

    it('keeps the agent declaration separate from checks and optional', () => {
      const parsed = resultManifestV1Schema.parse(buildResultManifest({ agentDeclaration: undefined, checks: [] }))
      expect(parsed.agentDeclaration).toBeUndefined()
      expect(parsed.checks).toEqual([])
    })

    it('never carries tenant or organization scope from a manifest at every level', () => {
      const parsed = resultManifestV1Schema.parse(
        buildResultManifest({
          tenantId: projectId,
          organizationId: projectId,
          tenant_id: projectId,
          checks: [buildCheck({ tenantId: projectId })],
          usage: { source: 'subscription', values: 'unknown', organizationId: projectId },
        }),
      )
      expect(JSON.stringify(parsed)).not.toMatch(/tenant|organi[sz]ation/i)
    })

    it('declares no tenant or organization field in a transport document', () => {
      for (const schema of Object.values(deliveryDocumentSchemas)) {
        expect(Object.keys(schema.shape).filter((key) => /tenant|organi[sz]ation/i.test(key))).toEqual([])
      }
    })
  })

  describe('baseline content', () => {
    it('accepts a manual baseline with a snapshot screen without figma refs', () => {
      expect(baselineContentV1Schema.safeParse(buildBaselineContent()).success).toBe(true)
    })

    it('rejects a baseline without acceptance criteria', () => {
      const result = baselineContentV1Schema.safeParse(buildBaselineContent({ acceptanceCriteria: [], acTestMap: {} }))
      expect(issueCodes(result)).toEqual(['missing_acceptance_criteria'])
    })

    it('rejects duplicate stable ids', () => {
      const duplicated = [...acceptanceCriteria, { ...acceptanceCriteria[0], description: 'Same id again' }]
      const result = baselineContentV1Schema.safeParse(buildBaselineContent({ acceptanceCriteria: duplicated }))
      expect(issueCodes(result)).toEqual(['duplicate_stable_id'])
    })

    it('rejects a test mapping or manual check for an unknown acceptance criterion', () => {
      const mapped = baselineContentV1Schema.safeParse(buildBaselineContent({ acTestMap: { 'AC-404': [testId] } }))
      const manual = baselineContentV1Schema.safeParse(buildBaselineContent({ manualChecks: { 'AC-404': 'MC-1' } }))
      expect(issueCodes(mapped)).toEqual(['unknown_ac'])
      expect(issueCodes(manual)).toEqual(['unknown_ac'])
      expect(baselineContentV1Schema.safeParse(buildBaselineContent({ manualChecks: { 'AC-001': 'MC-1' } })).success).toBe(true)
    })

    it('rejects an acceptance criterion of an unknown requirement', () => {
      const orphan = [{ ...acceptanceCriteria[0], requirementId: 'REQ-404' }]
      const result = baselineContentV1Schema.safeParse(buildBaselineContent({ acceptanceCriteria: orphan }))
      expect(issueCodes(result)).toEqual(['foreign_reference'])
    })

    it('requires a hash on screens and attachments', () => {
      const screenWithoutHash = buildBaselineContent({ screens: [{ ...screen, sha256: undefined }] })
      const attachmentWithoutHash = buildBaselineContent({ attachments: [{ attachmentId }] })
      expect(baselineContentV1Schema.safeParse(screenWithoutHash).success).toBe(false)
      expect(baselineContentV1Schema.safeParse(attachmentWithoutHash).success).toBe(false)
    })

    it('rejects a comment anchor outside 0-1 and accepts one inside', () => {
      const comment = { id: 'C-1', screenAttachmentId: attachmentId, anchor: { x: 0.5, y: 1 }, body: 'Align', resolution: 'Done' }
      expect(baselineContentV1Schema.safeParse(buildBaselineContent({ resolvedComments: [comment] })).success).toBe(true)
      const outside = { ...comment, anchor: { x: 1.2, y: 0.5 } }
      const result = baselineContentV1Schema.safeParse(buildBaselineContent({ resolvedComments: [outside] }))
      expect(issueCodes(result)).toEqual(['invalid_comment_anchor'])
    })
  })

  describe('proposals and design manifest', () => {
    const requirementsProposal = {
      schemaVersion: DELIVERY_SCHEMA_VERSIONS.requirementsProposal,
      projectId,
      manifestId: 'req-2026-09-19-1',
      requirements,
      acceptanceCriteria,
      questions: [{ id: 'Q-1', text: 'Which currencies?' }],
      risks: [{ id: 'R-1', text: 'Unclear pricing rules' }],
      producedBy: { tool: 'claude-code', sessionRef: null },
    }

    it('accepts a requirements proposal and rejects duplicate ids', () => {
      expect(requirementsProposalV1Schema.safeParse(requirementsProposal).success).toBe(true)
      const duplicated = { ...requirementsProposal, requirements: [...requirements, ...requirements] }
      expect(issueCodes(requirementsProposalV1Schema.safeParse(duplicated))).toEqual(['duplicate_stable_id'])
    })

    it('accepts a plan with dependencies inside the proposal', () => {
      expect(planProposalV1Schema.safeParse(buildPlanProposal()).success).toBe(true)
    })

    it('rejects a dependency on a task outside the proposal and on itself', () => {
      const [list, form] = buildPlanProposal().tasks
      const foreign = buildPlanProposal({ tasks: [list, { ...form, dependsOn: ['other-project-task'] }] })
      const selfReference = buildPlanProposal({ tasks: [{ ...list, dependsOn: ['list'] }, form] })
      expect(issueCodes(planProposalV1Schema.safeParse(foreign))).toEqual(['foreign_dependency'])
      expect(issueCodes(planProposalV1Schema.safeParse(selfReference))).toEqual(['cycle'])
    })

    it('rejects duplicate task keys and illegal allowed paths', () => {
      const [list] = buildPlanProposal().tasks
      const duplicated = buildPlanProposal({ tasks: [list, list] })
      const escaping = buildPlanProposal({ tasks: [{ ...list, allowedPaths: ['../../etc'] }] })
      expect(issueCodes(planProposalV1Schema.safeParse(duplicated))).toEqual(['duplicate_stable_id'])
      expect(issueCodes(planProposalV1Schema.safeParse(escaping))).toEqual(['path_not_allowed'])
    })

    it('requires figma refs and at least one screen in a design manifest', () => {
      const manifest = { schemaVersion: DELIVERY_SCHEMA_VERSIONS.designManifest, screens: [screen], tokens: {} }
      expect(designManifestV1Schema.safeParse(manifest).success).toBe(true)
      expect(designManifestV1Schema.safeParse({ ...manifest, screens: [] }).success).toBe(false)
      expect(designManifestV1Schema.safeParse({ ...manifest, screens: [{ ...screen, nodeId: null }] }).success).toBe(false)
    })
  })

  describe('execution attempts', () => {
    it('accepts a reserved manual attempt and the automatic mode value', () => {
      expect(executionAttemptSchema.safeParse(buildAttempt()).success).toBe(true)
      expect(executionAttemptSchema.safeParse(buildAttempt({ mode: 'automatic' })).success).toBe(true)
      expect(executionAttemptSchema.safeParse(buildAttempt({ mode: 'yolo' })).success).toBe(false)
    })

    it('applies the git and snapshot commit rule to stored attempts', () => {
      expect(issueCodes(executionAttemptSchema.safeParse(buildAttempt({ baseCommit: null })))).toEqual(['revision_kind_mismatch'])
      const snapshotAttempt = buildAttempt({ baseRevision: snapshotRevision(otherHash), baseCommit: null })
      expect(executionAttemptSchema.safeParse(snapshotAttempt).success).toBe(true)
    })

    it('treats reserved, claimed and cancel_requested as active', () => {
      expect([...ACTIVE_ATTEMPT_STATES].sort()).toEqual(['cancel_requested', 'claimed', 'reserved'])
    })

    it('accepts sixteen attempts and rejects the seventeenth', () => {
      const closedAttempts = (count: number) =>
        Array.from({ length: count }, (_unused, index) =>
          buildAttempt({ attemptId: attemptUuid(index), idempotencyKey: `key-${index}`, state: 'closed' }),
        )
      expect(executionAttemptsSchema.safeParse(closedAttempts(16)).success).toBe(true)
      expect(issueCodes(executionAttemptsSchema.safeParse(closedAttempts(17)))).toEqual(['attempt_limit_reached'])
    })

    it('rejects two active attempts and a reused idempotency key', () => {
      const first = buildAttempt({ attemptId: attemptUuid(1), idempotencyKey: 'key-1' })
      const second = buildAttempt({ attemptId: attemptUuid(2), idempotencyKey: 'key-2', state: 'claimed' })
      expect(issueCodes(executionAttemptsSchema.safeParse([first, second]))).toEqual(['attempt_active'])
      const reusedKey = buildAttempt({ attemptId: attemptUuid(2), idempotencyKey: 'key-1', state: 'closed' })
      expect(issueCodes(executionAttemptsSchema.safeParse([first, reusedKey]))).toEqual(['idempotency_conflict'])
      expect(executionAttemptsSchema.safeParse([first, { ...second, state: 'closed' }]).success).toBe(true)
    })

    it('accepts a reconciliation record with a human actor', () => {
      const reconciliation = {
        resolution: 'unknown',
        note: 'Process not found after restart',
        observedAt: '2026-09-19T09:00:00.000Z',
        actorUserId,
        resolvedAt: '2026-09-19T09:01:00.000Z',
      }
      expect(executionAttemptSchema.safeParse(buildAttempt({ state: 'reconciliation_required', reconciliation })).success).toBe(true)
      const invalid = { ...reconciliation, resolution: 'retry' }
      expect(executionAttemptSchema.safeParse(buildAttempt({ reconciliation: invalid })).success).toBe(false)
    })
  })

  describe('execution widget context', () => {
    const context = {
      schemaVersion: DELIVERY_EXECUTION_CONTEXT_CONTRACT,
      projectId,
      taskId: null,
      baselineId: null,
      updatedAt: '2026-09-19T08:00:00.000Z',
      retryLastMutation: async () => true,
      refresh: () => undefined,
    }

    it('accepts the documented context', () => {
      expect(executionWidgetContextV1Schema.safeParse(context).success).toBe(true)
    })

    it('rejects a context without callable refresh or with another contract id', () => {
      expect(executionWidgetContextV1Schema.safeParse({ ...context, refresh: 'reload' }).success).toBe(false)
      expect(executionWidgetContextV1Schema.safeParse({ ...context, schemaVersion: 'delivery_os.project.execution.v2' }).success).toBe(false)
    })
  })

  describe('error catalogue', () => {
    it('maps the frozen codes to their HTTP status', () => {
      expect(deliveryErrorCodes).toEqual({
        validation_failed: 400,
        idempotency_key_required: 400,
        forbidden: 403,
        not_found: 404,
        attempt_not_found: 404,
        optimistic_lock_conflict: 409,
        idempotency_conflict: 409,
        attempt_active: 409,
        attempt_limit_reached: 409,
        attempt_not_active: 409,
        attempt_not_reconcilable: 409,
        attempt_cancelled: 409,
        attempt_closed: 409,
        reconciliation_required: 409,
        dependency_not_verified: 409,
        task_not_ready: 409,
        invalid_transition: 409,
        result_conflict: 409,
        subject_hash_mismatch: 409,
        correction_limit_reached: 409,
        payload_too_large: 413,
        unsupported_schema_version: 422,
        unknown_target_profile: 422,
        foreign_reference: 422,
        unknown_ac: 422,
        unknown_test_id: 422,
        cycle: 422,
        foreign_dependency: 422,
        path_not_allowed: 422,
        duplicate_stable_id: 422,
        invalid_comment_anchor: 422,
        missing_acceptance_criteria: 422,
        missing_render: 422,
        temporary_url_only: 422,
        missing_required_tests: 422,
        attachment_scope_mismatch: 422,
        attachment_hash_mismatch: 422,
        hash_mismatch: 422,
        baseline_not_approved: 422,
        baseline_not_active: 422,
        correlation_mismatch: 422,
        baseline_mismatch: 422,
        base_revision_mismatch: 422,
        revision_kind_mismatch: 422,
        manifest_required: 422,
        reason_required: 422,
        report_not_green: 422,
        deployment_unverified: 422,
        deployment_incomplete: 422,
        revision_mismatch: 422,
        deploy_decision_missing: 422,
        invalid_revision: 422,
        unsupported_evidence_kind: 422,
        optimistic_lock_required: 428,
      })
    })

    it('builds the documented error body', () => {
      const error = buildDeliveryError('result_conflict', 'A different result is already stored', [
        { path: 'manifest', code: 'result_conflict' },
      ])
      expect(error).toEqual({
        status: 409,
        body: {
          error: 'A different result is already stored',
          code: 'result_conflict',
          details: [{ path: 'manifest', code: 'result_conflict' }],
        },
      })
      expect(deliveryErrorBodySchema.safeParse(error.body).success).toBe(true)
    })

    it('rejects an error body with a code outside the catalogue or without details', () => {
      expect(deliveryErrorBodySchema.safeParse({ error: 'x', code: 'made_up', details: [] }).success).toBe(false)
      expect(deliveryErrorBodySchema.safeParse({ error: 'x', code: 'not_found' }).success).toBe(false)
    })
  })
})
