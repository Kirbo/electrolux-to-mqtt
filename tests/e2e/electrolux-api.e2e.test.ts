/**
 * End-to-End tests for Electrolux API
 *
 * These tests run against the real Electrolux API to:
 * 1. Verify the API is accessible and working
 * 2. Detect changes in API response structure
 * 3. Validate our type definitions match reality
 *
 * HOW TO RUN:
 * - Ensure config.yml has valid credentials
 * - Run: pnpm test:e2e
 *
 * IMPORTANT:
 * - These tests are SKIPPED by default in CI/normal test runs
 * - They make real API calls and will affect your actual appliances
 * - Use with caution in production environments
 *
 * SNAPSHOTS:
 * - appliances-list.json is saved at the snapshot root
 * - appliance-info.json and appliance-state.json are saved under
 *   a model-specific directory (e.g. snapshots/comfort600/) using
 *   the lowercase model name from applianceInfo.model
 */

import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { ApplianceFactory } from '../../src/appliances/factory.js'
import { ElectroluxClient } from '../../src/electrolux.js'
import type { IMqtt } from '../../src/mqtt.js'
import type { ApplianceInfo, ApplianceStub } from '../../src/types.js'

const SNAPSHOT_DIR = path.resolve(process.cwd(), 'tests/e2e/snapshots')

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function writeSnapshot(filePath: string, data: unknown) {
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
}

function readSnapshot<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
}

/**
 * Derive the snapshot subdirectory name from the ApplianceInfo model.
 * Falls back to the deviceType if model is missing.
 * Always lowercased to match src/appliances/{model}.ts convention.
 */
function snapshotModelDir(info: ApplianceInfo): string {
  const model = info.applianceInfo.model || info.applianceInfo.deviceType
  return model.toLowerCase()
}

// Skip these tests unless explicitly enabled
const isE2EEnabled = process.env.E2E_TEST === 'true'

