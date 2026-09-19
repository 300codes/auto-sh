import type { z } from 'zod'
import { deliveryErrorFromZod } from '../../lib/contracts'
import {
  USER_SETTABLE_TASK_STATUSES,
  baselineCreateSchema,
  baselineDecisionSchema,
  cancelAttemptSchema,
  deployDecisionSchema,
  draftSpecV1Schema,
  idempotencyKeyHeaderSchema,
  packageQuerySchema,
  parseRecordEvidenceBody,
  projectCreateSchema,
  projectListQuerySchema,
  projectUpdateSchema,
  reconcileAttemptSchema,
  recordEvidenceSchema,
  releaseDecisionSchema,
  reserveAttemptBodySchema,
  resultsImportSchema,
  taskCreateSchema,
  taskUpdateSchema,
} from '../validators'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const TASK_ID = '22222222-2222-4222-8222-222222222222'
const ATTEMPT_ID = '33333333-3333-4333-8333-333333333333'
const BASELINE_ID = '44444444-4444-4444-8444-444444444444'
const EVIDENCE_ID = '55555555-5555-4555-8555-555555555555'
const ATTACHMENT_ID = '66666666-6666-4666-8666-666666666666'
const SHA256 = 'a'.repeat(64)
const GIT_REVISION = { kind: 'git', commitSha: 'b'.repeat(40) } as const
const SCOPE_KEYS = { tenantId: PROJECT_ID, organizationId: TASK_ID }

function codeOf(schema: z.ZodType, input: unknown): { status: number; code: string; paths: string[] } {
  const parsed = schema.safeParse(input)
  if (parsed.success) throw new Error('[internal] expected the input to be rejected')
  const error = deliveryErrorFromZod(parsed.error)
  return {
    status: error.status,
    code: error.body.code,
    paths: error.body.details.map((detail) => detail.path ?? ''),
  }
}

function expectNoScopeKeys(value: unknown): void {
  expect(value).not.toHaveProperty('tenantId')
  expect(value).not.toHaveProperty('organizationId')
}

describe('project schemas', () => {
  const validCreate = {
    name: 'Service catalogue',
    inputMode: 'from_brief',
    brief: 'A small catalogue with a filter and a request form',
    targetProfileId: 'react-vite',
    repositoryRef: 'delivery-demo-react',
    limits: { maxParallelTasks: 2 },
  }

  it('accepts a create body and never carries scope ids', () => {
    const parsed = projectCreateSchema.parse({ ...validCreate, ...SCOPE_KEYS })
    expect(parsed.name).toBe('Service catalogue')
    expectNoScopeKeys(parsed)
  })

  it('rejects an unknown input mode', () => {
    expect(codeOf(projectCreateSchema, { ...validCreate, inputMode: 'from_figma' })).toMatchObject({
      status: 400,
      code: 'validation_failed',
      paths: ['inputMode'],
    })
  })

  it('rejects a blank name', () => {
    expect(codeOf(projectCreateSchema, { ...validCreate, name: '   ' }).paths).toEqual(['name'])
  })

  it('rejects a repository reference that carries credentials', () => {
    expect(projectCreateSchema.safeParse({ ...validCreate, repositoryRef: 'https://github.com/acme/demo' }).success).toBe(true)
    expect(codeOf(projectCreateSchema, { ...validCreate, repositoryRef: 'https://user:token@github.com/acme/demo' }).paths).toEqual([
      'repositoryRef',
    ])
  })

  it.each(['https:/user:token@github.com/x', 'https:\\\\user:token@github.com/x', 'https:user:token@github.com/x'])(
    'rejects the credential bypass %s',
    (repositoryRef) => {
      expect(codeOf(projectCreateSchema, { ...validCreate, repositoryRef }).paths).toEqual(['repositoryRef'])
      expect(codeOf(projectUpdateSchema, { id: PROJECT_ID, repositoryRef }).paths).toEqual(['repositoryRef'])
    },
  )

  it('accepts a positive integer profile version only', () => {
    expect(projectCreateSchema.parse({ ...validCreate, targetProfileVersion: 1 }).targetProfileVersion).toBe(1)
    expect(codeOf(projectCreateSchema, { ...validCreate, targetProfileVersion: 0 }).paths).toEqual(['targetProfileVersion'])
    expect(codeOf(projectCreateSchema, { ...validCreate, targetProfileVersion: 1.5 }).paths).toEqual(['targetProfileVersion'])
  })

  it('rejects limits outside the contract range', () => {
    expect(codeOf(projectCreateSchema, { ...validCreate, limits: { maxParallelTasks: 0 } }).paths).toEqual([
      'limits.maxParallelTasks',
    ])
  })

  it('accepts an update with a draft and strips scope ids and immutable fields', () => {
    const parsed = projectUpdateSchema.parse({
      id: PROJECT_ID,
      name: 'Renamed',
      draftSpec: {},
      inputMode: 'from_design',
      targetProfileId: 'wordpress-theme',
      ...SCOPE_KEYS,
    })
    expect(parsed.draftSpec?.requirements).toEqual([])
    expect(parsed).not.toHaveProperty('inputMode')
    expect(parsed).not.toHaveProperty('targetProfileId')
    expectNoScopeKeys(parsed)
  })

  it('rejects an update without a valid id', () => {
    expect(codeOf(projectUpdateSchema, { id: 'not-a-uuid', name: 'Renamed' }).paths).toEqual(['id'])
  })

  it('caps the list page size at 100 and parses includeArchived', () => {
    expect(projectListQuerySchema.parse({})).toEqual({ page: 1, pageSize: 50, includeArchived: false })
    expect(projectListQuerySchema.parse({ page: '2', pageSize: '100', includeArchived: 'true' })).toMatchObject({
      page: 2,
      pageSize: 100,
      includeArchived: true,
    })
    expect(codeOf(projectListQuerySchema, { pageSize: '101' }).paths).toEqual(['pageSize'])
  })
})

