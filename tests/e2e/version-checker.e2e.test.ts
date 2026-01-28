import axios from 'axios'
import { describe, expect, it } from 'vitest'

const isE2EEnabled = process.env.E2E === 'true' || process.env.E2E_TEST === 'true'
const NOTIFY_TOPIC = process.env.E2M_NTFY_TOPIC || 'vB66ozQaRiqhTE9j'
const TELEMETRY_URL = 'https://e2m.devaus.eu/telemetry'
const NTFY_URL = `https://ntfy.sh/${NOTIFY_TOPIC}`
const GITLAB_RELEASES_URL = 'https://gitlab.com/api/v4/projects/kirbo%2Felectrolux-to-mqtt/releases'
const GITLAB_TAGS_URL = 'https://gitlab.com/api/v4/projects/kirbo%2Felectrolux-to-mqtt/repository/tags'

// Helper to get latest version from GitLab
type GitLabTag = {
  name: string
  commit: {
    created_at: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

interface Release {
  tag_name: string
  released_at: string
  [key: string]: unknown
}

async function getLatestVersion() {
  let releases = []
  try {
    const { data } = await axios.get(GITLAB_RELEASES_URL, { timeout: 10000 })
    releases = data
  } catch {
    // fallback to tags
    const { data } = await axios.get(GITLAB_TAGS_URL, { timeout: 10000 })
    releases = (data as GitLabTag[]).map((tag: GitLabTag) => ({
      tag_name: tag.name,
      released_at: tag.commit.created_at,
    }))
  }
  if (!releases.length) {
    throw new Error('No releases or tags found')
  }

  ;(releases as Release[]).sort((a, b) => new Date(b.released_at).getTime() - new Date(a.released_at).getTime())
  return releases[0].tag_name
}

describe.skipIf(!isE2EEnabled)('version-checker', () => {
  it('should fetch latest version from GitLab releases endpoint', async () => {
    const { data } = await axios.get(GITLAB_RELEASES_URL, { timeout: 10000 })
    expect(Array.isArray(data)).toBe(true)
    expect(data[0]).toHaveProperty('tag_name')
    expect(data[0]).toHaveProperty('released_at')
  })

  it('should fetch latest version from tags endpoint if releases are empty', async () => {
    const { data } = await axios.get(GITLAB_TAGS_URL, { timeout: 10000 })
    expect(Array.isArray(data)).toBe(true)
    expect(data[0]).toHaveProperty('name')
    expect(data[0]).toHaveProperty('commit')
  })

  it('should send telemetry to backend', async () => {
    const res = await axios.post(
      TELEMETRY_URL,
      { userHash: 'e2e-test-hash', version: 'v1.6.3' },
      { timeout: 10000, headers: { 'Content-Type': 'application/json' } },
    )
    expect(res.status).toBe(200)
    expect(res.data).toHaveProperty('success')
  })

  it('should send ntfy notification to topic', async () => {
    const message = 'E2E test notification - ignore'
    const res = await axios.post(NTFY_URL, message, { timeout: 10000, headers: { 'Content-Type': 'text/plain' } })
    expect([200, 201, 202]).toContain(res.status)
  })

  it('should detect if a newer version is available', async () => {
    const latest = await getLatestVersion()
    // Simulate running an older version
    const running = 'v0.0.1'
    expect(latest).not.toBe(running)
  })
})
