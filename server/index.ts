import { randomBytes, randomUUID } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import express, { type NextFunction, type Request, type Response } from 'express'
import multer from 'multer'
import { defaultRouteName, hashPassword, readSession, safeFileName, safeRouteName, signSession, verifyPassword } from './security.js'
import { Store, type FileEntry, type ServeMode, type Visibility } from './store.js'

const port = Number(process.env.PORT ?? 2767)
const dataFile = process.env.DATA_FILE ?? resolve('data', 'file-hub.json')
const publicFilePath = resolve(process.env.PUBLIC_FILE_PATH ?? 'files/public')
const privateFilePath = resolve(process.env.PRIVATE_FILE_PATH ?? 'files/private')
const temporaryPath = resolve(process.env.TEMP_FILE_PATH ?? 'data/tmp')
const sessionSecret = process.env.SESSION_SECRET ?? randomBytes(32).toString('hex')
const secureCookies = process.env.NODE_ENV === 'production'
const accessKeys = new Map<string, { scope: 'file'; fileId: string; expiresAt: number } | { scope: 'global'; expiresAt: number }>()
const store = new Store(dataFile)
const app = express()
const upload = multer({ dest: temporaryPath, limits: { fileSize: 1024 * 1024 * 1024 } })

if (!process.env.SESSION_SECRET) console.warn('SESSION_SECRET is unset; sessions will be invalidated on restart.')
app.disable('x-powered-by')
app.set('trust proxy', 1)
app.use(express.json({ limit: '64kb' }))

const attempts = new Map<string, { count: number; resetAt: number }>()
function limitLogin(req: Request, res: Response, next: NextFunction) {
  const key = req.ip ?? 'unknown'
  const now = Date.now()
  const current = attempts.get(key)
  if (!current || current.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + 15 * 60_000 })
    return next()
  }
  if (current.count >= 10) return res.status(429).json({ error: 'Too many attempts. Try again later.' })
  current.count += 1
  next()
}

function cookies(req: Request) {
  return Object.fromEntries((req.headers.cookie ?? '').split(';').filter(Boolean).map(value => value.trim().split('=').map(decodeURIComponent)))
}

function setSession(res: Response, username: string) {
  res.cookie('filehub_session', signSession(username, sessionSecret), {
    httpOnly: true,
    secure: secureCookies,
    sameSite: 'strict',
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  })
}

async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const data = await store.read()
  const session = readSession(cookies(req).filehub_session, sessionSecret)
  if (!data.user || !session || session.username !== data.user.username) return res.status(401).json({ error: 'Authentication required.' })
  next()
}

const route = (handler: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { handler(req, res).catch(next) }

function filePath(file: FileEntry) {
  return join(file.visibility === 'public' ? publicFilePath : privateFilePath, file.storedName)
}

function metadataPath(file: FileEntry) {
  return `${filePath(file)}.filehub.json`
}

function publicUrl(file: FileEntry) {
  return `/${encodeURIComponent(file.routeName)}`
}

async function moveFile(source: string, destination: string) {
  try {
    await rename(source, destination)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
    await copyFile(source, destination)
    await rm(source, { force: true })
  }
}

async function writeFileMetadata(file: FileEntry) {
  const metadata = {
    schemaVersion: 1,
    app: 'file-hub',
    file,
    url: publicUrl(file),
    savedAt: new Date().toISOString(),
  }
  await writeFile(metadataPath(file), JSON.stringify(metadata, null, 2), { mode: 0o600 })
}

async function removeFileMetadata(file: FileEntry) {
  await rm(metadataPath(file), { force: true })
}

function isFileEntry(value: unknown): value is FileEntry {
  const file = value as Partial<FileEntry>
  return Boolean(
    file &&
    typeof file.id === 'string' &&
    typeof file.originalName === 'string' &&
    typeof file.storedName === 'string' &&
    typeof file.routeName === 'string' &&
    typeof file.mimeType === 'string' &&
    typeof file.size === 'number' &&
    (file.visibility === 'public' || file.visibility === 'private') &&
    (file.serveMode === 'direct' || file.serveMode === 'path') &&
    typeof file.createdAt === 'string',
  )
}

async function readMetadataFiles(directory: string, visibility: Visibility) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  const files: FileEntry[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.filehub.json')) continue
    const path = join(directory, entry.name)
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8')) as { file?: unknown }
      if (!isFileEntry(parsed.file) || parsed.file.visibility !== visibility) continue
      if (!existsSync(join(directory, parsed.file.storedName))) continue
      files.push(parsed.file)
    } catch (error) {
      console.warn(`Skipping unreadable FileHub metadata file ${path}:`, error)
    }
  }
  return files
}

