import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultRouteName, extensionlessName, hashPassword, readSession, safeFileName, safeRouteName, signSession, verifyPassword } from './security.js'

test('password hashes verify only the original password', async () => {
  const stored = await hashPassword('a very solid password')
  assert.equal(await verifyPassword('a very solid password', stored), true)
  assert.equal(await verifyPassword('different password', stored), false)
})

test('signed sessions reject tampered payloads', () => {
  const token = signSession('pedro', 'secret')
  const [payload, signature] = token.split('.')
  const tamperedPayload = Buffer.from(JSON.stringify({ username: 'other', expiresAt: Date.now() + 60_000 })).toString('base64url')
  assert.equal(readSession(token, 'secret')?.username, 'pedro')
  assert.equal(readSession(`${tamperedPayload}.${signature}`, 'secret'), null)
  assert.equal(readSession(`${payload}.tampered`, 'secret'), null)
  assert.equal(readSession(token, 'wrong-secret'), null)
})

test('file names are normalized for filesystem and route safety', () => {
  assert.equal(safeFileName('../../My File!.zip'), 'My-File.zip')
  assert.equal(safeFileName('***'), expectUploadPrefix(safeFileName('***')))
  assert.equal(extensionlessName('archive.tar.gz'), 'archive.tar')
  assert.equal(extensionlessName('README'), 'README')
})

test('blank custom routes fall back to the default file route', () => {
  assert.equal(safeRouteName(''), null)
  assert.equal(safeRouteName('   '), null)
  assert.equal(defaultRouteName('ps2-bios-usa.zip', 'direct'), 'ps2-bios-usa.zip')
  assert.equal(defaultRouteName('ps2-bios-usa.zip', 'path'), 'ps2-bios-usa')
  assert.equal(safeRouteName('custom path.zip'), 'custom-path.zip')
})

function expectUploadPrefix(value: string) {
  assert.match(value, /^upload-\d+$/)
  return value
}
