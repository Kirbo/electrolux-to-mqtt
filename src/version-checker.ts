import axios from 'axios'
import config from './config.js'
import createLogger from './logger.js'

const logger = createLogger('version')

const GITLAB_REPO = 'kirbo/electrolux-to-mqtt'
const GITLAB_API = 'https://gitlab.com/api/v4'

// Track whether we've already notified about a newer version in this session
let hasNotifiedVersion: string | null = null

type GitLabTag = {
  name: string
  commit: {
    created_at: string
  }
}

type GitLabRelease = {
  tag_name: string
  released_at: string
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

/**
 * Fetch the latest version from GitLab releases or tags
 */
async function fetchLatestVersion(): Promise<string | null> {
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
      return sortedReleases[0].tag_name
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
      return sortedTags[0].name
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
async function checkForUpdates(currentVersion: string, userHash: string): Promise<void> {
  // Skip check if running development version
  if (currentVersion === 'development') {
    logger.debug('Running development version, skipping version check')
    return
  }

  // Send telemetry
  await sendTelemetry(userHash, currentVersion)

  const latestVersion = await fetchLatestVersion()

  if (!latestVersion) {
    logger.debug('Unable to determine latest version')
    return
  }

  // Compare versions
  const comparison = compareVersions(currentVersion, latestVersion)

  if (comparison < 0) {
    // Current version is older
    const versionTag = latestVersion.startsWith('v') ? latestVersion : `v${latestVersion}`
    logger.info(
      `A newer version of the application available, please check https://gitlab.com/${GITLAB_REPO}/-/releases/${versionTag}`,
    )

    // Send ntfy notification if configured and we haven't already notified about this version
    const webhookUrl = config.versionCheck?.ntfyWebhookUrl
    if (webhookUrl && hasNotifiedVersion !== latestVersion) {
      await sendNtfyNotification(currentVersion, latestVersion, webhookUrl)
      hasNotifiedVersion = latestVersion
    }
  } else {
    logger.debug(`Running latest version: ${currentVersion}`)
  }
}

/**
 * Start the version check interval
 * @returns A function to stop the interval
 */
export function startVersionChecker(currentVersion: string, userHash: string): () => void {
  // Get check interval from config, default to 3600 seconds (1 hour)
  const checkIntervalSeconds = config.versionCheck?.checkInterval ?? 3600
  const checkIntervalMs = checkIntervalSeconds * 1000

  logger.debug(`Version check interval set to ${checkIntervalSeconds} seconds`)

  // Check immediately on start
  checkForUpdates(currentVersion, userHash).catch((error) => {
    logger.debug('Version check failed:', error)
  })

  // Set up periodic check
  const interval = setInterval(() => {
    checkForUpdates(currentVersion, userHash).catch((error) => {
      logger.debug('Version check failed:', error)
    })
  }, checkIntervalMs)

  // Return cleanup function
  return () => {
    clearInterval(interval)
    logger.debug('Version checker stopped')
  }
}
