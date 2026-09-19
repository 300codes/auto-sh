import {
  loadNegativeDeliveryFixtures,
  loadResultManifestFixture,
  type NegativeDeliveryFixtureName,
} from '@open-mercato/core/modules/delivery_os/lib/fixtures'
import {
  MAX_RESULT_MANIFEST_CHARS,
  countChecksByStatus,
  manifestTargetsAttempt,
  parseResultManifest,
  summarizeResultManifest,
  usageIsUnknown,
} from '../resultImport'

const manifest = loadResultManifestFixture()

function negativeDocument(name: NegativeDeliveryFixtureName): unknown {
  const fixture = loadNegativeDeliveryFixtures().find((entry) => entry.name === name)
  if (!fixture) throw new Error(`[internal] missing negative fixture ${name}`)
  return fixture.document
}

function codesOf(raw: string): string[] {
  const parsed = parseResultManifest(raw)
  if (parsed.ok || parsed.reason !== 'schema') throw new Error('[internal] expected a schema failure')
  return parsed.issues.map((issue) => issue.code)
}

describe('parseResultManifest — five disjoint inputs', () => {
  it('reports an empty paste as empty, not as malformed JSON', () => {
    expect(parseResultManifest('   ')).toEqual({ ok: false, reason: 'empty' })
  })

  it('reports a paste above the body limit before trying to parse it', () => {
    const oversized = `"${'x'.repeat(MAX_RESULT_MANIFEST_CHARS)}"`
    expect(parseResultManifest(oversized)).toMatchObject({ ok: false, reason: 'too_large', limit: MAX_RESULT_MANIFEST_CHARS })
  })

  it('separates a truncated paste from a wrong field', () => {
    expect(parseResultManifest('{"schemaVersion":')).toEqual({ ok: false, reason: 'not_json' })
  })

  it('refuses an array or a bare value as not an object', () => {
    expect(parseResultManifest('[]')).toEqual({ ok: false, reason: 'not_object' })
    expect(parseResultManifest('"manifest"')).toEqual({ ok: false, reason: 'not_object' })
  })

  it('reports a contract failure per field', () => {
    const parsed = parseResultManifest(JSON.stringify({ ...manifest, taskId: 'not-a-uuid' }))
    expect(parsed.ok).toBe(false)
    if (parsed.ok || parsed.reason !== 'schema') throw new Error('[internal] expected a schema failure')
    expect(parsed.issues.some((issue) => issue.path === 'taskId')).toBe(true)
  })

  it('accepts the published fixture unchanged', () => {
    expect(parseResultManifest(JSON.stringify(manifest))).toEqual({ ok: true, manifest })
  })
})

describe('parseResultManifest — delivery codes stay distinct', () => {
  it('names a path that escapes the repository as path_not_allowed, never as a bare custom issue', () => {
    const escaping = { ...manifest, changedPaths: ['../outside/secrets.env'] }
    const codes = codesOf(JSON.stringify(escaping))
    expect(codes).toContain('path_not_allowed')
    expect(codes).not.toContain('custom')
  })

  it('accepts a manifest whose paths only the server can judge, instead of claiming a refusal it cannot make', () => {
    // `result-manifest.path-escape` changes `package.json` and a workflow file:
    // repository-relative, so the CONTRACT holds. Only the task's allowedPaths
    // refuse it, and those live on the server.
    const parsed = parseResultManifest(JSON.stringify(negativeDocument('result-manifest.path-escape')))
    expect(parsed.ok).toBe(true)
  })

  it('names a duplicate check id apart from a forbidden path', () => {
    const duplicated = { ...manifest, checks: [manifest.checks[0], manifest.checks[0]] }
    expect(codesOf(JSON.stringify(duplicated))).toContain('duplicate_stable_id')
  })

  it('names a check measured on another revision apart from both', () => {
    const drifted = {
      ...manifest,
      checks: [{ ...manifest.checks[0], sourceRevision: { kind: 'git', commitSha: 'a'.repeat(40) } }],
    }
    const codes = codesOf(JSON.stringify(drifted))
    expect(codes).toContain('revision_mismatch')
    expect(codes).not.toContain('path_not_allowed')
    expect(codes).not.toContain('duplicate_stable_id')
  })

  it('refuses the runner "skipped" status the domain does not carry', () => {
    const parsed = parseResultManifest(JSON.stringify(negativeDocument('result-manifest.status-skipped')))
    expect(parsed.ok).toBe(false)
  })
})

describe('manifestTargetsAttempt', () => {
  it('accepts the manifest produced for this task and attempt', () => {
    expect(manifestTargetsAttempt(manifest, { taskId: manifest.taskId, attemptId: manifest.attemptId })).toBe(true)
  })

  it.each([
    ['result-manifest.foreign-task' as const],
    ['result-manifest.foreign-attempt' as const],
  ])('refuses %s before the request leaves the browser', (name) => {
    const parsed = parseResultManifest(JSON.stringify(negativeDocument(name)))
    if (!parsed.ok) throw new Error('[internal] the correlation fixtures must satisfy the schema')
    expect(manifestTargetsAttempt(parsed.manifest, { taskId: manifest.taskId, attemptId: manifest.attemptId })).toBe(false)
  })
})

describe('summarizeResultManifest', () => {
  it('counts the three check states apart, so a not-run check is never a passing one', () => {
    const mixed = {
      ...manifest,
      checks: [
        { ...manifest.checks[0], status: 'passed' as const },
        { ...manifest.checks[1], status: 'failed' as const },
        { ...manifest.checks[2], status: 'not_run' as const },
      ],
    }
    expect(countChecksByStatus(mixed)).toEqual({ passed: 1, failed: 1, not_run: 1 })
    expect(summarizeResultManifest(mixed).checkCount).toBe(3)
  })

  it('reads the fixture usage as unknown, which is missing data rather than zero', () => {
    expect(usageIsUnknown(manifest.usage)).toBe(true)
    expect(summarizeResultManifest(manifest).usage.source).toBe('runner')
  })

  it('reports measured usage as measured', () => {
    const measured = { ...manifest, usage: { source: 'provider' as const, values: { totalTokens: 1200, costUsd: 0.4 } } }
    expect(usageIsUnknown(measured.usage)).toBe(false)
  })
})
