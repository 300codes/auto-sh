import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { designTokenExportSchema, mapDesignTokens } from '../design-tokens.ts'

const fixture = () => designTokenExportSchema.parse(JSON.parse(readFileSync(new URL('../../../../context/changes/wordpress-design-token-mapping/fixture.json', import.meta.url), 'utf8')))

test('maps fixture palette, typography and spacing without approval or mutation', () => {
  const input = fixture()
  const original = structuredClone(input)
  const report = mapDesignTokens(input)
  assert.deepEqual(report.themeJsonFragment, {
    version: 3,
    settings: {
      color: { palette: [
        { slug: 'design-ink', name: 'Ink', color: '#172d2b' },
        { slug: 'design-paper', name: 'Paper', color: '#f5f3eb' },
      ] },
      typography: {
        fontFamilies: [{ slug: 'design-body', name: 'Body', fontFamily: '"Example Sans", system-ui, sans-serif' }],
        fontSizes: [{ slug: 'design-reading', name: 'Reading', size: '1rem' }],
      },
      spacing: { spacingSizes: [
        { slug: 'design-none', name: 'None', size: '0px' },
        { slug: 'design-section', name: 'Section', size: '2rem' },
      ] },
    },
  })
  assert.equal(report.tailwindCss, '@theme inline {\n' + [
    '  --color-design-ink: var(--wp--preset--color--design-ink, #172d2b);',
    '  --color-design-paper: var(--wp--preset--color--design-paper, #f5f3eb);',
    '  --font-design-body: var(--wp--preset--font-family--design-body, "Example Sans", system-ui, sans-serif);',
    '  --text-design-reading: var(--wp--preset--font-size--design-reading, 1rem);',
    '  --spacing-design-none: var(--wp--preset--spacing--design-none, 0px);',
    '  --spacing-design-section: var(--wp--preset--spacing--design-section, 2rem);',
  ].join('\n') + '\n}\n')
  assert.equal(report.provenance, 'fixture')
  assert.equal(report.approvalVerification, 'not_evaluated')
  assert.deepEqual(input, original)
  assert.equal('styles' in report.themeJsonFragment, false)
  assert.equal(report.artifactsHash, createHash('sha256').update(JSON.stringify({ schemaVersion: 1, themeJsonFragment: report.themeJsonFragment, tailwindCss: report.tailwindCss })).digest('hex'))
})

test('canonical output and hashes survive repeated, reordered equivalent exports', () => {
  const input = fixture()
  const report = mapDesignTokens(input)
  for (const values of Object.values(input.tokens)) values.reverse()
  assert.deepEqual(mapDesignTokens(input), report)
  assert.deepEqual(mapDesignTokens(fixture()), report)
  const reordered = { tokens: input.tokens, source: { revision: input.source.revision, designRef: input.source.designRef }, provenance: input.provenance, schemaVersion: 1 }
  assert.deepEqual(mapDesignTokens(reordered), report)
})

test('hashes bind token values and source revision without conflating provenance with approval', () => {
  const original = mapDesignTokens(fixture())
  const changed = fixture()
  changed.tokens.colors[0]!.value = '#ffffff'
  assert.notEqual(mapDesignTokens(changed).inputHash, original.inputHash)
  assert.notEqual(mapDesignTokens(changed).artifactsHash, original.artifactsHash)
  changed.tokens.colors = fixture().tokens.colors
  changed.source.revision = 'fixture-v2'
  assert.notEqual(mapDesignTokens(changed).inputHash, original.inputHash)
  assert.equal(mapDesignTokens(changed).artifactsHash, original.artifactsHash)
  changed.provenance = 'operator_supplied'
  assert.throws(() => mapDesignTokens(changed), /invalid_input/)
  changed.source.approvalRef = 'decision:declared-only'
  const declared = mapDesignTokens(changed)
  assert.equal(declared.approvalVerification, 'not_evaluated')
  assert.equal(declared.provenance, 'operator_supplied')
  changed.source.approvalRef = 'decision:other'
  assert.notEqual(mapDesignTokens(changed).inputHash, declared.inputHash)
})

