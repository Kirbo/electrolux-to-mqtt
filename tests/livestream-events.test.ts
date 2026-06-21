import { describe, expect, it } from 'vitest'
import {
  applyStreamEvent,
  coerceConnectionState,
  isLivestreamConfig,
  isStreamEvent,
  parseStreamEventData,
} from '@/livestream-events.js'
import { mockApplianceStateResponse } from './fixtures/api-responses.js'

// Clone to get a realistic Appliance fixture without mutating the shared mock
function makeAppliance() {
  return structuredClone(mockApplianceStateResponse)
}

describe('isStreamEvent', () => {
  it('accepts a valid event with all fields', () => {
    expect(isStreamEvent({ applianceId: 'abc', property: 'targetTemperatureC', value: 22 })).toBe(true)
  })

  it('accepts value = null', () => {
    expect(isStreamEvent({ applianceId: 'abc', property: 'targetTemperatureC', value: null })).toBe(true)
  })

  it('rejects null', () => {
    expect(isStreamEvent(null)).toBe(false)
  })

  it('rejects missing applianceId', () => {
    expect(isStreamEvent({ property: 'foo', value: 1 })).toBe(false)
  })

  it('rejects empty applianceId', () => {
    expect(isStreamEvent({ applianceId: '', property: 'foo', value: 1 })).toBe(false)
  })

  it('rejects missing property', () => {
    expect(isStreamEvent({ applianceId: 'abc', value: 1 })).toBe(false)
  })

  it('rejects non-string applianceId', () => {
    expect(isStreamEvent({ applianceId: 123, property: 'foo', value: 1 })).toBe(false)
  })

  it('rejects non-string property', () => {
    expect(isStreamEvent({ applianceId: 'abc', property: 42, value: 1 })).toBe(false)
  })

  it('rejects a plain string', () => {
    expect(isStreamEvent('hello')).toBe(false)
  })

  it('rejects an array', () => {
    expect(isStreamEvent([])).toBe(false)
  })
})

describe('isLivestreamConfig', () => {
  it('accepts a valid config', () => {
    expect(
      isLivestreamConfig({
        url: 'https://stream.example.com',
        appliances: [{ applianceId: 'abc', properties: ['mode', 'targetTemperatureC'] }],
      }),
    ).toBe(true)
  })

  it('accepts empty appliances array', () => {
    expect(isLivestreamConfig({ url: 'https://stream.example.com', appliances: [] })).toBe(true)
  })

  it('rejects null', () => {
    expect(isLivestreamConfig(null)).toBe(false)
  })

  it('rejects missing url', () => {
    expect(isLivestreamConfig({ appliances: [] })).toBe(false)
  })

  it('rejects non-string url', () => {
    expect(isLivestreamConfig({ url: 42, appliances: [] })).toBe(false)
  })

  it('rejects missing appliances', () => {
    expect(isLivestreamConfig({ url: 'https://stream.example.com' })).toBe(false)
  })

  it('rejects appliances as non-array', () => {
    expect(isLivestreamConfig({ url: 'https://stream.example.com', appliances: 'foo' })).toBe(false)
  })

  it('rejects appliance entry missing applianceId', () => {
    expect(isLivestreamConfig({ url: 'https://stream.example.com', appliances: [{ properties: ['mode'] }] })).toBe(
      false,
    )
  })

  it('rejects appliance entry with non-string applianceId', () => {
    expect(
      isLivestreamConfig({
        url: 'https://stream.example.com',
        appliances: [{ applianceId: 123, properties: ['mode'] }],
      }),
    ).toBe(false)
  })

  it('rejects appliance entry missing properties array', () => {
    expect(isLivestreamConfig({ url: 'https://stream.example.com', appliances: [{ applianceId: 'abc' }] })).toBe(false)
  })

  it('rejects appliance entry with non-array properties', () => {
    expect(
      isLivestreamConfig({
        url: 'https://stream.example.com',
        appliances: [{ applianceId: 'abc', properties: 'mode' }],
      }),
    ).toBe(false)
  })
})

describe('parseStreamEventData', () => {
  it('parses a valid JSON event', () => {
    const result = parseStreamEventData('{"applianceId":"abc","property":"targetTemperatureC","value":22}')
    expect(result).toEqual({ applianceId: 'abc', property: 'targetTemperatureC', value: 22 })
  })

  it('parses an event with null value', () => {
    const result = parseStreamEventData('{"applianceId":"abc","property":"mode","value":null}')
    expect(result).toEqual({ applianceId: 'abc', property: 'mode', value: null })
  })

  it('returns null for malformed JSON', () => {
    expect(parseStreamEventData('not-json')).toBeNull()
  })

  it('returns null for missing applianceId', () => {
    expect(parseStreamEventData('{"property":"mode","value":1}')).toBeNull()
  })

  it('returns null for empty applianceId', () => {
    expect(parseStreamEventData('{"applianceId":"","property":"mode","value":1}')).toBeNull()
  })

  it('returns null for missing property', () => {
    expect(parseStreamEventData('{"applianceId":"abc","value":1}')).toBeNull()
  })

  it('returns null for a JSON number (non-object)', () => {
    expect(parseStreamEventData('5')).toBeNull()
  })

  it('returns null for a JSON null literal', () => {
    expect(parseStreamEventData('null')).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(parseStreamEventData('')).toBeNull()
  })
})