async function restoreFilesFromMetadata() {
  const sidecarFiles = [
    ...await readMetadataFiles(publicFilePath, 'public'),
    ...await readMetadataFiles(privateFilePath, 'private'),
  ]
  if (!sidecarFiles.length) return
  await store.update(data => {
    const knownIds = new Set(data.files.map(file => file.id))
    const knownRoutes = new Set(data.files.map(file => file.routeName))
    for (const file of sidecarFiles) {
      if (knownIds.has(file.id) || knownRoutes.has(file.routeName)) continue
      data.files.push(file)
      knownIds.add(file.id)
      knownRoutes.add(file.routeName)
    }
    data.files.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  })
}

function pruneKeys() {
  const now = Date.now()
  for (const [key, value] of accessKeys) if (value.expiresAt <= now) accessKeys.delete(key)
}

function hasAccessKey(file: FileEntry, key: unknown) {
  pruneKeys()
  if (file.visibility === 'public') return true
  const access = typeof key === 'string' ? accessKeys.get(key) : null
  return Boolean(access && access.expiresAt > Date.now() && (access.scope === 'global' || access.fileId === file.id))
}

async function uniqueStoredName(fileName: string, visibility: Visibility, excludeId?: string) {
  const directory = visibility === 'public' ? publicFilePath : privateFilePath
  const parsedExtension = extname(fileName)
  const base = basename(fileName, parsedExtension)
  let candidate = fileName
  let counter = 1
  const data = await store.read()
  const sameFile = excludeId ? data.files.find(file => file.id === excludeId) : null
  while (existsSync(join(directory, candidate)) && !(candidate === sameFile?.storedName && sameFile.visibility === visibility)) {
    candidate = `${base}-${counter}${parsedExtension}`
    counter += 1
  }
  return candidate
}

async function uniqueRouteName(routeName: string, excludeId?: string) {
  if (/^(api|assets)$/i.test(routeName)) throw Object.assign(new Error(`The link /${routeName} is reserved.`), { status: 400 })
  const data = await store.read()
  if (!data.files.some(file => file.id !== excludeId && file.routeName === routeName)) return routeName
  throw Object.assign(new Error(`The link /${routeName} is already in use.`), { status: 409 })
}

app.get('/api/auth/status', route(async (req, res) => {
  const data = await store.read()
  const session = readSession(cookies(req).filehub_session, sessionSecret)
  res.json({ needsSetup: !data.user, authenticated: Boolean(data.user && session?.username === data.user.username), username: session?.username })
}))

app.post('/api/auth/setup', route(async (req, res) => {
  const username = String(req.body.username ?? '').trim()
  const password = String(req.body.password ?? '')
  if (username.length < 3 || username.length > 64) return res.status(400).json({ error: 'Username must be 3 to 64 characters.' })
  if (password.length < 10 || password.length > 256) return res.status(400).json({ error: 'Password must be at least 10 characters.' })
  await store.update(async data => {
    if (data.user) throw Object.assign(new Error('Setup is already complete.'), { status: 409 })
    data.user = { username, passwordHash: await hashPassword(password) }
  })
  setSession(res, username)
  res.status(201).json({ username })
}))

app.post('/api/auth/login', limitLogin, route(async (req, res) => {
  const data = await store.read()
  const username = String(req.body.username ?? '')
  const password = String(req.body.password ?? '')
  if (!data.user) return res.status(409).json({ error: 'Complete setup first.' })
  if (username !== data.user.username || !(await verifyPassword(password, data.user.passwordHash))) return res.status(401).json({ error: 'Invalid username or password.' })
  attempts.delete(req.ip ?? 'unknown')
  setSession(res, username)
  res.json({ username })
}))

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie('filehub_session', { path: '/' })
  res.status(204).end()
})

app.get('/api/files', requireAuth, route(async (_req, res) => {
  const data = await store.read()
  res.json(data.files.map(file => ({ ...file, url: publicUrl(file) })))
}))

app.post('/api/files/upload', requireAuth, upload.single('file'), route(async (req, res) => {
  const uploaded = req.file
  if (!uploaded) return res.status(400).json({ error: 'Choose a file to upload.' })
  const visibility = req.body.visibility === 'private' ? 'private' : 'public'
  const serveMode = req.body.serveMode === 'path' ? 'path' : 'direct'
  const originalName = safeFileName(uploaded.originalname)
  const requestedName = safeFileName(String(req.body.storedName ?? '').trim() || uploaded.originalname)
  await mkdir(visibility === 'public' ? publicFilePath : privateFilePath, { recursive: true })
  const storedName = await uniqueStoredName(requestedName, visibility)
  const requestedRoute = safeRouteName(String(req.body.routeName ?? '').trim())
  const routeName = await uniqueRouteName(requestedRoute ?? defaultRouteName(storedName, serveMode))
  const destination = join(visibility === 'public' ? publicFilePath : privateFilePath, storedName)
  await moveFile(uploaded.path, destination)
  const file: FileEntry = {
    id: randomUUID(),
    originalName: uploaded.originalname,
    storedName,
    routeName,
    mimeType: uploaded.mimetype || 'application/octet-stream',
    size: uploaded.size,
    visibility,
    serveMode,
    createdAt: new Date().toISOString(),
  }
  await writeFileMetadata(file)
  await store.update(data => { data.files.unshift(file) })
  res.status(201).json({ ...file, url: publicUrl(file) })
}))

