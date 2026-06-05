import axios from 'axios'
import config from './config.js'
import { disposableInterval } from './disposable.js'
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
 * Split a cleaned (no leading 'v') version string into its numeric core and
 * pre-release label. Supports two pre-release forms:
 *   - SemVer dash:  "1.18.5-rc.1"  → { core: "1.18.5", pre: "rc.1" }
 *   - CalVer beta:  "2026.6.0b1"   → { core: "2026.6.0", pre: "b1" }
 *   - Stable:       "2026.6.0"     → { core: "2026.6.0", pre: "" }
 */
function splitVersion(clean: string): { core: string; pre: string } {
  const dashIdx = clean.indexOf('-')
  if (dashIdx !== -1) {
    return { core: clean.slice(0, dashIdx), pre: clean.slice(dashIdx + 1) }
  }
  const m = /^(\d+(?:\.\d+)*)(b\d+)$/.exec(clean)
  if (m?.[1] !== undefined && m[2] !== undefined) {
    return { core: m[1], pre: m[2] }
  }
  return { core: clean, pre: '' }
}

// Pre-release versions (e.g. 1.17.0-rc.7 or 2026.6.0b1) are lower than their
// stable counterpart. Numeric suffix extracted via trailing digits so both
// "rc.10" and "b2" compare correctly (no NaN from split('.').at(-1) on "b1").
function comparePreRelease(pre1: string, pre2: string): number {
  if (pre1 === pre2) return 0
  if (!pre1) return 1
  if (!pre2) return -1
  const preNum1 = Number.parseInt(pre1.replace(/\D/g, '') || '0', 10)
  const preNum2 = Number.parseInt(pre2.replace(/\D/g, '') || '0', 10)
  if (preNum1 < preNum2) return -1
  if (preNum1 > preNum2) return 1
  return 0
}

function compareVersions(v1: string, v2: string): number {
  const clean1 = v1.replace(/^v/, '')
  const clean2 = v2.replace(/^v/, '')

  const { core: core1, pre: pre1 } = splitVersion(clean1)
  const { core: core2, pre: pre2 } = splitVersion(clean2)

  const parts1 = core1.split('.').map((n) => Number.parseInt(n, 10))
  const parts2 = core2.split('.').map((n) => Number.parseInt(n, 10))

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const num1 = parts1[i] ?? 0
    const num2 = parts2[i] ?? 0
    if (num1 < num2) return -1
    if (num1 > num2) return 1
  }

  return comparePreRelease(pre1, pre2)
}

type LatestVersionInfo = {
  version: string
  releasedAt: string
  description?: string
}

// A version is pre-release if it contains '-' (SemVer rc: "1.18.5-rc.1")
// OR ends with a 'b<digits>' suffix preceded by a digit (CalVer beta: "2026.6.0b1").
const isPreRelease = (tagName: string): boolean => tagName.includes('-') || /\db\d+$/.test(tagName)

function pickLatestFromReleases(releases: GitLabRelease[], channel: 'stable' | 'beta'): LatestVersionInfo | null {
  const eligible = channel === 'stable' ? releases.filter((r) => !isPreRelease(r.tag_name)) : releases
  const sorted = [...eligible].sort((a, b) => new Date(b.released_at).getTime() - new Date(a.released_at).getTime())
  const r = sorted[0]
  return r ? { version: r.tag_name, releasedAt: r.released_at, description: r.description || undefined } : null
}

function pickLatestFromTags(tags: GitLabTag[], channel: 'stable' | 'beta'): LatestVersionInfo | null {
  const eligible = channel === 'stable' ? tags.filter((t) => !isPreRelease(t.name)) : tags
  const sorted = [...eligible].sort(
    (a, b) => new Date(b.commit.created_at).getTime() - new Date(a.commit.created_at).getTime(),
  )
  const t = sorted[0]
  return t
    ? { version: t.name, releasedAt: t.commit.created_at, description: t.release?.description || undefined }
    : null
}

/**
 * Fetch the latest version from GitLab releases or tags.
 * @param channel 'stable' skips any release/tag whose tag_name contains '-' (pre-release marker).
 *                'beta' returns the most recently created release/tag regardless.
 */
