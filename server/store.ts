import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export type ServeMode = 'direct' | 'path'
export type Visibility = 'public' | 'private'
export type FileEntry = {
  id: string
  originalName: string
  storedName: string
  routeName: string
  mimeType: string
  size: number
  visibility: Visibility
  serveMode: ServeMode
  createdAt: string
}
export type StoreData = {
  user: null | { username: string; passwordHash: string }
  files: FileEntry[]
}

const emptyStore: StoreData = { user: null, files: [] }

export class Store {
  private queue = Promise.resolve()
  constructor(private readonly path: string) {}

  async read(): Promise<StoreData> {
    try {
      const stored = JSON.parse(await readFile(this.path, 'utf8')) as StoreData
      return { user: stored.user ?? null, files: Array.isArray(stored.files) ? stored.files : [] }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(emptyStore)
      throw error
    }
  }

  update(mutator: (data: StoreData) => void | Promise<void>) {
    const operation = this.queue.then(async () => {
      const data = await this.read()
      await mutator(data)
      await mkdir(dirname(this.path), { recursive: true })
      const temporaryPath = `${this.path}.tmp`
      await writeFile(temporaryPath, JSON.stringify(data, null, 2), { mode: 0o600 })
      await rename(temporaryPath, this.path)
      return data
    })
    this.queue = operation.then(() => undefined, () => undefined)
    return operation
  }
}
