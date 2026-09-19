import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DELIVERY_SCHEMA_VERSIONS,
  designManifestV1Schema,
} from '@open-mercato/core/modules/delivery_os/lib/contracts'
import {
  MAX_MANIFEST_BODY_CHARS,
  manifestTargetsProject,
  parsePlanProposal,
  parseRequirementsProposal,
  summarizePlanProposal,
  summarizeRequirementsProposal,
} from '../proposalImport'

const projectId = '11111111-1111-4111-8111-111111111111'

function requirementsManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: DELIVERY_SCHEMA_VERSIONS.requirementsProposal,
    projectId,
    manifestId: 'req-demo-1',
    requirements: [{ id: 'REQ-1', title: 'Operator imports a proposal' }],
    acceptanceCriteria: [{ id: 'AC-1', requirementId: 'REQ-1', description: 'Baseline v1 appears.' }],
    questions: [],
    risks: [],
    producedBy: { tool: 'claude-code', sessionRef: null },
    ...overrides,
  }
}

function issuePaths(raw: string): string[] {
  const result = parseRequirementsProposal(raw)
  if (result.ok || result.reason !== 'schema') throw new Error(`[internal] expected a schema failure, got ${JSON.stringify(result)}`)
  return result.issues.map((issue) => issue.path)
}

describe('parseRequirementsProposal', () => {
  it('accepts a well-formed manifest and summarizes what the operator is about to import', () => {
    const result = parseRequirementsProposal(JSON.stringify(requirementsManifest()))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(summarizeRequirementsProposal(result.manifest)).toEqual({
      manifestId: 'req-demo-1',
      projectId,
      requirementCount: 1,
      acceptanceCriteriaCount: 1,
      questionCount: 0,
      riskCount: 0,
      producedByTool: 'claude-code',
    })
  })

  it('names the schemaVersion field when the version is not the one the platform knows', () => {
    expect(issuePaths(JSON.stringify(requirementsManifest({ schemaVersion: 'delivery.requirements-proposal/v2' }))))
      .toContain('schemaVersion')
  })

  it('reports the acceptance criterion that points at a requirement the manifest does not carry', () => {
    const raw = JSON.stringify(requirementsManifest({
      acceptanceCriteria: [{ id: 'AC-1', requirementId: 'REQ-9', description: 'Dangling.' }],
    }))
    expect(issuePaths(raw)).toContain('acceptanceCriteria.0.requirementId')
  })

  it('separates a truncated paste from a manifest that is merely wrong', () => {
    const truncated = parseRequirementsProposal('{ "schemaVersion": "delivery.requirem')
    expect(truncated).toEqual({ ok: false, reason: 'not_json' })
    const array = parseRequirementsProposal('[]')
    expect(array).toEqual({ ok: false, reason: 'not_object' })
  })

  it('refuses a body over the manifest character limit before parsing it', () => {
    const oversized = `"${'x'.repeat(MAX_MANIFEST_BODY_CHARS + 1)}"`
    const result = parseRequirementsProposal(oversized)
    expect(result).toEqual({ ok: false, reason: 'too_large', length: oversized.length, limit: MAX_MANIFEST_BODY_CHARS })
  })

  it('treats whitespace-only input as nothing pasted rather than as invalid JSON', () => {
    expect(parseRequirementsProposal('   \n  ')).toEqual({ ok: false, reason: 'empty' })
  })
})

describe('manifestTargetsProject', () => {
  it('rejects a manifest produced for another project', () => {
    expect(manifestTargetsProject(projectId, projectId)).toBe(true)
    expect(manifestTargetsProject('22222222-2222-4222-8222-222222222222', projectId)).toBe(false)
  })
})

describe('demo design-manifest fixture', () => {
  it('satisfies designManifestV1Schema, so the demo example cannot drift from the contract', () => {
    const raw = readFileSync(
      join(__dirname, '../../../../../../../../hackathon/delivery-demo/fixtures/design-manifest.v1.json'),
      'utf8',
    )
    const parsed = designManifestV1Schema.safeParse(JSON.parse(raw))
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.screens[0].fileKey).toBe('5wOkFtN959W4MFmgRuaU8S')
  })
})

const baselineId = '22222222-2222-4222-8222-222222222222'
const baselineHash = 'b'.repeat(64)

function planManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: DELIVERY_SCHEMA_VERSIONS.planProposal,
    projectId,
    baselineId,
    baselineHash,
    manifestId: 'plan-demo-1',
    architectureSummary: 'One page, one store, no server state.',
    tasks: [
      {
        proposalTaskKey: 'T-1',
        title: 'Render the catalogue',
        description: 'List services with a filter.',
        acIds: ['AC-1'],
        dependsOn: [],
        allowedPaths: ['src/features/catalogue'],
      },
    ],
    acTestMap: { 'AC-1': ['tests/catalogue.spec.ts'] },
    declaredTests: [{ testId: 'tests/catalogue.spec.ts', file: 'tests/catalogue.spec.ts' }],
    producedBy: { tool: 'claude-code', sessionRef: null },
    ...overrides,
  }
}

function planIssues(raw: string): { path: string; code: string }[] {
  const result = parsePlanProposal(raw)
  if (result.ok || result.reason !== 'schema') throw new Error(`[internal] expected a schema failure, got ${JSON.stringify(result)}`)
  return result.issues.map((issue) => ({ path: issue.path, code: issue.code }))
}

describe('parsePlanProposal', () => {
  it('accepts a well-formed plan and summarizes the baseline it claims to target', () => {
    const result = parsePlanProposal(JSON.stringify(planManifest()))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(summarizePlanProposal(result.manifest)).toMatchObject({
      manifestId: 'plan-demo-1',
      baselineId,
      baselineHash,
      taskCount: 1,
      declaredTestCount: 1,
      producedByTool: 'claude-code',
    })
  })

  it('names the task whose dependency forms a cycle', () => {
    const raw = JSON.stringify(planManifest({
      tasks: [
        { proposalTaskKey: 'T-1', title: 'A', description: 'a', acIds: ['AC-1'], dependsOn: ['T-1'], allowedPaths: ['src/a'] },
      ],
    }))
    expect(planIssues(raw)).toContainEqual({ path: 'tasks.0.dependsOn.0', code: 'cycle' })
  })

  it('names a dependency on a task key the manifest does not define', () => {
    const raw = JSON.stringify(planManifest({
      tasks: [
        { proposalTaskKey: 'T-1', title: 'A', description: 'a', acIds: ['AC-1'], dependsOn: ['T-9'], allowedPaths: ['src/a'] },
      ],
    }))
    expect(planIssues(raw)).toContainEqual({ path: 'tasks.0.dependsOn.0', code: 'foreign_dependency' })
  })

  it('names a duplicated task key', () => {
    const task = { title: 'A', description: 'a', acIds: ['AC-1'], dependsOn: [], allowedPaths: ['src/a'] }
    const raw = JSON.stringify(planManifest({
      tasks: [{ proposalTaskKey: 'T-1', ...task }, { proposalTaskKey: 'T-1', ...task }],
    }))
    expect(planIssues(raw).map((issue) => issue.code)).toContain('duplicate_stable_id')
  })

  it('refuses a task path that escapes the repository root', () => {
    const raw = JSON.stringify(planManifest({
      tasks: [
        { proposalTaskKey: 'T-1', title: 'A', description: 'a', acIds: ['AC-1'], dependsOn: [], allowedPaths: ['../outside'] },
      ],
    }))
    expect(planIssues(raw).map((issue) => issue.path)).toContain('tasks.0.allowedPaths.0')
  })

  it('refuses a task carrying no acceptance criterion at all', () => {
    const raw = JSON.stringify(planManifest({
      tasks: [
        { proposalTaskKey: 'T-1', title: 'A', description: 'a', acIds: [], dependsOn: [], allowedPaths: ['src/a'] },
      ],
    }))
    expect(planIssues(raw).map((issue) => issue.path)).toContain('tasks.0.acIds')
  })

  it('names the schemaVersion field when the plan declares an unknown version', () => {
    expect(planIssues(JSON.stringify(planManifest({ schemaVersion: 'delivery.plan-proposal/v2' }))).map((issue) => issue.path))
      .toContain('schemaVersion')
  })

  it('separates a truncated paste from a plan that is merely wrong', () => {
    expect(parsePlanProposal('{ "schemaVersion":')).toEqual({ ok: false, reason: 'not_json' })
  })
})
