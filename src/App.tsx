import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react'
import { ArrowRight, Check, Copy, Download, Eye, FileArchive, FileText, FolderUp, KeyRound, Link2, Loader2, Lock, LogOut, Pencil, Plus, RefreshCw, Server, ShieldCheck, Trash2, Upload, X } from 'lucide-react'
import { api, type AccessKey, type AuthStatus, type FileEntry, type ServeMode, type Visibility } from './api'

function AuthScreen({ setup, onDone }: { setup: boolean; onDone: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (setup && password !== confirm) return setError('Passwords do not match.')
    setBusy(true)
    try {
      setup ? await api.setup(username, password) : await api.login(username, password)
      onDone()
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return <main className="auth-page">
    <div className="auth-grid" aria-hidden="true" />
    <section className="auth-intro">
      <Brand />
      <p className="eyebrow">Local file gateway</p>
      <h1>FileHub<br /><span>for private shares.</span></h1>
      <p>Serve local files through simple public links or short-lived private keys, with one focused account protecting the dashboard.</p>
      <div className="feature-line"><ShieldCheck size={18} /><span>No password recovery path by design</span></div>
    </section>
    <section className="auth-panel">
      <div className="form-card">
        <span className="step">{setup ? 'INITIAL SETUP' : 'WELCOME BACK'}</span>
        <h2>{setup ? 'Secure FileHub' : 'Sign in to FileHub'}</h2>
        <p>{setup ? 'Create the only account for this installation. Keep the password somewhere safe.' : 'Enter your credentials to manage files and links.'}</p>
        <form onSubmit={submit}>
          <label>Username<input autoFocus autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} placeholder="Your username" minLength={3} required /></label>
          <label>Password<input type="password" autoComplete={setup ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} placeholder={setup ? 'At least 10 characters' : 'Your password'} minLength={setup ? 10 : undefined} required /></label>
          {setup && <label>Confirm password<input type="password" autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} placeholder="Repeat your password" required /></label>}
          {error && <p className="error" role="alert">{error}</p>}
          <button className="primary wide" disabled={busy}>{busy ? 'Please wait...' : setup ? 'Create account' : 'Sign in'}<ArrowRight size={18} /></button>
        </form>
      </div>
    </section>
  </main>
}

function Brand() {
  return <div className="brand"><span className="brand-mark"><Server size={18} /></span><span>FileHub</span></div>
}

function formatSize(size: number) {
  if (size < 1024) return `${size} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = size / 1024
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[index]}`
}

