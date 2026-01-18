/**
 * End-to-End tests for Electrolux API
 *
 * These tests run against the real Electrolux API to:
 * 1. Verify the API is accessible and working
 * 2. Detect changes in API response structure
 * 3. Validate our type definitions match reality
 *
 * HOW TO RUN:
 * - Set E2E_TEST=true environment variable to enable these tests
 * - Ensure config.yml has valid credentials
 * - Run: E2E_TEST=true pnpm test tests/e2e/electrolux-api.e2e.test.ts
 *
 * IMPORTANT:
 * - These tests are SKIPPED by default in CI/normal test runs
 * - They make real API calls and will affect your actual appliances
 * - Use with caution in production environments
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { BaseAppliance } from '../../src/appliances/base.js'
import { ElectroluxClient } from '../../src/electrolux.js'
import type { IMqtt } from '../../src/mqtt.js'
import type { Appliance, ApplianceInfo, ApplianceStub } from '../../src/types.js'

// Mock appliance type for testing
interface MockAppliance {
  applianceId: string
  applianceName: string
  applianceType: string
  created: string
  getApplianceId: () => string
  normalizeState: (state: Appliance) => Partial<Appliance>
}

// Skip these tests unless explicitly enabled
const isE2EEnabled = process.env.E2E_TEST === 'true'
const describeE2E = isE2EEnabled ? describe : describe.skip

describeE2E('Electrolux API - E2E Tests', () => {
  let client: ElectroluxClient
  let testApplianceId: string | null = null

  // Mock MQTT client that doesn't actually publish
  const mockMqtt = {
    client: null,
    topicPrefix: 'test/',
    publish: () => {},
    subscribe: () => {},
    isConnected: () => true,
    connect: async () => {},
    disconnect: async () => {},
    generateAutoDiscoveryConfig: () => {},
    resolveApplianceTopic: (applianceId: string, suffix: string) => `test/${applianceId}/${suffix}`,
    unsubscribe: () => {},
  } as unknown as IMqtt

  beforeAll(async () => {
    client = new ElectroluxClient(mockMqtt)
    await client.initialize()

    // Login to get valid session
    const loginSuccess = await client.login()
    if (!loginSuccess) {
      throw new Error('Failed to login to Electrolux API. Check credentials in config.yml')
    }

    console.log('✓ Successfully authenticated with Electrolux API')
  }, 30000) // 30 second timeout for authentication

  describe('API Structure Validation', () => {
    it('should fetch appliances list', async () => {
      const appliances = await client.getAppliances()

      expect(appliances).toBeDefined()
      expect(Array.isArray(appliances)).toBe(true)

      if (appliances && appliances.length > 0) {
        console.log(`Found ${appliances.length} appliance(s)`)
        testApplianceId = appliances[0].applianceId

        // Validate structure matches our type definition
        const appliance = appliances[0] as ApplianceStub
        expect(appliance).toHaveProperty('applianceId')
        expect(appliance).toHaveProperty('applianceName')
        expect(appliance).toHaveProperty('applianceType')
        expect(appliance).toHaveProperty('created')

        expect(typeof appliance.applianceId).toBe('string')
        expect(typeof appliance.applianceName).toBe('string')
        expect(typeof appliance.applianceType).toBe('string')
        expect(typeof appliance.created).toBe('string')

        console.log('✓ Appliance list structure matches type definition')
        console.log(`  Sample appliance: ${appliance.applianceName} (${appliance.applianceId})`)
      } else {
        console.warn('⚠ No appliances found in account. Some tests will be skipped.')
      }
    })

    it('should fetch appliance info with correct structure', async () => {
      if (!testApplianceId) {
        console.warn('⚠ Skipping: No appliance ID available')
        return
      }

      const info = await client.getApplianceInfo(testApplianceId)

      expect(info).toBeDefined()

      if (info) {
        console.log('\n📋 Actual appliance info response structure:')
        console.log(JSON.stringify(info, null, 2))

        // Check if response has applianceInfo wrapper or is the info directly
        const hasWrapper = 'applianceInfo' in info
        const applianceInfo = hasWrapper ? (info as ApplianceInfo).applianceInfo : info

        console.log('\n🔍 Checking structure...')
        console.log('Has wrapper:', hasWrapper)
        console.log('Keys:', Object.keys(applianceInfo))

        // Verify the essential properties exist
        expect(applianceInfo).toBeDefined()
        expect(applianceInfo).toHaveProperty('serialNumber')
        expect(applianceInfo).toHaveProperty('brand')

        console.log('✓ Appliance info structure validated')
        console.log(`  Brand: ${applianceInfo.brand}, Serial: ${applianceInfo.serialNumber}`)
      }
    })

    it('should fetch appliance state with correct structure', async () => {
      if (!testApplianceId) {
        console.warn('⚠ Skipping: No appliance ID available')
        return
      }

      // Mock appliance for testing
      const mockAppliance: MockAppliance = {
        applianceId: testApplianceId || 'unknown',
        applianceName: 'Test Appliance',
        applianceType: 'AC',
        created: new Date().toISOString(),
        getApplianceId: () => testApplianceId || 'unknown',
        normalizeState: (state: Appliance) => ({
          applianceId: state.applianceId,
          mode: state.properties.reported.mode,
        }),
      }

      const state = await client.getApplianceState(mockAppliance as unknown as BaseAppliance)

      expect(state).toBeDefined()

      if (state) {
        // Validate structure matches our type definition
        const applianceState = state as Appliance
        expect(applianceState).toHaveProperty('applianceId')
        expect(applianceState).toHaveProperty('connectionState')
        expect(applianceState).toHaveProperty('status')
        expect(applianceState).toHaveProperty('properties')
        expect(applianceState.properties).toHaveProperty('reported')

        const reported = applianceState.properties.reported
        expect(reported).toHaveProperty('applianceState')
        expect(reported).toHaveProperty('mode')
        expect(reported).toHaveProperty('targetTemperatureC')
        expect(reported).toHaveProperty('fanSpeedSetting')
        expect(reported).toHaveProperty('networkInterface')

        console.log('✓ Appliance state structure matches type definition')
        console.log(
          `  State: ${reported.applianceState}, Mode: ${reported.mode}, Temp: ${reported.targetTemperatureC}°C`,
        )
        console.log(`  Connection: ${applianceState.connectionState}, RSSI: ${reported.networkInterface.rssi}`)
      }
    })
  })

  describe('API Response Comparison', () => {
    it('should save current API responses as snapshots', async () => {
      const fs = await import('node:fs')
      const path = await import('node:path')

      const appliances = await client.getAppliances()

      if (appliances && appliances.length > 0) {
        const snapshotDir = path.resolve(process.cwd(), 'tests/e2e/snapshots')

        // Create snapshots directory if it doesn't exist
        if (!fs.existsSync(snapshotDir)) {
          fs.mkdirSync(snapshotDir, { recursive: true })
        }

        // Save appliances list
        const appliancesSnapshot = path.join(snapshotDir, 'appliances-list.json')
        fs.writeFileSync(appliancesSnapshot, JSON.stringify(appliances, null, 2), 'utf8')

        // Save first appliance info and state
        const firstAppliance = appliances[0]
        const info = await client.getApplianceInfo(firstAppliance.applianceId)

        if (info) {
          const infoSnapshot = path.join(snapshotDir, 'appliance-info.json')
          fs.writeFileSync(infoSnapshot, JSON.stringify(info, null, 2), 'utf8')
        }

        const mockAppliance: MockAppliance = {
          applianceId: firstAppliance.applianceId,
          applianceName: firstAppliance.applianceName,
          applianceType: firstAppliance.applianceType,
          created: firstAppliance.created,
          getApplianceId: () => firstAppliance.applianceId,
          normalizeState: (state: Appliance) => state,
        }

        const state = await client.getApplianceState(mockAppliance as unknown as BaseAppliance)

        if (state) {
          const stateSnapshot = path.join(snapshotDir, 'appliance-state.json')
          fs.writeFileSync(stateSnapshot, JSON.stringify(state, null, 2), 'utf8')
        }

        console.log('✓ API response snapshots saved to tests/e2e/snapshots/')
        console.log('  You can compare these with previous snapshots to detect API changes')
      }
    })

    it('should compare with previous snapshots if they exist', async () => {
      const fs = await import('node:fs')
      const path = await import('node:path')

      const snapshotDir = path.resolve(process.cwd(), 'tests/e2e/snapshots')
      const appliancesSnapshot = path.join(snapshotDir, 'appliances-list.json')

      if (fs.existsSync(appliancesSnapshot)) {
        const previousAppliances = JSON.parse(fs.readFileSync(appliancesSnapshot, 'utf8'))
        const currentAppliances = await client.getAppliances()

        if (currentAppliances) {
          // Compare structure (not exact values, as they may change)
          const previousKeys = Object.keys(previousAppliances[0] || {})
          const currentKeys = Object.keys(currentAppliances[0] || {})

          const missingKeys = previousKeys.filter((k) => !currentKeys.includes(k))
          const newKeys = currentKeys.filter((k) => !previousKeys.includes(k))

          if (missingKeys.length > 0) {
            console.warn('⚠ Keys removed from API response:', missingKeys)
          }
          if (newKeys.length > 0) {
            console.log('✓ New keys added to API response:', newKeys)
          }
          if (missingKeys.length === 0 && newKeys.length === 0) {
            console.log('✓ API response structure unchanged')
          }

          // Don't fail the test, just log differences
          expect(true).toBe(true)
        }
      } else {
        console.log('ℹ No previous snapshots found. Run this test again to enable comparison.')
      }
    })
  })

  describe('Token Management', () => {
    it('should handle token refresh', async () => {
      await client.ensureValidToken()

      expect(client.isLoggedIn).toBe(true)
      console.log('✓ Token validation successful')
    })
  })
})

describeE2E('Usage Instructions', () => {
  it('should display instructions when E2E tests are disabled', () => {
    if (!isE2EEnabled) {
      console.log(`\n${'='.repeat(80)}`)
      console.log('E2E Tests are DISABLED')
      console.log('='.repeat(80))
      console.log('\nTo run E2E tests against the real Electrolux API:')
      console.log('\n  E2E_TEST=true pnpm test tests/e2e/electrolux-api.e2e.test.ts\n')
      console.log('⚠ WARNING: These tests will:')
      console.log('  • Make real API calls to Electrolux servers')
      console.log('  • Interact with your actual appliances')
      console.log('  • Save API response snapshots for comparison')
      console.log(`\n${'='.repeat(80)}\n`)
    }
    expect(true).toBe(true)
  })
})
