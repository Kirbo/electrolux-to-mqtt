import crypto from 'node:crypto'
import fs from 'node:fs'
import type { Request } from 'express'

export function readMachineId(): string | null {
  const paths = ['/etc/machine-id', '/var/lib/dbus/machine-id']
  for (const filePath of paths) {
    try {
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf8').trim()
      }
    } catch {
      // ignore and try next path
    }
  }
  return null
}

export function hashIp(ip: string, salt: string): string {
  return crypto.createHmac('sha256', salt).update(ip).digest('hex')
}

/**
 * Returns the client IP address.
 *
 * Precedence when behindProxy = true (trusted reverse proxy present):
 *   1. req.ip  — Express-resolved value from X-Forwarded-For (standard)
 *   2. X-Real-IP header — legacy proxy header fallback
 *   3. req.socket.remoteAddress — TCP source address
 *   4. 'unknown'
 *
 * When behindProxy = false (direct exposure, default):
 *   Only req.socket.remoteAddress is trusted; all client-supplied headers
 *   are ignored to prevent rate-limit bypass via header rotation.
 */
export function getClientIp(req: Request, behindProxy: boolean): string {
  if (!behindProxy) {
    return req.socket.remoteAddress ?? 'unknown'
  }
  return req.ip ?? req.get('X-Real-IP') ?? req.socket.remoteAddress ?? 'unknown'
}

/**
 * Returns true if the version string is a pre-release (beta or RC).
 * Matches both CalVer beta form (e.g. "2026.6.0b1") and SemVer dash form
 * (e.g. "1.18.5-rc.1"). An optional leading "v" is ignored.
 */
export function isPreReleaseVersion(version: string): boolean {
  return version.includes('-') || /\db\d+$/.test(version)
}

export function validateTelemetryPayload(userHash: unknown, version: unknown, channel?: unknown): string | null {
  if (typeof userHash !== 'string' || typeof version !== 'string') {
    return 'userHash and version must be strings'
  }

  // Exactly 64 lowercase hex characters — matches SHA-256 hex output from the
  // client-side hash in the root project (src/index.ts, Node's digest('hex')).
  if (!/^[a-f0-9]{64}$/.test(userHash)) {
    if (userHash.length !== 64) {
      return 'userHash length is invalid'
    }
    return 'userHash must be hex'
  }

  // Semver-ish: vX.Y.Z or X.Y.Z with optional pre-release suffix.
  // Accepts: -alpha.1 (SemVer dash form) or b1 (CalVer beta form, no dash).
  if (!/^v?\d+\.\d+\.\d+(-[a-z0-9.-]+|b\d+)?$/i.test(version)) {
    if (version.length < 1 || version.length > 32) {
      return 'version length is invalid'
    }
    return 'version contains invalid characters'
  }

  if (version.length < 1 || version.length > 32) {
    return 'version length is invalid'
  }

  // channel is optional — when present it must be exactly 'stable' or 'beta'
  if (channel !== undefined && channel !== 'stable' && channel !== 'beta') {
    return 'channel must be "stable" or "beta"'
  }

  return null
}