app.patch('/api/files/:id', requireAuth, route(async (req, res) => {
  const visibility = req.body.visibility === 'private' ? 'private' : req.body.visibility === 'public' ? 'public' : null
  const serveMode = req.body.serveMode === 'path' ? 'path' : req.body.serveMode === 'direct' ? 'direct' : null
  if (!visibility || !serveMode) return res.status(400).json({ error: 'Choose how the file should be served.' })
  const requestedName = String(req.body.storedName ?? '').trim()
  const requestedRoute = String(req.body.routeName ?? '').trim()
  let updated: FileEntry | null = null
  let previous: FileEntry | null = null
  await store.update(async data => {
    const file = data.files.find(item => item.id === req.params.id)
    if (!file) throw Object.assign(new Error('File not found.'), { status: 404 })
    previous = { ...file }
    const nextStoredName = await uniqueStoredName(requestedName ? safeFileName(requestedName) : safeFileName(file.originalName), visibility, file.id)
    const nextRouteValue = requestedRoute ? safeRouteName(requestedRoute) : defaultRouteName(nextStoredName, serveMode)
    if (!nextRouteValue) throw Object.assign(new Error('Enter a valid path.'), { status: 400 })
    const nextRouteName = await uniqueRouteName(nextRouteValue, file.id)
    if (file.visibility !== visibility || file.storedName !== nextStoredName) {
      await mkdir(visibility === 'public' ? publicFilePath : privateFilePath, { recursive: true })
      await moveFile(filePath(file), join(visibility === 'public' ? publicFilePath : privateFilePath, nextStoredName))
    }
    file.storedName = nextStoredName
    file.visibility = visibility
    file.serveMode = serveMode
    file.routeName = nextRouteName
    updated = { ...file }
  })
  if (previous) await removeFileMetadata(previous)
  await writeFileMetadata(updated!)
  res.json({ ...updated!, url: publicUrl(updated!) })
}))

app.delete('/api/files/:id', requireAuth, route(async (req, res) => {
  let removed: FileEntry | null = null
  await store.update(data => {
    const index = data.files.findIndex(file => file.id === req.params.id)
    if (index >= 0) removed = data.files.splice(index, 1)[0]
  })
  const removedFile = removed as FileEntry | null
  if (!removedFile) return res.status(404).json({ error: 'File not found.' })
  await rm(filePath(removedFile), { force: true })
  await removeFileMetadata(removedFile)
  for (const [key, value] of accessKeys) if (value.scope === 'file' && value.fileId === removedFile.id) accessKeys.delete(key)
  res.status(204).end()
}))

app.post('/api/files/:id/access-key', requireAuth, route(async (req, res) => {
  const file = (await store.read()).files.find(item => item.id === req.params.id)
  if (!file) return res.status(404).json({ error: 'File not found.' })
  const key = randomBytes(18).toString('base64url')
  const expiresAt = Date.now() + 5 * 60_000
  accessKeys.set(key, { scope: 'file', fileId: file.id, expiresAt })
  res.json({ key, expiresAt, url: `${publicUrl(file)}?key=${encodeURIComponent(key)}` })
}))

app.post('/api/access-key', requireAuth, route(async (_req, res) => {
  const key = randomBytes(18).toString('base64url')
  const expiresAt = Date.now() + 5 * 60_000
  accessKeys.set(key, { scope: 'global', expiresAt })
  res.json({ key, expiresAt })
}))

const dist = resolve('dist')
if (existsSync(dist)) app.use(express.static(dist))

app.get('/:routeName', route(async (req, res) => {
  const data = await store.read()
  const file = data.files.find(item => item.routeName === req.params.routeName)
  if (!file) {
    if (existsSync(dist)) return res.sendFile(resolve(dist, 'index.html'))
    return res.status(404).json({ error: 'File not found.' })
  }
  if (!hasAccessKey(file, req.query.key)) return res.status(403).json({ error: 'A valid temporary access key is required.' })
  const location = filePath(file)
  const info = await stat(location).catch(() => null)
  if (!info?.isFile()) return res.status(404).json({ error: 'File content is missing.' })
  res.setHeader('content-type', file.mimeType)
  res.setHeader('content-length', info.size)
  res.setHeader('content-disposition', `inline; filename="${file.storedName.replace(/"/g, '')}"`)
  createReadStream(location).pipe(res)
}))

if (existsSync(dist)) app.get('*splat', (_req, res) => res.sendFile(resolve(dist, 'index.html')))
app.use(async (error: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error)
  res.status(error.status ?? 500).json({ error: error.status ? error.message : 'Something went wrong.' })
})

await Promise.all([mkdir(publicFilePath, { recursive: true }), mkdir(privateFilePath, { recursive: true }), mkdir(temporaryPath, { recursive: true })])
await restoreFilesFromMetadata()
app.listen(port, '0.0.0.0', () => console.log(`FileHub listening on ${port}`))
