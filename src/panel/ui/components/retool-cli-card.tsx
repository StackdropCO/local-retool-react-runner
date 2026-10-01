import { useEffect, useMemo, useState } from 'react'
import type { PanelApi } from '../lib/api'
import type { RetoolCliApp, RetoolCliStatus } from '../lib/types'
import { Alert, AlertDescription } from './ui/alert'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { DirectoryBrowser } from './directory-browser'
import { Input } from './ui/input'

type Props = {
  api: PanelApi
  appsRootDir: string
  onAppsRootReady(appsRootDir: string): Promise<void>
}

function normalizedApps(payload: unknown): RetoolCliApp[] {
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { apps?: unknown }).apps)
      ? (payload as { apps: unknown[] }).apps
      : []
  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return []
    const item = row as Record<string, unknown>
    const id = String(item.uuid ?? item.id ?? item.appId ?? '').trim()
    return id ? [{ id, name: String(item.name ?? item.displayName ?? id) }] : []
  })
}

export function RetoolCliCard({ api, appsRootDir, onAppsRootReady }: Props) {
  const [status, setStatus] = useState<RetoolCliStatus | null>(null)
  const [version, setVersion] = useState('')
  const [host, setHost] = useState('')
  const [apps, setApps] = useState<RetoolCliApp[]>([])
  const [appId, setAppId] = useState('')
  const [branch, setBranch] = useState('')
  const [parentDir, setParentDir] = useState(appsRootDir)
  const [browserOpen, setBrowserOpen] = useState(false)
  const [statusLoading, setStatusLoading] = useState(true)
  const [appsLoaded, setAppsLoaded] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [output, setOutput] = useState('')

  const activeHost = host.trim() || status?.defaultHost || ''
  const authenticated = useMemo(() => status?.hosts?.some((item) => (
    item.host === activeHost && item.expired !== true
  )) ?? false, [activeHost, status])

  const applyApps = (payload: unknown) => {
    const next = normalizedApps(payload)
    setApps(next)
    setAppsLoaded(true)
    setAppId((current) => current || next[0]?.id || '')
    return next
  }

  const refreshStatus = async () => {
    setError('')
    try {
      const response = await api.cliStatus()
      const next = response.status
      const detectedHost = host || next.defaultHost || ''
      setVersion(response.version || '')
      setStatus(next)
      if (!host && next.defaultHost) setHost(next.defaultHost)
      const signedIn = next.hosts?.some((item) => item.host === detectedHost && item.expired !== true) ?? false
      if (signedIn) applyApps((await api.cliApps(detectedHost || undefined)).apps)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setStatusLoading(false)
    }
  }
  useEffect(() => { void refreshStatus() }, [])
  useEffect(() => { if (appsRootDir) setParentDir(appsRootDir) }, [appsRootDir])

  const act = async (name: string, action: () => Promise<string>) => {
    setBusy(name)
    setError('')
    setOutput('')
    try {
      const result = await action()
      setOutput(result)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy('')
    }
  }

  const login = () => act('login', async () => {
    const response = await api.cliLogin(activeHost || undefined)
    setStatus(response.status)
    setVersion(response.version || version)
    const detectedHost = activeHost || response.status.defaultHost || ''
    const nextApps = applyApps((await api.cliApps(detectedHost || undefined)).apps)
    return `Signed in to ${detectedHost}. Loaded ${nextApps.length} app${nextApps.length === 1 ? '' : 's'}.`
  })

  const loadApps = () => act('apps', async () => {
    const response = await api.cliApps(activeHost || undefined)
    const next = applyApps(response.apps)
    return `Loaded ${next.length} Retool app${next.length === 1 ? '' : 's'}.`
  })

  const clone = () => act('clone', async () => {
    const response = await api.cliClone({
      appId,
      parentDir: parentDir.trim(),
      branch: branch.trim() || undefined,
      host: activeHost || undefined,
    })
    await onAppsRootReady(response.appsRootDir)
    const appName = apps.find((item) => item.id === appId)?.name ?? appId
    return `Cloned ${appName} into ${response.checkoutDir}, installed its dependencies, and made it available below.`
  })

  const useParent = () => act('parent', async () => {
    await onAppsRootReady(parentDir.trim())
    return `Using ${parentDir.trim()} as the local apps folder.`
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Retool CLI connection and source</CardTitle>
        <p className="text-xs text-muted-foreground">
          Connect to your Retool organization, clone an app locally, and pull remote updates. Preview pushes live on each app card.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <p className="text-xs font-semibold">1. Retool organization</p>
          <p className="text-xs text-muted-foreground">Use the same host you pass to <span className="mono">retool auth login --host</span>.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <Input aria-label="Retool host" value={host} onChange={(event) => setHost(event.target.value)} placeholder="https://example.retool.com" className="mono text-xs" />
          <Button variant="outline" disabled={!!busy} onClick={() => void login()}>{busy === 'login' ? 'Signing in…' : authenticated ? 'Re-authenticate' : 'Sign in'}</Button>
          <Button variant="outline" disabled={!!busy || !authenticated} onClick={() => void loadApps()}>{busy === 'apps' ? 'Loading…' : 'Load apps'}</Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {statusLoading
            ? 'Detecting the installed Retool CLI and its authentication…'
            : authenticated
              ? `${version ? `Retool CLI ${version} · ` : ''}Authenticated${status?.hosts?.find((item) => item.host === activeHost)?.userEmail ? ` as ${status.hosts.find((item) => item.host === activeHost)?.userEmail}` : ''} on ${activeHost}. Apps were loaded automatically.`
              : activeHost
                ? `Not authenticated on ${activeHost}. Sign in before loading apps.`
                : 'Enter your Retool host and sign in before loading apps.'}
        </p>

        <div className="space-y-2 border-t pt-4">
          <div>
            <p className="text-xs font-semibold">2. Local apps folder</p>
            <p className="text-xs text-muted-foreground">Choose this once. Every cloned app gets its own UUID folder inside it.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input aria-label="Local apps parent folder" value={parentDir} onChange={(event) => setParentDir(event.target.value)} placeholder="/absolute/path/to/retool-apps" className="mono text-xs" />
            <Button variant="outline" onClick={() => setBrowserOpen(true)}>Browse</Button>
            <Button variant="outline" disabled={!!busy || !parentDir.trim()} onClick={() => void useParent()}>{busy === 'parent' ? 'Scanning…' : 'Use folder'}</Button>
          </div>
          {parentDir.trim() && appId && (
            <p className="text-xs text-muted-foreground">Next clone: <span className="mono">{parentDir.trim().replace(/\/$/, '')}/{appId}</span></p>
          )}
        </div>

        {apps.length > 0 && (
          <div className="space-y-2 border-t pt-4">
            <div>
              <p className="text-xs font-semibold">3. Clone a remote app</p>
              <p className="text-xs text-muted-foreground">Choose an app. Retool CLI creates its child folder automatically; branch is optional.</p>
            </div>
            <div className="grid gap-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]">
              <select aria-label="Retool app" value={appId} onChange={(event) => setAppId(event.target.value)} className="h-9 rounded-md border border-input bg-background px-2.5 text-xs">
                {apps.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              <Input aria-label="Retool branch" value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="Existing branch (optional)" className="mono text-xs" />
              <Button disabled={!!busy || !appId || !parentDir.trim()} onClick={() => void clone()}>{busy === 'clone' ? 'Cloning…' : 'Clone app'}</Button>
            </div>
          </div>
        )}
        {appsLoaded && apps.length === 0 && (
          <p className="text-xs text-muted-foreground">No cloneable Retool apps were returned for this organization.</p>
        )}

        {!parentDir && <p className="text-xs text-muted-foreground">Choose the parent folder where this runner should keep your local Retool apps.</p>}
        <p className="text-xs text-muted-foreground">The runner can create preview builds, but it never publishes an app live.</p>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        {output && <Alert><AlertDescription>{output}</AlertDescription></Alert>}
      </CardContent>
      <DirectoryBrowser
        api={api}
        open={browserOpen}
        initialDir={parentDir}
        onOpenChange={setBrowserOpen}
        onSelect={(dir) => {
          setParentDir(dir)
          setBrowserOpen(false)
          void onAppsRootReady(dir)
        }}
      />
    </Card>
  )
}
