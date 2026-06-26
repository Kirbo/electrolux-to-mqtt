import { describe, expect, it } from 'vitest'
import { buildAptabaseEvent } from '../src/aptabase.js'

const VALID_HASH = 'a'.repeat(64)
const SERVICE_VERSION = '1.0.0'

describe('buildAptabaseEvent', () => {
  it('sets sessionId to the userHash', () => {
    const event = buildAptabaseEvent({ userHash: VALID_HASH, version: '1.2.3' }, SERVICE_VERSION)
    expect(event.sessionId).toBe(VALID_HASH)
  })

  it('sets eventName to version_check', () => {
    const event = buildAptabaseEvent({ userHash: VALID_HASH, version: '1.2.3' }, SERVICE_VERSION)
    expect(event.eventName).toBe('version_check')
  })

  it('strips the leading v from the version for appVersion', () => {
    const event = buildAptabaseEvent({ userHash: VALID_HASH, version: 'v1.2.3' }, SERVICE_VERSION)
    expect(event.systemProps.appVersion).toBe('1.2.3')
  })

  it('leaves version without leading v unchanged', () => {
    const event = buildAptabaseEvent({ userHash: VALID_HASH, version: '2026.6.0' }, SERVICE_VERSION)
    expect(event.systemProps.appVersion).toBe('2026.6.0')
  })

  it('sets isDebug to false', () => {
    const event = buildAptabaseEvent({ userHash: VALID_HASH, version: '1.2.3' }, SERVICE_VERSION)
    expect(event.systemProps.isDebug).toBe(false)
  })

  it('sets sdkVersion to telemetry-backend@<version>', () => {
    const event = buildAptabaseEvent({ userHash: VALID_HASH, version: '1.2.3' }, SERVICE_VERSION)
    expect(event.systemProps.sdkVersion).toBe(`telemetry-backend@${SERVICE_VERSION}`)
  })

  it('uses the channel from the body when present', () => {
    const event = buildAptabaseEvent({ userHash: VALID_HASH, version: '1.2.3', channel: 'beta' }, SERVICE_VERSION)
    expect(event.props.channel).toBe('beta')
  })

  it('derives channel=beta for a CalVer beta version when channel is absent', () => {
    const event = buildAptabaseEvent({ userHash: VALID_HASH, version: '2026.6.0b1' }, SERVICE_VERSION)
    expect(event.props.channel).toBe('beta')
  })

  it('derives channel=beta for a semver pre-release version when channel is absent', () => {
    const event = buildAptabaseEvent({ userHash: VALID_HASH, version: '1.2.3-rc.1' }, SERVICE_VERSION)
    expect(event.props.channel).toBe('beta')
  })

  it('derives channel=stable for a stable version when channel is absent', () => {
    const event = buildAptabaseEvent({ userHash: VALID_HASH, version: '1.2.3' }, SERVICE_VERSION)
    expect(event.props.channel).toBe('stable')
  })

  it('derives channel=stable for a CalVer stable version when channel is absent', () => {
    const event = buildAptabaseEvent({ userHash: VALID_HASH, version: '2026.6.0' }, SERVICE_VERSION)
    expect(event.props.channel).toBe('stable')
  })

  it("sets source to 'legacy'", () => {
    const event = buildAptabaseEvent({ userHash: VALID_HASH, version: '1.2.3' }, SERVICE_VERSION)
    expect(event.props.source).toBe('legacy')
  })

  it('sets a valid ISO 8601 timestamp', () => {
    const event = buildAptabaseEvent({ userHash: VALID_HASH, version: '1.2.3' }, SERVICE_VERSION)
    expect(() => new Date(event.timestamp)).not.toThrow()
    expect(new Date(event.timestamp).toISOString()).toBe(event.timestamp)
  })
})