describe('draftSpecV1Schema', () => {
  const validDraft = {
    requirements: [{ id: 'REQ-1', title: 'List services' }],
    acceptanceCriteria: [{ id: 'AC-1', requirementId: 'REQ-1', description: 'The list shows every service' }],
    comments: [
      { id: 'C-1', screenAttachmentId: ATTACHMENT_ID, anchor: { x: 0.25, y: 0.5 }, body: 'Align the filter', status: 'open' },
      { id: 'C-2', screenAttachmentId: null, anchor: null, body: 'General remark', status: 'resolved', resolution: 'Done' },
    ],
  }

  it('accepts an empty draft and a filled draft', () => {
    expect(draftSpecV1Schema.parse({}).acceptanceCriteria).toEqual([])
    expect(draftSpecV1Schema.parse(validDraft).comments).toHaveLength(2)
  })

  it('documents that a draft is a full replacement: omitted sections parse as empty', () => {
    expect(draftSpecV1Schema.parse({ comments: validDraft.comments }).requirements).toEqual([])
  })

  it('caps the number of token entries', () => {
    const tokens = Object.fromEntries(Array.from({ length: 501 }, (_unused, index) => [`token-${index}`, index]))
    expect(draftSpecV1Schema.safeParse({ tokens: { 'color.primary': '#112233' } }).success).toBe(true)
    expect(codeOf(draftSpecV1Schema, { tokens }).paths).toEqual(['tokens'])
  })

  it('reports a duplicate acceptance criterion id', () => {
    const draft = { ...validDraft, acceptanceCriteria: [...validDraft.acceptanceCriteria, ...validDraft.acceptanceCriteria] }
    expect(codeOf(draftSpecV1Schema, draft)).toMatchObject({ status: 422, code: 'duplicate_stable_id' })
  })

  it('reports a comment anchor outside 0–1', () => {
    const draft = { ...validDraft, comments: [{ ...validDraft.comments[0], anchor: { x: 1.5, y: 0.5 } }] }
    expect(codeOf(draftSpecV1Schema, draft)).toMatchObject({ status: 422, code: 'invalid_comment_anchor' })
  })
})

