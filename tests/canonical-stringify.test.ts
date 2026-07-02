import { describe, expect, it } from 'vitest'
import { canonicalStringify } from '@/canonical-stringify.js'

describe('canonicalStringify', () => {
  it('should sort object keys recursively', () => {
    expect(canonicalStringify({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}')
  })

  it('should stringify arrays and primitives like JSON.stringify', () => {
    expect(canonicalStringify([1, 'two', null, true])).toBe('[1,"two",null,true]')
    expect(canonicalStringify('x')).toBe('"x"')
    expect(canonicalStringify(null)).toBe('null')
  })

  it('should skip object keys with undefined values (JSON.stringify parity)', () => {
    expect(canonicalStringify({ a: 1, b: undefined })).toBe('{"a":1}')
    expect(() => JSON.parse(canonicalStringify({ a: 1, b: undefined }))).not.toThrow()
  })

  it('should serialize undefined array elements as null (JSON.stringify parity)', () => {
    expect(canonicalStringify([1, undefined, 2])).toBe('[1,null,2]')
    expect(JSON.parse(canonicalStringify({ a: [undefined] }))).toEqual({ a: [null] })
  })
})
