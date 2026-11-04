import { describe, expect, it } from 'vitest'
import { httpRequest } from '#/http.ts'

const isE2EEnabled = process.env.E2E === 'true' || process.env.E2E_TEST === 'true'
const NOTIFY_TOPIC = process.env.E2M_NTFY_TOPIC || 'vB66ozQaRiqhTE9j'
const APTABASE_EVENTS_URL = 'https://aptabase.devaus.eu/api/v0/events'
const APTABASE_APP_KEY = 'A-SH-2414786682'
const NTFY_URL = `https://ntfy.sh/${NOTIFY_TOPIC}`
const GITLAB_RELEASES_URL = 'https://gitlab.com/api/v4/projects/kirbodev%2Felectrolux-to-mqtt/releases'
const GITLAB_TAGS_URL = 'https://gitlab.com/api/v4/projects/kirbodev%2Felectrolux-to-mqtt/repository/tags'

type JsonObject = Record<string, unknown>

async function getJsonArray(url: string): Promise<JsonObject[]> {
  const { data } = await httpRequest({ url, timeoutMs: 10000 })
  if (!Array.isArray(data)) throw new Error(`${url} did not return a JSON array`)
  return data.filter((item): item is JsonObject => typeof item === 'object' && item !== null)
}

// Helper to get latest version from GitLab
async function getLatestVersion(): Promise<string> {
  let releases: Array<{ tag_name: string; released_at: string }>
  try {
    releases = (await getJsonArray(GITLAB_RELEASES_URL)).map((r) => ({
      tag_name: String(r.tag_name),
      released_at: String(r.released_at),
    }))
  } catch {
    // fallback to tags
    releases = (await getJsonArray(GITLAB_TAGS_URL)).map((tag) => ({
      tag_name: String(tag.name),
      released_at: String(
        typeof tag.commit === 'object' && tag.commit !== null && 'created_at' in tag.commit
          ? tag.commit.created_at
          : '',
      ),
    }))
  }
  releases.sort((a, b) => new Date(b.released_at).getTime() - new Date(a.released_at).getTime())
  const latest = releases[0]
  if (!latest) throw new Error('No releases or tags found')
  return latest.tag_name
}

describe.skipIf(!isE2EEnabled)('version-checker', () => {
  it('should fetch latest version from GitLab releases endpoint', async () => {
    const data = await getJsonArray(GITLAB_RELEASES_URL)
    expect(data[0]).toHaveProperty('tag_name')
    expect(data[0]).toHaveProperty('released_at')
  })

  it('should fetch latest version from tags endpoint if releases are empty', async () => {
    const data = await getJsonArray(GITLAB_TAGS_URL)
    expect(data[0]).toHaveProperty('name')
    expect(data[0]).toHaveProperty('commit')
  })

  it('should accept a telemetry event at the Aptabase ingest endpoint', async () => {
    // Uses eventName 'e2e_test' and isDebug:true so the event is filterable
    // out of production dashboards.
    const event = {
      timestamp: new Date().toISOString(),
      sessionId: 'e2e-test-session',
      eventName: 'e2e_test',
      systemProps: {
        appVersion: '0.0.0-e2e',
        osName: 'Linux',
        osVersion: '0.0.0',
        isDebug: true,
        sdkVersion: 'electrolux-to-mqtt@0.0.0-e2e',
      },
      props: {
        channel: 'stable',
        arch: 'arm64',
        appliance_models: 'E2E',
        appliance_count: 0,
      },
    }

    const res = await httpRequest({
      method: 'POST',
      url: APTABASE_EVENTS_URL,
      body: [event],
      timeoutMs: 10000,
      headers: { 'App-Key': APTABASE_APP_KEY },
    })

    expect(res.status).toBe(200)
  })

  it('should send ntfy notification to topic', async () => {
    const message = 'E2E test notification - ignore'
    const res = await httpRequest({
      method: 'POST',
      url: NTFY_URL,
      body: message,
      timeoutMs: 10000,
      headers: { 'Content-Type': 'text/plain' },
    })
    expect([200, 201, 202]).toContain(res.status)
  })

  it('should detect if a newer version is available', async () => {
    const latest = await getLatestVersion()
    // Simulate running an older version
    const running = 'v0.0.1'
    expect(latest).not.toBe(running)
  })
})
