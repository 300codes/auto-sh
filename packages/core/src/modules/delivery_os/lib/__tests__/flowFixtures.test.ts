import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  DELIVERY_FLOW_SCHEMA_VERSIONS,
  deliveryFlowDocumentSchemas,
  deliveryFlowErrorFromZod,
  parseFlowVersioned,
} from '../contracts'
import { DEFAULT_FLOW_TEMPLATE } from '../flowTemplates'
import {
  flowSchemaByDocumentType,
  loadCommentImportFixture,
  loadFlowTemplateFixture,
  loadIntakeFixture,
  loadNegativeFlowFixtures,
  loadStageArtifactFixture,
  positiveFlowFixtures,
  type NegativeFlowFixture,
} from '../fixtures/flow'

const flowFixturesDir = join(__dirname, '..', 'fixtures', 'flow')

function runSchemaStage(fixture: NegativeFlowFixture): { status: number; code: string } | null {
  if (fixture.documentType === 'versioned') {
    const result = parseFlowVersioned(deliveryFlowDocumentSchemas, fixture.document)
    return result.ok ? null : { status: result.status, code: result.body.code }
  }
  const parsed = flowSchemaByDocumentType[fixture.documentType].safeParse(fixture.document)
  if (parsed.success) return null
  const error = deliveryFlowErrorFromZod(parsed.error)
  return { status: error.status, code: error.body.code }
}

describe('positive flow fixtures', () => {
  it.each(positiveFlowFixtures.map((fixture) => [fixture.name, fixture] as const))('%s matches its schema', (_name, fixture) => {
    expect(fixture.schema.safeParse(fixture.document).success).toBe(true)
  })

  it('versioned fixtures also pass parseFlowVersioned dispatch', () => {
    for (const fixture of positiveFlowFixtures.filter((entry) => entry.versioned)) {
      const result = parseFlowVersioned(deliveryFlowDocumentSchemas, fixture.document)
      expect(result.ok).toBe(true)
    }
  })

  it('covers every published flow schema version', () => {
    const covered = new Set(
      positiveFlowFixtures
        .filter((fixture) => fixture.versioned)
        .map((fixture) => (fixture.document as { schemaVersion: string }).schemaVersion),
    )
    expect([...covered].sort()).toEqual(Object.values(DELIVERY_FLOW_SCHEMA_VERSIONS).sort())
  })

  it('is one coherent scenario: the ux artifact binds the scope artifact hash the intake proposal carries', () => {
    const intake = loadIntakeFixture()
    const ux = loadStageArtifactFixture('ux')
    expect(ux.dependsOn[0]?.stageId).toBe('scope')
    expect(ux.dependsOn[0]?.contentHash).toBe(intake.proposals[0]?.contentHash)
    expect(loadCommentImportFixture().artifactId).not.toBeNull()
  })

  it('the template fixture is the built-in default template', () => {
    expect(loadFlowTemplateFixture()).toEqual(DEFAULT_FLOW_TEMPLATE)
  })

  it('loaders return fresh copies', () => {
    const first = loadIntakeFixture()
    first.brief.features.push('mutated')
    expect(loadIntakeFixture().brief.features).not.toContain('mutated')
  })
})

describe('negative flow fixtures', () => {
  const fixtures = loadNegativeFlowFixtures()

  it('catalogue lists every file in fixtures/flow/negative exactly once', () => {
    const files = readdirSync(join(flowFixturesDir, 'negative')).filter((file) => file.endsWith('.v1.json')).sort()
    expect(fixtures.map((fixture) => `${fixture.name}.v1.json`).sort()).toEqual(files)
  })

  it.each(fixtures.map((fixture) => [fixture.name, fixture] as const))('%s is rejected with the labelled code', (_name, fixture) => {
    const outcome = runSchemaStage(fixture)
    expect(outcome).not.toBeNull()
    expect(outcome).toEqual({ status: fixture.expected.status, code: fixture.expected.code })
  })

  it('covers the required failure classes', () => {
    const codes = new Set(fixtures.map((fixture) => fixture.expected.code))
    for (const code of ['unsupported_schema_version', 'foreign_dependency', 'duplicate_stable_id', 'cycle', 'reason_required', 'deployment_unverified', 'manifest_required', 'validation_failed']) {
      expect(codes.has(code as never)).toBe(true)
    }
  })
})
