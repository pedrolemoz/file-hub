import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex')
  const hash = (await scrypt(password, salt, 64)) as Buffer
  return `scrypt:${salt}:${hash.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string) {
  const [algorithm, salt, expectedHex] = stored.split(':')
  if (algorithm !== 'scrypt' || !salt || !expectedHex) return false
  const expected = Buffer.from(expectedHex, 'hex')
  const actual = (await scrypt(password, salt, expected.length)) as Buffer
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export function signSession(username: string, secret: string, maxAgeSeconds = 60 * 60 * 24 * 30) {
  const payload = Buffer.from(JSON.stringify({ username, expiresAt: Date.now() + maxAgeSeconds * 1000 })).toString('base64url')
  const signature = createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

export function readSession(token: string | undefined, secret: string) {
  if (!token) return null
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return null
  const expected = createHmac('sha256', secret).update(payload).digest()
  const actual = Buffer.from(signature, 'base64url')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { username: string; expiresAt: number }
    return parsed.expiresAt > Date.now() ? parsed : null
  } catch {
    return null
  }
}

export function safeFileName(value: string) {
  const normalized = value.normalize('NFKD').replace(/[^\w.\- ]+/g, '').trim().replace(/\s+/g, '-')
  const clean = normalized.replace(/^\.+/, '').slice(0, 180)
  return clean || `upload-${Date.now()}`
}

export function extensionlessName(fileName: string) {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(0, dot) : fileName
}

export function safeRouteName(value: string) {
  if (!value.trim()) return null
  const route = safeFileName(value).replace(/^api$/i, '').replace(/^assets$/i, '').trim()
  return route || null
}

export function defaultRouteName(fileName: string, serveMode: 'direct' | 'path') {
  return serveMode === 'direct' ? fileName : extensionlessName(fileName)
}