describe('task schemas', () => {
  const validManual = {
    source: 'manual',
    baselineId: BASELINE_ID,
    title: 'Service list with filter',
    acIds: ['AC-1'],
    dependsOnTaskIds: [],
    allowedPaths: ['src/**', 'tests/**'],
  }

  it('accepts a manual task and a plan proposal', () => {
    const parsed = taskCreateSchema.parse({ ...validManual, ...SCOPE_KEYS })
    expectNoScopeKeys(parsed)
    expect(taskCreateSchema.safeParse({ source: 'plan_proposal', manifest: { schemaVersion: 'anything' } }).success).toBe(true)
  })

  it('rejects an unknown source and a proposal without a manifest object', () => {
    expect(codeOf(taskCreateSchema, { ...validManual, source: 'agent' }).code).toBe('validation_failed')
    expect(codeOf(taskCreateSchema, { source: 'plan_proposal', manifest: 'text' }).paths).toEqual(['manifest'])
  })

  it('rejects a manual task without acceptance criteria', () => {
    expect(codeOf(taskCreateSchema, { ...validManual, acIds: [] }).paths).toEqual(['acIds'])
  })

  it.each(['../secrets', '/etc/passwd', 'src/../../x'])('rejects the allowed path %s', (path) => {
    expect(codeOf(taskCreateSchema, { ...validManual, allowedPaths: [path] })).toMatchObject({
      status: 422,
      code: 'path_not_allowed',
    })
  })

  it('accepts an update with any lifecycle status and never accepts statusReason', () => {
    const parsed = taskUpdateSchema.parse({ id: TASK_ID, status: 'verified', statusReason: 'reconciliation_required', ...SCOPE_KEYS })
    expect(parsed.status).toBe('verified')
    expect(parsed).not.toHaveProperty('statusReason')
    expectNoScopeKeys(parsed)
    expect(USER_SETTABLE_TASK_STATUSES).toEqual(['draft', 'ready', 'blocked', 'cancelled'])
  })

  it('rejects an unknown status', () => {
    expect(codeOf(taskUpdateSchema, { id: TASK_ID, status: 'done' }).paths).toEqual(['status'])
  })

  it('reports a self dependency as a cycle', () => {
    expect(taskUpdateSchema.safeParse({ id: TASK_ID, dependsOnTaskIds: [BASELINE_ID] }).success).toBe(true)
    expect(codeOf(taskUpdateSchema, { id: TASK_ID, dependsOnTaskIds: [TASK_ID] })).toMatchObject({ status: 422, code: 'cycle' })
  })
})

describe('baseline schemas', () => {
  it('accepts both sources', () => {
    const manual = baselineCreateSchema.parse({ source: 'manual', ...SCOPE_KEYS })
    expectNoScopeKeys(manual)
    expect(baselineCreateSchema.safeParse({ source: 'requirements_proposal', manifest: {} }).success).toBe(true)
  })

  it('rejects plan_proposal here and a proposal without a manifest', () => {
    expect(codeOf(baselineCreateSchema, { source: 'plan_proposal', manifest: {} }).code).toBe('validation_failed')
    expect(codeOf(baselineCreateSchema, { source: 'requirements_proposal' }).paths).toEqual(['manifest'])
  })

  const validDecision = { kind: 'design', verdict: 'approved', subjectHash: SHA256, subjectVersion: 1 }

  it('accepts an approval and a rejection with a reason', () => {
    expect(baselineDecisionSchema.safeParse(validDecision).success).toBe(true)
    const rejected = baselineDecisionSchema.parse({ ...validDecision, verdict: 'rejected', reason: 'Wrong breakpoint', ...SCOPE_KEYS })
    expectNoScopeKeys(rejected)
  })

  it.each([undefined, null, '   '])('requires a reason to reject (reason: %p)', (reason) => {
    expect(codeOf(baselineDecisionSchema, { ...validDecision, verdict: 'rejected', reason })).toMatchObject({
      status: 422,
      code: 'reason_required',
      paths: ['reason'],
    })
  })

  it('rejects deploy as a baseline decision kind and a malformed hash', () => {
    expect(codeOf(baselineDecisionSchema, { ...validDecision, kind: 'deploy' }).paths).toEqual(['kind'])
    expect(codeOf(baselineDecisionSchema, { ...validDecision, subjectHash: 'abc' }).paths).toEqual(['subjectHash'])
  })
})