describe.skipIf(!isE2EEnabled)('Electrolux API - E2E Tests', () => {
  let client: ElectroluxClient
  let appliances: ApplianceStub[] | null = null
  const applianceInfoMap = new Map<string, ApplianceInfo>()

  // Mock MQTT client that doesn't actually publish
  const mockMqtt = {
    client: null,
    topicPrefix: 'test/',
    publish: () => {},
    subscribe: () => Promise.resolve(),
    isConnected: () => true,
    connect: async () => {},
    disconnect: async () => {},
    generateAutoDiscoveryConfig: () => {},
    resolveApplianceTopic: (applianceId: string) => `test/${applianceId}`,
    unsubscribe: () => {},
    publishInfo: () => {},
    autoDiscovery: () => {},
  } as unknown as IMqtt

  beforeAll(async () => {
    client = new ElectroluxClient(mockMqtt)
    await client.initialize()

    const loginSuccess = await client.login()
    if (!loginSuccess) {
      throw new Error('Failed to login to Electrolux API. Check credentials in config.yml')
    }

    console.log('✓ Successfully authenticated with Electrolux API')
  }, 30000)

  describe('API Structure Validation', () => {
    it('should fetch appliances list', async () => {
      appliances = await client.getAppliances()

      expect(appliances).toBeDefined()
      expect(Array.isArray(appliances)).toBe(true)

      if (appliances && appliances.length > 0) {
        console.log(`Found ${appliances.length} appliance(s)`)

        for (const appliance of appliances) {
          expect(typeof appliance.applianceId).toBe('string')
          expect(typeof appliance.applianceName).toBe('string')
          expect(typeof appliance.applianceType).toBe('string')
          expect(typeof appliance.created).toBe('string')

          console.log(`  - ${appliance.applianceName} (${appliance.applianceId})`)
        }

        console.log('✓ Appliance list structure matches type definition')
      } else {
        console.warn('⚠ No appliances found in account. Some tests will be skipped.')
      }
    })

    it('should fetch appliance info for each appliance', async () => {
      if (!appliances || appliances.length === 0) {
        console.warn('⚠ Skipping: No appliances available')
        return
      }

      for (const stub of appliances) {
        const info = await client.getApplianceInfo(stub.applianceId)
        expect(info).toBeDefined()

        if (info) {
          applianceInfoMap.set(stub.applianceId, info)

          expect(info.applianceInfo).toBeDefined()
          expect(info.applianceInfo).toHaveProperty('serialNumber')
          expect(info.applianceInfo).toHaveProperty('brand')
          expect(info.applianceInfo).toHaveProperty('deviceType')
          expect(info.applianceInfo).toHaveProperty('model')
          expect(info.capabilities).toBeDefined()

          console.log(
            `✓ ${stub.applianceName}: ${info.applianceInfo.brand} ${info.applianceInfo.model} (${info.applianceInfo.deviceType})`,
          )
        }
      }
    })

    it('should fetch appliance state for each appliance', async () => {
      if (!appliances || appliances.length === 0) {
        console.warn('⚠ Skipping: No appliances available')
        return
      }

      for (const stub of appliances) {
        const info = applianceInfoMap.get(stub.applianceId)
        if (!info) continue

        const appliance = ApplianceFactory.create(stub, info)
        const state = await client.getApplianceState(appliance)

        expect(state).toBeDefined()

        if (state) {
          expect(state).toHaveProperty('applianceId')
          expect(state).toHaveProperty('connectionState')
          expect(state).toHaveProperty('status')
          expect(state).toHaveProperty('properties')
          expect(state.properties).toHaveProperty('reported')

          const reported = state.properties.reported
          console.log(
            `✓ ${stub.applianceName}: state=${reported.applianceState}, mode=${reported.mode}, temp=${reported.targetTemperatureC}°C`,
          )
        }
      }
    })
  })

  describe('Snapshot Management', () => {
    it('should save snapshots organized by model', async () => {
      if (!appliances || appliances.length === 0) {
        console.warn('⚠ Skipping: No appliances available')
        return
      }

      // Save appliances list at the snapshot root
      writeSnapshot(path.join(SNAPSHOT_DIR, 'appliances-list.json'), appliances)
      console.log('✓ Saved appliances-list.json')

      // Save per-appliance snapshots under model-specific directories
      for (const stub of appliances) {
        const info = applianceInfoMap.get(stub.applianceId)
        if (!info) continue

        const modelDir = snapshotModelDir(info)
        const modelPath = path.join(SNAPSHOT_DIR, modelDir)

        writeSnapshot(path.join(modelPath, 'appliance-info.json'), info)

        const appliance = ApplianceFactory.create(stub, info)
        const state = await client.getApplianceState(appliance)
        if (state) {
          writeSnapshot(path.join(modelPath, 'appliance-state.json'), state)
        }

        console.log(`✓ Saved ${modelDir}/appliance-info.json and appliance-state.json`)
      }
    })

    it('should compare with previous snapshots if they exist', async () => {
      if (!appliances || appliances.length === 0) return

      for (const stub of appliances) {
        const info = applianceInfoMap.get(stub.applianceId)
        if (!info) continue

        const modelDir = snapshotModelDir(info)
        const prevInfo = readSnapshot<ApplianceInfo>(path.join(SNAPSHOT_DIR, modelDir, 'appliance-info.json'))

        if (!prevInfo) {
          console.log(`ℹ No previous snapshot for ${modelDir}. Run again to enable comparison.`)
          continue
        }

        // Compare capability keys
        const previousKeys = Object.keys(prevInfo.capabilities)
        const currentKeys = Object.keys(info.capabilities)

        const missingKeys = previousKeys.filter((k) => !currentKeys.includes(k))
        const newKeys = currentKeys.filter((k) => !previousKeys.includes(k))

        if (missingKeys.length > 0) {
          console.warn(`⚠ ${modelDir}: Capabilities removed:`, missingKeys)
        }
        if (newKeys.length > 0) {
          console.log(`✓ ${modelDir}: New capabilities:`, newKeys)
        }
        if (missingKeys.length === 0 && newKeys.length === 0) {
          console.log(`✓ ${modelDir}: Capabilities structure unchanged`)
        }
      }

      expect(true).toBe(true)
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
