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

export function getClientIp(req: Request): string {
  const xRealIp = req.get('X-Real-IP')
  if (xRealIp) return xRealIp
  return req.ip || 'unknown'
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