test('font fallback order remains semantic and upper-case colors normalize', () => {
  const input = fixture()
  const original = mapDesignTokens(input)
  input.tokens.fonts[0]!.families.reverse()
  const reordered = mapDesignTokens(input)
  assert.notEqual(reordered.artifactsHash, original.artifactsHash)
  assert.equal(reordered.themeJsonFragment.settings.typography.fontFamilies[0]!.fontFamily, 'sans-serif, system-ui, "Example Sans"')
  input.tokens.fonts[0]!.families.reverse()
  input.tokens.colors = input.tokens.colors.map((token) => ({ ...token, value: token.value.toUpperCase() }))
  assert.deepEqual(mapDesignTokens(input), original)
})

test('generic font families are case-insensitive while named families retain spelling', () => {
  const input = fixture()
  const original = mapDesignTokens(input)
  input.tokens.fonts[0]!.families = ['Example Sans', 'System-UI', 'SANS-SERIF']
  assert.deepEqual(mapDesignTokens(input), original)
  input.tokens.fonts[0]!.families = ['system-ui', 'System-UI']
  assert.throws(() => mapDesignTokens(input), /invalid_input/)
})

const invalidValues = ['1rem; color:red', 'url(https://example.test/x)', 'var(--unknown)', 'calc(1rem + 2px)', '-1rem', '1%', '4097px', '257rem', '1rem\n', 'Infinitypx']
for (const value of invalidValues) {
  test(`rejects unsupported or unsafe length ${JSON.stringify(value)}`, () => {
    const input = fixture()
    input.tokens.spacing[0]!.value = value
    assert.throws(() => mapDesignTokens(input), /invalid_input/)
  })
}

test('rejects duplicate identities within/across categories and unsafe identifiers', () => {
  const input = fixture()
  input.tokens.colors.push({ ...input.tokens.colors[0]! })
  assert.throws(() => mapDesignTokens(input), /invalid_input/)
  input.tokens.colors.pop()
  input.tokens.spacing[0]!.id = input.tokens.colors[0]!.id
  assert.throws(() => mapDesignTokens(input), /invalid_input/)
  for (const id of ['../outside', 'name/name', 'name\\name', 'name\n', '--color-*', 'x;body', 'constructor.prototype']) {
    const invalid = fixture()
    invalid.tokens.fonts[0]!.id = id
    assert.throws(() => mapDesignTokens(invalid), /invalid_input/)
  }
})

test('rejects arbitrary CSS, paths and unsupported contract fields at every level', () => {
  const input = fixture()
  const cases: unknown[] = [
    { ...input, schemaVersion: 2 },
    { ...input, approved: true },
    { ...input, source: { ...input.source, path: '/tmp/private' } },
    { ...input, source: { ...input.source, designRef: '../design' } },
    { ...input, tokens: { ...input.tokens, radii: [] } },
    { ...input, tokens: { ...input.tokens, colors: [{ ...input.tokens.colors[0], value: '#000;}' }] } },
    { ...input, tokens: { ...input.tokens, colors: [{ ...input.tokens.colors[0], css: 'body{}' }] } },
    { ...input, tokens: { ...input.tokens, fonts: [{ ...input.tokens.fonts[0], families: ['Font"; } @import "x'] }] } },
    { ...input, tokens: { ...input.tokens, fonts: [{ ...input.tokens.fonts[0], families: ['inherit'] }] } },
    { ...input, tokens: { ...input.tokens, fontSizes: [{ ...input.tokens.fontSizes[0], value: '0px' }] } },
    { ...input, tokens: { ...input.tokens, spacing: [] } },
    { ...input, provenance: 'approved_export' },
  ]
  for (const invalid of cases) assert.throws(() => mapDesignTokens(invalid), /invalid_input/)
})
