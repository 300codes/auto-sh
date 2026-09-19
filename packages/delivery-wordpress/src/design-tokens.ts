import { createHash } from 'node:crypto'
import { z } from 'zod'
import { parseInput } from './contracts.ts'

const text = z.string().min(1).max(200).refine((value) => !/[\u0000-\u001f\u007f]/.test(value))
const reference = text.regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/)
const identifier = text.max(48).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
const label = text.max(80).regex(/^[\p{L}\p{N} ._-]+$/u)
const identity = { id: identifier, name: label }
const length = text.max(24).regex(/^(?:0|[1-9][0-9]{0,3})(?:\.[0-9]{1,4})?(?:px|rem|em)$/)
  .refine((value) => parseFloat(value) <= (value.endsWith('px') ? 4096 : 256))
const color = z.object({ ...identity, value: text.regex(/^#[a-fA-F0-9]{6}(?:[a-fA-F0-9]{2})?$/).transform((value) => value.toLowerCase()) }).strict()
const genericFamilies = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong'])
const family = text.max(80).regex(/^[A-Za-z][A-Za-z0-9]*(?:[ -][A-Za-z0-9]+)*$/)
  .refine((value) => !['inherit', 'initial', 'unset', 'revert', 'revert-layer', 'default'].includes(value.toLowerCase()))
  .transform((value) => genericFamilies.has(value.toLowerCase()) ? value.toLowerCase() : value)
const font = z.object({ ...identity, families: z.array(family).min(1).max(8).refine((values) => new Set(values).size === values.length) }).strict()
const size = z.object({ ...identity, value: length.refine((value) => parseFloat(value) > 0) }).strict()
const spacing = z.object({ ...identity, value: length }).strict()
const sourceSchema = z.object({ designRef: reference, revision: reference, approvalRef: reference.optional() }).strict()

export const designTokenExportSchema = z.object({
  schemaVersion: z.literal(1),
  provenance: z.enum(['fixture', 'operator_supplied']),
  source: sourceSchema,
  tokens: z.object({
    colors: z.array(color).min(1).max(128),
    fonts: z.array(font).min(1).max(32),
    fontSizes: z.array(size).min(1).max(64),
    spacing: z.array(spacing).min(1).max(64),
  }).strict(),
}).strict().superRefine((value, context) => {
  const identifiers = Object.values(value.tokens).flat().map((token) => token.id)
  if (new Set(identifiers).size !== identifiers.length) context.addIssue({ code: 'custom', message: '[internal] Duplicate token identity', path: ['tokens'] })
  if (value.provenance === 'operator_supplied' && !value.source.approvalRef) {
    context.addIssue({ code: 'custom', message: '[internal] Declared approval reference required', path: ['source', 'approvalRef'] })
  }
})

export type DesignTokenExport = z.infer<typeof designTokenExportSchema>
const ordinal = (left: { id: string }, right: { id: string }) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
const slug = (id: string) => `design-${id}`
const fontFamily = (families: string[]) => families.map((value) => genericFamilies.has(value) ? value : JSON.stringify(value)).join(', ')

export function mapDesignTokens(input: unknown) {
  const parsed = parseInput(designTokenExportSchema, input)
  const tokens = {
    colors: [...parsed.tokens.colors].sort(ordinal),
    fonts: [...parsed.tokens.fonts].sort(ordinal),
    fontSizes: [...parsed.tokens.fontSizes].sort(ordinal),
    spacing: [...parsed.tokens.spacing].sort(ordinal),
  }
  const normalized = { schemaVersion: parsed.schemaVersion, provenance: parsed.provenance, source: parsed.source, tokens }
  const inputHash = sha256(JSON.stringify(normalized))
  const themeJsonFragment = {
    version: 3 as const,
    settings: {
      color: { palette: tokens.colors.map((token) => ({ slug: slug(token.id), name: token.name, color: token.value })) },
      typography: {
        fontFamilies: tokens.fonts.map((token) => ({ slug: slug(token.id), name: token.name, fontFamily: fontFamily(token.families) })),
        fontSizes: tokens.fontSizes.map((token) => ({ slug: slug(token.id), name: token.name, size: token.value })),
      },
      spacing: { spacingSizes: tokens.spacing.map((token) => ({ slug: slug(token.id), name: token.name, size: token.value })) },
    },
  }
  const variable = (namespace: string, preset: string, id: string, value: string) =>
    `  --${namespace}-${slug(id)}: var(--wp--preset--${preset}--${slug(id)}, ${value});`
  const tailwindCss = '@theme inline {\n' + [
    ...tokens.colors.map((token) => variable('color', 'color', token.id, token.value)),
    ...tokens.fonts.map((token) => variable('font', 'font-family', token.id, fontFamily(token.families))),
    ...tokens.fontSizes.map((token) => variable('text', 'font-size', token.id, token.value)),
    ...tokens.spacing.map((token) => variable('spacing', 'spacing', token.id, token.value)),
  ].join('\n') + '\n}\n'
  const artifactsHash = sha256(JSON.stringify({ schemaVersion: 1, themeJsonFragment, tailwindCss }))
  return {
    schemaVersion: 1 as const,
    provenance: parsed.provenance,
    approvalVerification: 'not_evaluated' as const,
    source: parsed.source,
    inputHash,
    themeJsonFragment,
    tailwindCss,
    artifactsHash,
  }
}

export type DesignTokenMapping = ReturnType<typeof mapDesignTokens>