function UploadPanel({ onUploaded }: { onUploaded: (file: FileEntry) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [storedName, setStoredName] = useState('')
  const [routeName, setRouteName] = useState('')
  const [serveMode, setServeMode] = useState<ServeMode>('direct')
  const [visibility, setVisibility] = useState<Visibility>('public')
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const sampleName = storedName.trim() || pendingFile?.name || 'filename.extension'
  const defaultPathName = sampleName.includes('.') ? sampleName.slice(0, sampleName.lastIndexOf('.')) : sampleName
  const previewPath = routeName.trim() || (serveMode === 'direct' ? sampleName : defaultPathName)
  function pick(fileList: FileList | null) {
    const file = fileList?.item(0)
    if (file) {
      setPendingFile(file)
      setError('')
    }
  }
  function drop(event: DragEvent) {
    event.preventDefault()
    setDragging(false)
    pick(event.dataTransfer.files)
  }
  async function upload() {
    if (!pendingFile) return inputRef.current?.click()
    setBusy(true)
    setError('')
    try {
      const uploaded = await api.upload(pendingFile, serveMode, visibility, storedName, routeName)
      setPendingFile(null)
      setStoredName('')
      setRouteName('')
      onUploaded(uploaded)
      if (inputRef.current) inputRef.current.value = ''
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return <section className={`upload-panel ${dragging ? 'dragging' : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={drop}>
    <input ref={inputRef} type="file" hidden onChange={event => pick(event.target.files)} />
    <div className="upload-copy">
      <span className="upload-icon"><FolderUp size={28} /></span>
      <div>
        <p className="eyebrow">UPLOAD</p>
        <h2>{pendingFile ? pendingFile.name : 'Drop a file here'}</h2>
        <p>{pendingFile ? `${formatSize(pendingFile.size)} ready to publish` : 'Choose a file or drag it onto this area. Browsers upload folders as their contained files.'}</p>
      </div>
    </div>
    <div className="upload-controls">
      <div className="segmented" role="group" aria-label="Serve mode">
        <button type="button" className={serveMode === 'direct' ? 'active' : ''} onClick={() => setServeMode('direct')}><FileText size={16} />Direct</button>
        <button type="button" className={serveMode === 'path' ? 'active' : ''} onClick={() => setServeMode('path')}><Link2 size={16} />Path</button>
      </div>
      <label className="toggle-row"><span><strong>Private file</strong><small>Require a 5-minute key in the query string.</small></span><input type="checkbox" checked={visibility === 'private'} onChange={event => setVisibility(event.target.checked ? 'private' : 'public')} /><i aria-hidden="true" /></label>
      <div className="field-grid">
        <label>Filename<input value={storedName} onChange={event => setStoredName(event.target.value)} placeholder={pendingFile?.name || 'Use original filename'} /></label>
        <label>Path<input value={routeName} onChange={event => setRouteName(event.target.value)} placeholder={`Default: ${serveMode === 'direct' ? sampleName : defaultPathName}`} /></label>
      </div>
      <div className="link-preview">localhost:2767/{previewPath}</div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="upload-actions">
        <button className="secondary" type="button" onClick={() => inputRef.current?.click()}><Upload size={17} />Choose file</button>
        <button className="primary" type="button" disabled={busy} onClick={upload}>{busy ? <Loader2 className="spin" size={17} /> : <Plus size={17} />}{pendingFile ? 'Upload file' : 'Start upload'}</button>
      </div>
    </div>
  </section>
}

function FileDialog({ file, onClose, onSaved }: { file: FileEntry; onClose: () => void; onSaved: (file: FileEntry) => void }) {
  const [serveMode, setServeMode] = useState<ServeMode>(file.serveMode)
  const [visibility, setVisibility] = useState<Visibility>(file.visibility)
  const [storedName, setStoredName] = useState(file.storedName)
  const [routeName, setRouteName] = useState(file.routeName)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      onSaved(await api.updateFile(file.id, { serveMode, visibility, storedName, routeName }))
    } catch (reason) {
      setError((reason as Error).message)
      setBusy(false)
    }
  }
  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="file-dialog-title">
      <header><div><span className="step">SERVING RULES</span><h2 id="file-dialog-title">Edit file link</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={20} /></button></header>
      <form onSubmit={submit}>
        <label>Filename<input value={storedName} onChange={event => setStoredName(event.target.value)} placeholder={file.originalName} /></label>
        <label>Path<input value={routeName} onChange={event => setRouteName(event.target.value)} placeholder={serveMode === 'direct' ? storedName : storedName.includes('.') ? storedName.slice(0, storedName.lastIndexOf('.')) : storedName} /></label>
        <div className="segmented" role="group" aria-label="Serve mode">
          <button type="button" className={serveMode === 'direct' ? 'active' : ''} onClick={() => setServeMode('direct')}><FileText size={16} />Direct link</button>
          <button type="button" className={serveMode === 'path' ? 'active' : ''} onClick={() => setServeMode('path')}><Link2 size={16} />Path link</button>
        </div>
        <label className="toggle-row"><span><strong>Private file</strong><small>Require a temporary access key.</small></span><input type="checkbox" checked={visibility === 'private'} onChange={event => setVisibility(event.target.checked ? 'private' : 'public')} /><i aria-hidden="true" /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <footer><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>{busy ? <Loader2 className="spin" size={17} /> : <Check size={17} />}Save changes</button></footer>
      </form>
    </section>
  </div>
}

function FileCard({ file, access, globalAccess, onEdit, onDelete, onKey }: { file: FileEntry; access?: AccessKey; globalAccess?: AccessKey | null; onEdit: () => void; onDelete: () => void; onKey: () => void }) {
  const activeAccess = access ?? (file.visibility === 'private' && globalAccess ? { ...globalAccess, url: `${file.url}?key=${encodeURIComponent(globalAccess.key)}` } : undefined)
  const href = activeAccess?.url ?? file.url
  return <article className="file-card">
    <div className="card-top">
      <span className="file-icon">{file.mimeType.includes('zip') ? <FileArchive size={24} /> : <FileText size={24} />}</span>
      <span className={`status ${file.visibility === 'public' ? 'is-public' : ''}`}><i />{file.visibility}</span>
      <button className="card-icon-button" onClick={onEdit} aria-label={`Edit ${file.storedName}`}><Pencil size={16} /></button>
      <button className="delete-button" onClick={onDelete} aria-label={`Remove ${file.storedName}`}><Trash2 size={16} /></button>
    </div>
    <h3>{file.storedName}</h3>
    <dl>
      <div><dt>LINK</dt><dd>{file.url}</dd></div>
      <div><dt>TYPE</dt><dd>{file.serveMode === 'direct' ? 'Direct link' : 'Path link'}</dd></div>
      <div><dt>SIZE</dt><dd>{formatSize(file.size)}</dd></div>
    </dl>
    {activeAccess && <p className="key-line"><KeyRound size={14} /><span>Key expires at {new Date(activeAccess.expiresAt).toLocaleTimeString()}</span></p>}
    <div className="card-footer">
      <a className="secondary compact" href={href} target="_blank" rel="noreferrer"><Eye size={16} />Open</a>
      <button className="secondary compact" onClick={() => navigator.clipboard.writeText(`${location.origin}${href}`)}><Copy size={16} />Copy</button>
      {file.visibility === 'private' && <button className="primary compact" onClick={onKey}><KeyRound size={16} />Key</button>}
    </div>
  </article>
}

function Dashboard({ status, onLogout }: { status: AuthStatus; onLogout: () => void }) {
  const [files, setFiles] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<FileEntry | null>(null)
  const [keys, setKeys] = useState<Record<string, AccessKey>>({})
  const [globalKey, setGlobalKey] = useState<AccessKey | null>(null)
  const totalSize = useMemo(() => files.reduce((sum, file) => sum + file.size, 0), [files])
  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      setFiles(await api.files())
      setError('')
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  async function remove(file: FileEntry) {
    if (!window.confirm(`Remove ${file.storedName} from FileHub?`)) return
    try {
      await api.removeFile(file.id)
      setFiles(current => current.filter(item => item.id !== file.id))
    } catch (reason) {
      setError((reason as Error).message)
    }
  }
  async function generateKey(file: FileEntry) {
    try {
      const key = await api.accessKey(file.id)
      setKeys(current => ({ ...current, [file.id]: key }))
      if (key.url) await navigator.clipboard.writeText(`${location.origin}${key.url}`)
    } catch (reason) {
      setError((reason as Error).message)
    }
  }
  async function generateGlobalKey() {
    try {
      const key = await api.globalAccessKey()
      setGlobalKey(key)
      await navigator.clipboard.writeText(key.key)
    } catch (reason) {
      setError((reason as Error).message)
    }
  }
  return <div className="dashboard">
    <header className="topbar"><Brand /><div className="header-meta"><span className="secure"><ShieldCheck size={15} />Secured</span><span>{status.username}</span><button className="icon-button" onClick={onLogout} aria-label="Log out"><LogOut size={18} /></button></div></header>
    <main className="dashboard-main">
      <section className="dashboard-heading"><div><p className="eyebrow">FILE SERVER</p><h1>Your files</h1><p>Upload files, choose their route style, and decide whether each link is public or key-protected.</p></div><div className="heading-actions"><button className="secondary" onClick={refresh} disabled={refreshing}><RefreshCw className={refreshing ? 'spin' : ''} size={17} />Refresh</button><button className="primary" onClick={generateGlobalKey}><KeyRound size={17} />Global key</button></div></section>
      <section className="summary"><div><FileText size={18} /><span>Files</span><strong>{files.length}</strong></div><div><Lock size={18} /><span>Private</span><strong>{files.filter(file => file.visibility === 'private').length}</strong></div><div><Download size={18} /><span>Stored</span><strong>{formatSize(totalSize)}</strong></div><p><KeyRound size={13} />Temporary keys last 5 minutes</p></section>
      {globalKey && <section className="global-key"><div><KeyRound size={18} /><span>Global private key expires at {new Date(globalKey.expiresAt).toLocaleTimeString()}</span><code>?key={globalKey.key}</code></div><button className="secondary compact" onClick={() => navigator.clipboard.writeText(`?key=${globalKey.key}`)}><Copy size={15} />Copy query</button></section>}
      <UploadPanel onUploaded={file => setFiles(current => [file, ...current])} />
      {error && <p className="page-error" role="alert">{error}<button onClick={() => setError('')}><X size={15} /></button></p>}
      {loading ? <div className="loading"><Loader2 className="spin" /><p>Loading files...</p></div> : files.length === 0 ? <section className="empty"><span><Upload size={35} /></span><h2>No files yet</h2><p>Upload the first file to publish a local route from FileHub.</p></section> : <section className="file-grid">{files.map(file => <FileCard key={file.id} file={file} access={keys[file.id]} globalAccess={globalKey} onEdit={() => setEditing(file)} onDelete={() => remove(file)} onKey={() => generateKey(file)} />)}</section>}
    </main>
    <footer className="app-footer"><Brand /><span>Local file serving with private links</span></footer>
    {editing && <FileDialog file={editing} onClose={() => setEditing(null)} onSaved={saved => { setFiles(current => current.map(file => file.id === saved.id ? saved : file)); setEditing(null) }} />}
  </div>
}

export default function App() {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(() => api.authStatus().then(setStatus).catch(reason => setError((reason as Error).message)), [])
  useEffect(() => { void load() }, [load])
  if (error) return <main className="fatal"><Server size={32} /><h1>FileHub is unavailable</h1><p>{error}</p><button className="primary" onClick={() => location.reload()}>Try again</button></main>
  if (!status) return <main className="splash"><span className="brand-mark"><Server /></span><Loader2 className="spin" /></main>
  if (!status.authenticated) return <AuthScreen setup={status.needsSetup} onDone={load} />
  return <Dashboard status={status} onLogout={async () => { await api.logout(); load() }} />
}