describe('coerceConnectionState', () => {
  it('returns Connected for exact "Connected"', () => {
    expect(coerceConnectionState('Connected', 'Disconnected')).toBe('Connected')
  })

  it('returns Disconnected for exact "Disconnected"', () => {
    expect(coerceConnectionState('Disconnected', 'Connected')).toBe('Disconnected')
  })

  it('is case-insensitive — accepts "connected"', () => {
    expect(coerceConnectionState('connected', 'Disconnected')).toBe('Connected')
  })

  it('is case-insensitive — accepts "DISCONNECTED"', () => {
    expect(coerceConnectionState('DISCONNECTED', 'Connected')).toBe('Disconnected')
  })

  it('maps boolean true to Connected', () => {
    expect(coerceConnectionState(true, 'Disconnected')).toBe('Connected')
  })

  it('maps boolean false to Disconnected', () => {
    expect(coerceConnectionState(false, 'Connected')).toBe('Disconnected')
  })

  it('returns prior for unknown string', () => {
    expect(coerceConnectionState('online', 'Connected')).toBe('Connected')
  })

  it('returns prior for a number', () => {
    expect(coerceConnectionState(42, 'Disconnected')).toBe('Disconnected')
  })

  it('returns prior for null', () => {
    expect(coerceConnectionState(null, 'Connected')).toBe('Connected')
  })

  it('returns prior for undefined', () => {
    expect(coerceConnectionState(undefined, 'Disconnected')).toBe('Disconnected')
  })
})

describe('applyStreamEvent', () => {
  describe('connectionState special-case', () => {
    it('sets top-level connectionState for property "connectionState"', () => {
      const cached = makeAppliance() // Connected
      const result = applyStreamEvent(cached, {
        applianceId: cached.applianceId,
        property: 'connectionState',
        value: 'Disconnected',
      })
      expect(result.connectionState).toBe('Disconnected')
    })

    it('sets top-level connectionState for property "connectivityState"', () => {
      const cached = makeAppliance() // Connected
      const result = applyStreamEvent(cached, {
        applianceId: cached.applianceId,
        property: 'connectivityState',
        value: 'Disconnected',
      })
      expect(result.connectionState).toBe('Disconnected')
    })

    it('does NOT add connectionState under properties.reported', () => {
      const cached = makeAppliance()
      const result = applyStreamEvent(cached, {
        applianceId: cached.applianceId,
        property: 'connectionState',
        value: 'Disconnected',
      })
      // reported should not have a connectionState key added
      expect('connectionState' in result.properties.reported).toBe(false)
    })

    it('does NOT add connectivityState under properties.reported', () => {
      const cached = makeAppliance()
      const result = applyStreamEvent(cached, {
        applianceId: cached.applianceId,
        property: 'connectivityState',
        value: 'Connected',
      })
      expect('connectivityState' in result.properties.reported).toBe(false)
    })
  })

  describe('nested path in properties.reported', () => {
    it('creates a nested path when intermediate segment is missing', () => {
      const cached = makeAppliance()
      // userSelections does not exist in the base fixture
      const result = applyStreamEvent(cached, {
        applianceId: cached.applianceId,
        property: 'userSelections/analogSpinSpeed',
        value: 1200,
      })
      const reported = result.properties.reported as Record<string, unknown>
      const userSelections = reported.userSelections as Record<string, unknown>
      expect(userSelections).toBeDefined()
      expect(userSelections.analogSpinSpeed).toBe(1200)
    })

    it('preserves existing sibling fields when patching a nested path', () => {
      const cached = makeAppliance()
      const result = applyStreamEvent(cached, {
        applianceId: cached.applianceId,
        property: 'userSelections/analogSpinSpeed',
        value: 800,
      })
      // pre-existing sibling fields in reported must survive
      expect(result.properties.reported.targetTemperatureC).toBe(22)
      expect(result.properties.reported.mode).toBe('cool')
    })

    it('patches a simple top-of-reported field', () => {
      const cached = makeAppliance()
      const result = applyStreamEvent(cached, {
        applianceId: cached.applianceId,
        property: 'targetTemperatureC',
        value: 26,
      })
      expect(result.properties.reported.targetTemperatureC).toBe(26)
    })

    it('replaces a scalar intermediate segment with an object (no throw)', () => {
      const cached = makeAppliance()
      // targetTemperatureC is currently 22 (a number); use it as a path segment
      const result = applyStreamEvent(cached, {
        applianceId: cached.applianceId,
        property: 'targetTemperatureC/subField',
        value: 'yes',
      })
      const reported = result.properties.reported as Record<string, unknown>
      const node = reported.targetTemperatureC as Record<string, unknown>
      expect(typeof node).toBe('object')
      expect(node.subField).toBe('yes')
    })
  })

  describe('input immutability', () => {
    it('does not mutate the cached Appliance passed in', () => {
      const cached = makeAppliance()
      const snapshot = structuredClone(cached)
      applyStreamEvent(cached, {
        applianceId: cached.applianceId,
        property: 'targetTemperatureC',
        value: 30,
      })
      expect(cached).toEqual(snapshot)
    })

    it('does not mutate the cached Appliance for connectionState path', () => {
      const cached = makeAppliance()
      const snapshot = structuredClone(cached)
      applyStreamEvent(cached, {
        applianceId: cached.applianceId,
        property: 'connectionState',
        value: 'Disconnected',
      })
      expect(cached).toEqual(snapshot)
    })
  })
})
