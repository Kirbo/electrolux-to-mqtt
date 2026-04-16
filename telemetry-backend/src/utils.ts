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

export function validateTelemetryPayload(userHash: unknown, version: unknown): string | null {
  if (typeof userHash !== 'string' || typeof version !== 'string') {
    return 'userHash and version must be strings'
  }

  if (userHash.length < 32 || userHash.length > 128) {
    return 'userHash length is invalid'
  }

  if (!/^[a-f0-9]+$/i.test(userHash)) {
    return 'userHash must be hex'
  }

  if (version.length < 1 || version.length > 32) {
    return 'version length is invalid'
  }

  if (!/^[a-z0-9._-]+$/i.test(version)) {
    return 'version contains invalid characters'
  }

  return null
}