describe('attempt schemas', () => {
  it('accepts only manual_handoff on the public reserve body', () => {
    const parsed = reserveAttemptBodySchema.parse({ mode: 'manual_handoff', baseRevision: GIT_REVISION, ...SCOPE_KEYS })
    expectNoScopeKeys(parsed)
    expect(codeOf(reserveAttemptBodySchema, { mode: 'automatic', baseRevision: GIT_REVISION })).toMatchObject({
      status: 400,
      code: 'validation_failed',
      paths: ['mode'],
    })
  })

  it('does not let a client smuggle trustedExecution through the reserve body', () => {
    const parsed = reserveAttemptBodySchema.parse({
      mode: 'manual_handoff',
      baseRevision: GIT_REVISION,
      trustedExecution: { source: 'delivery_agents', actorUserId: PROJECT_ID },
    })
    expect(parsed).not.toHaveProperty('trustedExecution')
  })

  it('validates the idempotency key header', () => {
    expect(idempotencyKeyHeaderSchema.safeParse('reserve-2026-09-19-001').success).toBe(true)
    expect(idempotencyKeyHeaderSchema.safeParse('').success).toBe(false)
    expect(idempotencyKeyHeaderSchema.safeParse('has space').success).toBe(false)
  })

  it('validates the package query', () => {
    expect(packageQuerySchema.safeParse({ attemptId: ATTEMPT_ID }).success).toBe(true)
    expect(codeOf(packageQuerySchema, {}).paths).toEqual(['attemptId'])
  })

  it('validates the results body without parsing the manifest version', () => {
    const parsed = resultsImportSchema.parse({ attemptId: ATTEMPT_ID, manifest: { schemaVersion: 'delivery.result-manifest/v9' }, ...SCOPE_KEYS })
    expectNoScopeKeys(parsed)
    expect(codeOf(resultsImportSchema, { manifest: {} }).paths).toEqual(['attemptId'])
    expect(codeOf(resultsImportSchema, { attemptId: ATTEMPT_ID, manifest: [] }).paths).toEqual(['manifest'])
  })

  it('reports an oversized manifest as payload_too_large', () => {
    const manifest = { blob: 'x'.repeat(2_000_001) }
    expect(codeOf(resultsImportSchema, { attemptId: ATTEMPT_ID, manifest })).toMatchObject({ status: 413, code: 'payload_too_large' })
  })

  it('accepts a cancel body with or without a reason', () => {
    expect(cancelAttemptSchema.parse({ ...SCOPE_KEYS })).toEqual({})
    expect(cancelAttemptSchema.safeParse({ reason: 'Wrong baseline' }).success).toBe(true)
    expect(codeOf(cancelAttemptSchema, { reason: 'x'.repeat(2001) }).paths).toEqual(['reason'])
  })

  const externalEvidence = { note: 'Process not found on the station', observedAt: '2026-09-19T10:00:00Z' }

  it('accepts reconcile resolutions and requires a manifest for completed', () => {
    expect(reconcileAttemptSchema.safeParse({ resolution: 'not_started', externalEvidence }).success).toBe(true)
    expect(reconcileAttemptSchema.safeParse({ resolution: 'completed', externalEvidence, manifest: {} }).success).toBe(true)
    expect(codeOf(reconcileAttemptSchema, { resolution: 'completed', externalEvidence })).toMatchObject({
      status: 422,
      code: 'manifest_required',
      paths: ['manifest'],
    })
  })

  it('rejects reconcile without an observation note or with an unknown resolution', () => {
    expect(codeOf(reconcileAttemptSchema, { resolution: 'stopped', externalEvidence: { ...externalEvidence, note: ' ' } }).paths).toEqual([
      'externalEvidence.note',
    ])
    expect(codeOf(reconcileAttemptSchema, { resolution: 'retry', externalEvidence }).paths).toEqual(['resolution'])
  })
})