async function fetchLatestVersion(channel: 'stable' | 'beta'): Promise<LatestVersionInfo | null> {
  try {
    // Try releases first
    const releasesUrl = `${GITLAB_API}/projects/${encodeURIComponent(GITLAB_REPO)}/releases`
    const releasesResponse = await axios.get<GitLabRelease[]>(releasesUrl, {
      timeout: 10000,
      headers: { Accept: 'application/json' },
    })

    if (releasesResponse.data.length > 0) {
      const result = pickLatestFromReleases(releasesResponse.data, channel)
      if (result) return result
    }

    // Fallback to tags if no eligible releases found
    const tagsUrl = `${GITLAB_API}/projects/${encodeURIComponent(GITLAB_REPO)}/repository/tags`
    const tagsResponse = await axios.get<GitLabTag[]>(tagsUrl, {
      timeout: 10000,
      headers: { Accept: 'application/json' },
    })

    if (tagsResponse.data.length > 0) {
      return pickLatestFromTags(tagsResponse.data, channel)
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

async function checkForUpdates(
  currentVersion: string,
  userHash: string,
  updateChannel: 'stable' | 'beta',
  mqtt?: IMqtt,
): Promise<void> {
  // Skip check if running development version
  if (currentVersion === 'development') {
    logger.debug('Running development version, skipping version check')
    publishInfoIfChanged(mqtt, JSON.stringify({ currentVersion, status: 'development' }))
    return
  }

  // Send telemetry (skipped when user has opted out)
  if (config.telemetryEnabled) {
    await sendTelemetry(userHash, currentVersion)
  } else {
    logger.debug('Telemetry disabled, skipping')
  }

  const latest = await fetchLatestVersion(updateChannel)

  if (!latest) {
    logger.debug('Unable to determine latest version')
    return
  }

  const currentTag = currentVersion.startsWith('v') ? currentVersion : `v${currentVersion}`
  const latestVersion = latest.version.startsWith('v') ? latest.version.slice(1) : latest.version
  const versionTag = latest.version.startsWith('v') ? latest.version : `v${latest.version}`

  // Compare versions
  const comparison = compareVersions(currentVersion, latestVersion)

  if (comparison < 0) {
    const releaseAgeMs = Date.now() - new Date(latest.releasedAt).getTime()
    if (releaseAgeMs < 60 * 60 * 1000) {
      logger.debug(`Newer version ${versionTag} found but released recently, skipping notification`)
      return
    }

    logger.info(
      `A newer version of the application available, please check https://gitlab.com/${GITLAB_REPO}/-/releases/${versionTag}`,
    )

    publishInfoIfChanged(
      mqtt,
      JSON.stringify({
        currentVersion: currentTag,
        status: 'update-available',
        latestVersion: versionTag,
        releasedAt: latest.releasedAt,
        ...(latest.description && { description: latest.description }),
      }),
    )

    // Send ntfy notification if configured and we haven't already notified about this version
    const webhookUrl = config.versionCheck?.ntfyWebhookUrl
    if (webhookUrl && hasNotifiedVersion !== latestVersion) {
      await sendNtfyNotification(currentTag, versionTag, webhookUrl)
      hasNotifiedVersion = latestVersion
    }
  } else {
    logger.debug(`Running latest version: ${currentTag}`)
    publishInfoIfChanged(
      mqtt,
      JSON.stringify({
        currentVersion: currentTag,
        status: 'up-to-date',
        releasedAt: latest.releasedAt,
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
  const checkIntervalSeconds = config.versionCheck.checkInterval
  const checkIntervalMs = checkIntervalSeconds * 1000

  // Resolve the update channel once at startup.
  // An explicit config value wins; otherwise derive from the running version.
  const configuredChannel = config.versionCheck.updateChannel
  const updateChannel: 'stable' | 'beta' = configuredChannel ?? (isPreRelease(currentVersion) ? 'beta' : 'stable')
  const channelSource = configuredChannel === undefined ? 'derived' : 'explicit'
  logger.debug(`Update channel: ${updateChannel} (${channelSource} from version ${currentVersion})`)

  logger.debug(`Version check interval set to ${checkIntervalSeconds} seconds`)

  // Check immediately on start
  checkForUpdates(currentVersion, userHash, updateChannel, mqtt).catch((error) => {
    logger.debug('Version check failed:', error)
  })

  // Set up periodic check
  const intervalDisposable = disposableInterval(() => {
    checkForUpdates(currentVersion, userHash, updateChannel, mqtt).catch((error) => {
      logger.debug('Version check failed:', error)
    })
  }, checkIntervalMs)

  // Return cleanup function
  return () => {
    intervalDisposable[Symbol.dispose]()
    logger.debug('Version checker stopped')
  }
}
