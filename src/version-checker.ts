import axios from 'axios'
import config from './config.js'
import createLogger from './logger.js'
import type { IMqtt } from './mqtt.js'

const logger = createLogger('version')

const GITLAB_REPO = 'kirbo/electrolux-to-mqtt'
const GITLAB_API = 'https://gitlab.com/api/v4'

// Track whether we've already notified about a newer version in this session
let hasNotifiedVersion: string | null = null

// Track last published MQTT info payload to avoid redundant publishes
let lastPublishedInfo: string | null = null

type GitLabCommit = {
  id: string
  short_id: string
  created_at: string
  title: string
  author_name: string
  web_url: string
}

type GitLabTag = {
  name: string
  message: string
  target: string
  commit: GitLabCommit
  release: {
    tag_name: string
    description: string
  } | null
  protected: boolean
  created_at: string | null
}

type GitLabRelease = {
  name: string
  tag_name: string
  description: string
  created_at: string
  released_at: string
  upcoming_release: boolean
  author: {
    id: number
    username: string
    name: string
    state: string
    avatar_url: string
    web_url: string
  }
  commit: GitLabCommit
  commit_path: string
  tag_path: string
  assets: {
    count: number
    sources: Array<{ format: string; url: string }>
    links: Array<unknown>
  }
  _links: {
    self: string
    closed_issues_url: string
    closed_merge_requests_url: string
    merged_merge_requests_url: string
    opened_issues_url: string
    opened_merge_requests_url: string
  }
}

/**
 * Compare two semantic version strings
 * Returns: -1 if v1 < v2, 0 if v1 === v2, 1 if v1 > v2
 */
function compareVersions(v1: string, v2: string): number {
  // Remove 'v' prefix if present
  const clean1 = v1.replace(/^v/, '')
  const clean2 = v2.replace(/^v/, '')

  // Split into parts and convert to numbers
  const parts1 = clean1.split('.').map((n) => Number.parseInt(n, 10))
  const parts2 = clean2.split('.').map((n) => Number.parseInt(n, 10))

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const num1 = parts1[i] || 0
    const num2 = parts2[i] || 0

    if (num1 < num2) return -1
    if (num1 > num2) return 1
  }

  return 0
}

type LatestVersionInfo = {
  version: string
  releasedAt: string
  description?: string
}

/**
 * Fetch the latest version from GitLab releases or tags
 */
async function fetchLatestVersion(): Promise<LatestVersionInfo | null> {
  try {
    // Try releases first
    const releasesUrl = `${GITLAB_API}/projects/${encodeURIComponent(GITLAB_REPO)}/releases`
    const releasesResponse = await axios.get<GitLabRelease[]>(releasesUrl, {
      timeout: 10000,
      headers: {
        Accept: 'application/json',
      },
    })

    if (releasesResponse.data && releasesResponse.data.length > 0) {
      // Sort by released_at date (descending) to get the latest
      const sortedReleases = [...releasesResponse.data].sort((a, b) => {
        return new Date(b.released_at).getTime() - new Date(a.released_at).getTime()
      })
      const r = sortedReleases[0]
      return { version: r.tag_name, releasedAt: r.released_at, description: r.description || undefined }
    }

    // Fallback to tags if no releases found
    const tagsUrl = `${GITLAB_API}/projects/${encodeURIComponent(GITLAB_REPO)}/repository/tags`
    const tagsResponse = await axios.get<GitLabTag[]>(tagsUrl, {
      timeout: 10000,
      headers: {
        Accept: 'application/json',
      },
    })

    if (tagsResponse.data && tagsResponse.data.length > 0) {
      // Sort by commit created_at date (descending) to get the latest
      const sortedTags = [...tagsResponse.data].sort((a, b) => {
        return new Date(b.commit.created_at).getTime() - new Date(a.commit.created_at).getTime()
      })
      const t = sortedTags[0]
      return { version: t.name, releasedAt: t.commit.created_at, description: t.release?.description || undefined }
    }

    return null
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.debug(`Failed to fetch version info: ${error.message}`)
    } else {
      logger.debug('Failed to fetch version info:', error)
    }
    return null
  }
}

/**
 * Send notification to ntfy.sh webhook
 */