describe('evidence schemas', () => {
  const check = {
    checkId: 'unit-tests',
    testId: 'ServiceList > filters by category',
    acIds: ['AC-1'],
    commandProfileId: 'vitest-report',
    validationProfileVersion: 1,
    testDefinitionHash: SHA256,
    status: 'passed',
    exitCode: 0,
    durationMs: 1200,
    sourceRevision: GIT_REVISION,
    rawReportHash: SHA256,
  }
  const base = { baselineId: BASELINE_ID, taskId: TASK_ID, sourceRevision: GIT_REVISION }
  const bodies = {
    test: { kind: 'test', ...base, payload: { rawReportHash: SHA256, checks: [check] } },
    review: {
      kind: 'review',
      ...base,
      payload: { verdict: 'changes_requested', summary: 'Filter ignores case', reviewer: { kind: 'agent', ref: 'reviewer' } },
    },
    screenshot: {
      kind: 'screenshot',
      baselineId: BASELINE_ID,
      payload: {
        attachmentId: ATTACHMENT_ID,
        sha256: SHA256,
        name: 'List — desktop',
        viewport: { width: 1440, height: 900 },
        capturedAt: '2026-09-19T10:00:00Z',
      },
    },
    deployment: {
      kind: 'deployment',
      baselineId: BASELINE_ID,
      sourceRevision: GIT_REVISION,
      payload: {
        url: 'https://preview.example.com/build-42',
        environment: 'preview',
        buildId: 'build-42',
        deployedAt: '2026-09-19T10:00:00Z',
        uploadStatus: 'succeeded',
      },
    },
    scan: {
      kind: 'scan',
      baselineId: BASELINE_ID,
      sourceRevision: GIT_REVISION,
      payload: { checkId: 'dependency-audit', scanner: 'npm audit', status: 'passed', rawReportHash: SHA256 },
    },
    reference_material: {
      kind: 'reference_material',
      baselineId: BASELINE_ID,
      payload: { title: 'Historical WordPress report', origin: 'ai-wordpress-orchestrator' },
    },
  }

  it.each(Object.entries(bodies))('accepts %s evidence and strips scope ids', (_kind, body) => {
    const result = parseRecordEvidenceBody({ ...body, ...SCOPE_KEYS })
    expect(result.ok).toBe(true)
    if (result.ok) expectNoScopeKeys(result.data)
  })

  it('stores a deployment without verification as unverified input', () => {
    const parsed = recordEvidenceSchema.parse(bodies.deployment)
    expect(parsed.kind === 'deployment' && parsed.payload.verification).toBeNull()
  })

  it.each(['result_manifest', 'video'])('maps the kind %s to unsupported_evidence_kind', (kind) => {
    const result = parseRecordEvidenceBody({ ...bodies.test, kind })
    expect(result).toMatchObject({ ok: false, status: 422, body: { code: 'unsupported_evidence_kind' } })
  })

  it('reports a missing kind as a validation failure', () => {
    const { kind: _kind, ...withoutKind } = bodies.test
    expect(parseRecordEvidenceBody(withoutKind)).toMatchObject({ ok: false, status: 400, body: { code: 'validation_failed' } })
  })

  it.each(['url', 'environment', 'buildId'])('reports a deployment without %s as incomplete', (field) => {
    const { [field]: _removed, ...payload } = bodies.deployment.payload as Record<string, unknown>
    expect(parseRecordEvidenceBody({ ...bodies.deployment, payload })).toMatchObject({
      ok: false,
      status: 422,
      body: { code: 'deployment_incomplete', details: [{ path: `payload.${field}` }] },
    })
  })

  it('reports a deployment without a revision or with a credentialed url as incomplete', () => {
    const { sourceRevision: _revision, ...withoutRevision } = bodies.deployment
    expect(parseRecordEvidenceBody(withoutRevision)).toMatchObject({ ok: false, body: { code: 'deployment_incomplete' } })
    const credentialed = { ...bodies.deployment, payload: { ...bodies.deployment.payload, url: 'https://user:pw@preview.example.com' } }
    expect(parseRecordEvidenceBody(credentialed)).toMatchObject({ ok: false, body: { code: 'deployment_incomplete' } })
  })

  it('rejects test evidence without checks, a revision, or with a skipped status', () => {
    expect(codeOf(recordEvidenceSchema, { ...bodies.test, payload: { rawReportHash: SHA256, checks: [] } }).paths).toEqual(['payload.checks'])
    const { sourceRevision: _revision, ...withoutRevision } = bodies.test
    expect(codeOf(recordEvidenceSchema, withoutRevision).paths).toEqual(['sourceRevision'])
    const skipped = { ...bodies.test, payload: { rawReportHash: SHA256, checks: [{ ...check, status: 'skipped' }] } }
    expect(codeOf(recordEvidenceSchema, skipped).paths).toEqual(['payload.checks.0.status'])
  })

  it.each(['review', 'scan'] as const)('requires a revision for %s evidence', (kind) => {
    const { sourceRevision: _revision, ...withoutRevision } = bodies[kind]
    expect(codeOf(recordEvidenceSchema, withoutRevision)).toMatchObject({
      status: 400,
      code: 'validation_failed',
      paths: ['sourceRevision'],
    })
  })

  it.each(['ftp://preview.example.com/build-42', 'preview.example.com'])('reports the deployment url %s as incomplete', (url) => {
    const body = { ...bodies.deployment, payload: { ...bodies.deployment.payload, url } }
    expect(parseRecordEvidenceBody(body)).toMatchObject({ ok: false, status: 422, body: { code: 'deployment_incomplete' } })
  })

  it('lets a shape-level rule win over deployment_incomplete', () => {
    const { url: _url, ...payload } = bodies.deployment.payload
    expect(parseRecordEvidenceBody({ ...bodies.deployment, attemptId: ATTEMPT_ID, payload })).toMatchObject({
      ok: false,
      status: 400,
      body: { code: 'validation_failed' },
    })
  })

  it('rejects a review without a task or with an unknown verdict', () => {
    const { taskId: _taskId, ...withoutTask } = bodies.review
    expect(codeOf(recordEvidenceSchema, withoutTask).paths).toEqual(['taskId'])
    const passed = { ...bodies.review, payload: { ...bodies.review.payload, verdict: 'passed' } }
    expect(codeOf(recordEvidenceSchema, passed).paths).toEqual(['payload.verdict'])
  })

  it('rejects an attempt reference without a task', () => {
    expect(codeOf(recordEvidenceSchema, { ...bodies.screenshot, attemptId: ATTEMPT_ID }).paths).toEqual(['taskId'])
  })

  it('rejects a screenshot with a malformed hash', () => {
    const body = { ...bodies.screenshot, payload: { ...bodies.screenshot.payload, sha256: 'zz' } }
    expect(codeOf(recordEvidenceSchema, body).paths).toEqual(['payload.sha256'])
  })
})

