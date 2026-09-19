import { MAX_CANONICAL_DEPTH, SHA256_HEX_PATTERN, canonicalize, hashCanonical, sha256Hex } from '../hash'

describe('delivery_os canonical hash', () => {
  it('matches the published sha256 test vector for "abc"', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256Hex(new TextEncoder().encode('abc'))).toBe(sha256Hex('abc'))
  })

  it('serialises with recursively sorted keys and preserved array order', () => {
    const value = { b: 1, a: { d: [3, 1, 2], c: 'x' } }
    expect(canonicalize(value)).toBe('{"a":{"c":"x","d":[3,1,2]},"b":1}')
    expect(hashCanonical(value)).toBe(sha256Hex('{"a":{"c":"x","d":[3,1,2]},"b":1}'))
    expect(hashCanonical(value)).toMatch(SHA256_HEX_PATTERN)
  })

  it('gives the same hash regardless of key order at every depth', () => {
    const first = { requirements: [{ id: 'REQ-1', title: 'List' }], tokens: { color: { primary: '#000' }, space: 4 } }
    const second = { tokens: { space: 4, color: { primary: '#000' } }, requirements: [{ title: 'List', id: 'REQ-1' }] }
    expect(hashCanonical(first)).toBe(hashCanonical(second))
  })

  it('gives a different hash for different content', () => {
    const base = { acIds: ['AC-001', 'AC-002'], limit: 0 }
    expect(hashCanonical({ ...base, limit: 1 })).not.toBe(hashCanonical(base))
    expect(hashCanonical({ ...base, acIds: ['AC-002', 'AC-001'] })).not.toBe(hashCanonical(base))
    expect(hashCanonical({ ...base, limit: '0' })).not.toBe(hashCanonical(base))
    expect(hashCanonical({ ...base, extra: null })).not.toBe(hashCanonical(base))
  })

  it('drops undefined properties so they equal missing properties', () => {
    expect(hashCanonical({ a: 1, b: undefined })).toBe(hashCanonical({ a: 1 }))
    expect(canonicalize({ a: { b: undefined } })).toBe('{"a":{}}')
  })

  it('keeps array positions by writing undefined items as null', () => {
    expect(canonicalize([1, undefined, 2])).toBe('[1,null,2]')
  })

  it('writes dates as ISO strings and treats negative zero as zero', () => {
    expect(canonicalize({ at: new Date('2026-09-19T00:00:00.000Z') })).toBe('{"at":"2026-09-19T00:00:00.000Z"}')
    expect(canonicalize({ value: -0 })).toBe('{"value":0}')
  })

  it('accepts the same object referenced twice without treating it as a cycle', () => {
    const shared = { id: 'AC-001' }
    expect(canonicalize({ first: shared, second: shared })).toBe('{"first":{"id":"AC-001"},"second":{"id":"AC-001"}}')
  })

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['bigint', BigInt(1)],
    ['function', () => 1],
    ['symbol', Symbol('x')],
    ['undefined document', undefined],
    ['class instance', new Map()],
    ['invalid date', new Date('nope')],
  ])('rejects %s with an internal error', (_label, value) => {
    expect(() => canonicalize(value === undefined ? undefined : { value })).toThrow(/^\[internal\]/)
  })

  it('hashes a __proto__ key as content instead of dropping it', () => {
    const plain = JSON.parse('{"a":1}')
    const polluted = JSON.parse('{"a":1,"__proto__":{"evil":true}}')
    expect(canonicalize(polluted)).toBe('{"__proto__":{"evil":true},"a":1}')
    expect(hashCanonical(polluted)).not.toBe(hashCanonical(plain))
  })

  it('accepts nesting up to the limit and rejects deeper documents with an internal error', () => {
    const nest = (levels: number) => {
      let value: unknown = 'leaf'
      for (let index = 0; index < levels; index += 1) value = { child: value }
      return value
    }
    expect(() => canonicalize(nest(MAX_CANONICAL_DEPTH))).not.toThrow()
    expect(() => canonicalize(nest(MAX_CANONICAL_DEPTH + 2))).toThrow(/^\[internal\].*nesting/)
    expect(() => canonicalize(nest(20000))).toThrow(/^\[internal\].*nesting/)
  })

  it('rejects circular references', () => {
    const node: Record<string, unknown> = { id: 1 }
    node.self = node
    expect(() => hashCanonical(node)).toThrow(/^\[internal\].*circular/)
  })
})
