export type AuthStatus = { needsSetup: boolean; authenticated: boolean; username?: string }
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
  url: string
}
export type AccessKey = { key: string; expiresAt: number; url?: string }
export type FileUpdate = { serveMode: ServeMode; visibility: Visibility; storedName: string; routeName: string }

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...options, headers: options?.body instanceof FormData ? options.headers : { 'content-type': 'application/json', ...options?.headers } })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error ?? 'Request failed.')
  }
  return response.status === 204 ? undefined as T : response.json()
}

export const api = {
  authStatus: () => request<AuthStatus>('/api/auth/status'),
  setup: (username: string, password: string) => request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ username, password }) }),
  login: (username: string, password: string) => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  files: () => request<FileEntry[]>('/api/files'),
  upload: (file: File, serveMode: ServeMode, visibility: Visibility, storedName = '', routeName = '') => {
    const body = new FormData()
    body.set('file', file)
    body.set('serveMode', serveMode)
    body.set('visibility', visibility)
    body.set('storedName', storedName)
    body.set('routeName', routeName)
    return request<FileEntry>('/api/files/upload', { method: 'POST', body })
  },
  updateFile: (id: string, input: FileUpdate) =>
    request<FileEntry>(`/api/files/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  removeFile: (id: string) => request(`/api/files/${id}`, { method: 'DELETE' }),
  accessKey: (id: string) => request<AccessKey>(`/api/files/${id}/access-key`, { method: 'POST' }),
  globalAccessKey: () => request<AccessKey>('/api/access-key', { method: 'POST' }),
}