describe('deploy and release decisions', () => {
  const deploy = { baselineId: BASELINE_ID, sourceRevision: GIT_REVISION, verdict: 'approved' }
  const release = { deploymentEvidenceId: EVIDENCE_ID, verdict: 'approved' }

  it('accepts approvals and strips scope ids', () => {
    expectNoScopeKeys(deployDecisionSchema.parse({ ...deploy, ...SCOPE_KEYS }))
    expectNoScopeKeys(releaseDecisionSchema.parse({ ...release, ...SCOPE_KEYS }))
  })

  it('requires a reason to reject', () => {
    expect(deployDecisionSchema.safeParse({ ...deploy, verdict: 'rejected', reason: 'Audit is red' }).success).toBe(true)
    expect(releaseDecisionSchema.safeParse({ ...release, verdict: 'rejected', reason: 'Form is broken' }).success).toBe(true)
    expect(codeOf(deployDecisionSchema, { ...deploy, verdict: 'rejected' })).toMatchObject({ status: 422, code: 'reason_required' })
    expect(codeOf(releaseDecisionSchema, { ...release, verdict: 'rejected' })).toMatchObject({ status: 422, code: 'reason_required' })
  })

  it('rejects a deploy decision without a revision and a release decision without evidence', () => {
    const { sourceRevision: _revision, ...withoutRevision } = deploy
    expect(codeOf(deployDecisionSchema, withoutRevision).paths).toEqual(['sourceRevision'])
    expect(codeOf(releaseDecisionSchema, { verdict: 'approved' }).paths).toEqual(['deploymentEvidenceId'])
  })

  it('rejects a revision with a malformed commit', () => {
    expect(codeOf(deployDecisionSchema, { ...deploy, sourceRevision: { kind: 'git', commitSha: 'HEAD' } }).paths).toEqual([
      'sourceRevision.commitSha',
    ])
  })
})
