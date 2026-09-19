import { createHash } from 'node:crypto'
import { MAX_CANONICAL_DEPTH } from './canonicalConstants'

export { MAX_CANONICAL_DEPTH, SHA256_HEX_PATTERN } from './canonicalConstants'

export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

type CanonicalValue = null | boolean | number | string | CanonicalValue[] | { [key: string]: CanonicalValue }

function toCanonicalValue(value: unknown, ancestors: Set<object>): CanonicalValue {
  if (ancestors.size > MAX_CANONICAL_DEPTH) {
    throw new Error(`[internal] canonical JSON does not support nesting deeper than ${MAX_CANONICAL_DEPTH}`)
  }
  if (value === null) return null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('[internal] canonical JSON does not support non-finite numbers')
    return Object.is(value, -0) ? 0 : value
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error('[internal] canonical JSON does not support invalid dates')
    return value.toISOString()
  }
  if (typeof value !== 'object') {
    throw new Error(`[internal] canonical JSON does not support values of type ${typeof value}`)
  }
  if (ancestors.has(value)) throw new Error('[internal] canonical JSON does not support circular references')
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      return value.map((item) => (item === undefined ? null : toCanonicalValue(item, ancestors)))
    }
    const prototype: unknown = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('[internal] canonical JSON supports plain objects only')
    }
    const source = value as Record<string, unknown>
    const result: { [key: string]: CanonicalValue } = Object.create(null)
    for (const key of Object.keys(source).sort(compareCodeUnits)) {
      const entry = source[key]
      if (entry === undefined) continue
      result[key] = toCanonicalValue(entry, ancestors)
    }
    return result
  } finally {
    ancestors.delete(value)
  }
}

export function canonicalize(value: unknown): string {
  if (value === undefined) throw new Error('[internal] canonical JSON does not support undefined as a document')
  return JSON.stringify(toCanonicalValue(value, new Set<object>()))
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex')
}

export function hashCanonical(value: unknown): string {
  return sha256Hex(canonicalize(value))
}