async function sendNtfyNotification(currentVersion: string, latestVersion: string, webhookUrl: string): Promise<void> {
  try {
    const message = `A newer version of Electrolux-to-MQTT is found. Latest version ${latestVersion}, you're running version ${currentVersion}`

    await axios.post(webhookUrl, message, {
      timeout: 10000,
      headers: {
        'Content-Type': 'text/plain',
      },
    })

    logger.debug(`Sent ntfy notification for version ${latestVersion}`)
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.debug(`Failed to send ntfy notification: ${error.message}`)
    } else {
      logger.debug('Failed to send ntfy notification:', error)
    }
  }
}

/**
 * Send telemetry data to backend
 */
async function sendTelemetry(userHash: string, version: string): Promise<void> {
  try {
    const telemetryUrl = 'https://e2m.devaus.eu/telemetry'

    await axios.post(
      telemetryUrl,
      { userHash, version },
      {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )

    logger.debug('Telemetry sent successfully')
  } catch (error) {
    // Silently fail - telemetry is not critical
    logger.debug('Failed to send telemetry:', error instanceof Error ? error.message : error)
  }
}

/**
 * Check if a newer version is available and log if found
 */
function publishInfoIfChanged(mqtt: IMqtt | undefined, message: string): void {
  if (!mqtt || message === lastPublishedInfo) return
  lastPublishedInfo = message
  mqtt.publishInfo(message)
}

async function checkForUpdates(currentVersion: string, userHash: string, mqtt?: IMqtt): Promise<void> {
  // Skip check if running development version
  if (currentVersion === 'development') {
    logger.debug('Running development version, skipping version check')
    publishInfoIfChanged(mqtt, JSON.stringify({ currentVersion, status: 'development' }))
    return
  }

  // Send telemetry
  await sendTelemetry(userHash, currentVersion)

  const latest = await fetchLatestVersion()

  if (!latest) {
    logger.debug('Unable to determine latest version')
    return
  }

  // Compare versions
  const comparison = compareVersions(currentVersion, latest.version)

  if (comparison < 0) {
    // Current version is older
    const versionTag = latest.version.startsWith('v') ? latest.version : `v${latest.version}`
    logger.info(
      `A newer version of the application available, please check https://gitlab.com/${GITLAB_REPO}/-/releases/${versionTag}`,
    )

    publishInfoIfChanged(
      mqtt,
      JSON.stringify({
        currentVersion,
        status: 'update-available',
        latestVersion: latest.version,
        latestReleasedAt: latest.releasedAt,
        ...(latest.description && { description: latest.description }),
      }),
    )

    // Send ntfy notification if configured and we haven't already notified about this version
    const webhookUrl = config.versionCheck?.ntfyWebhookUrl
    if (webhookUrl && hasNotifiedVersion !== latest.version) {
      await sendNtfyNotification(currentVersion, latest.version, webhookUrl)
      hasNotifiedVersion = latest.version
    }
  } else {
    logger.debug(`Running latest version: ${currentVersion}`)
    publishInfoIfChanged(
      mqtt,
      JSON.stringify({
        currentVersion,
        status: 'up-to-date',
        releasedAt: latest.releasedAt,
        ...(latest.description && { description: latest.description }),
      }),
    )
  }
}

/**
 * Start the version check interval
 * @returns A function to stop the interval
 */
export function startVersionChecker(currentVersion: string, userHash: string, mqtt?: IMqtt): () => void {
  // Get check interval from config, default to 3600 seconds (1 hour)
  const checkIntervalSeconds = config.versionCheck?.checkInterval ?? 3600
  const checkIntervalMs = checkIntervalSeconds * 1000

  logger.debug(`Version check interval set to ${checkIntervalSeconds} seconds`)

  // Check immediately on start
  checkForUpdates(currentVersion, userHash, mqtt).catch((error) => {
    logger.debug('Version check failed:', error)
  })

  // Set up periodic check
  const interval = setInterval(() => {
    checkForUpdates(currentVersion, userHash, mqtt).catch((error) => {
      logger.debug('Version check failed:', error)
    })
  }, checkIntervalMs)

  // Return cleanup function
  return () => {
    clearInterval(interval)
    logger.debug('Version checker stopped')
  }
}
