import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, AlertDescription } from './components/ui/alert'
import { AppHeader } from './components/app-header'
import { DiscoveredApps } from './components/discovered-apps'
import { RepositoryCard } from './components/repository-card'
import { ResourceCard } from './components/resource-card'
import { RunningApps } from './components/running-apps'
import { LocalResourceCard } from './components/local-resource-card'
import { CurrentUserCard } from './components/current-user-card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs'
import { Input } from './components/ui/input'
import { Button } from './components/ui/button'
import { panelApi, type PanelApi } from './lib/api'
import type { CurrentUser, PanelStatus, RunningApp, RunInput, ScannedApp } from './lib/types'

type PanelAppProps = {
  api?: PanelApi
}

export function PanelApp({ api = panelApi }: PanelAppProps) {
  const [status, setStatus] = useState<PanelStatus | null>(null)
  const [statusError, setStatusError] = useState('')
  const [statusLoading, setStatusLoading] = useState(true)
  const [running, setRunning] = useState<RunningApp[]>([])
  const [runningError, setRunningError] = useState('')
  const [runningLoading, setRunningLoading] = useState(true)
  const [apps, setApps] = useState<ScannedApp[] | null>(null)
  const [resourceCount, setResourceCount] = useState<number | null>(null)
  const [appQuery, setAppQuery] = useState('')
  const [appView, setAppView] = useState<'all' | 'running' | 'recent'>('all')
  const [rescanning, setRescanning] = useState(false)
  const [scanError, setScanError] = useState('')
  const [recentAppNames, setRecentAppNames] = useState<Set<string>>(() => new Set())
  const autoScannedRepo = useRef('')

  const refreshStatus = useCallback(async () => {
    setStatusError('')
    try {
      setStatus(await api.status())
    } catch (cause) {
      setStatusError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setStatusLoading(false)
    }
  }, [api])

  const refreshRunning = useCallback(async () => {
    setRunningError('')
    try {
      setRunning((await api.running()).apps)
    } catch (cause) {
      setRunningError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setRunningLoading(false)
    }
  }, [api])

  const scan = useCallback(async (repoDir: string) => {
    const result = await api.scan(repoDir)
    setApps(result.apps)
    setStatus((current) => current ? { ...current, repoDir: result.repoDir } : current)
  }, [api])

  useEffect(() => {
    void Promise.all([refreshStatus(), refreshRunning()])
    void api.resources()
      .then(({ resources }) => setResourceCount(resources.length))
      .catch(() => setResourceCount(null))
  }, [refreshStatus, refreshRunning])

  useEffect(() => {
    const repoDir = status?.repoDir?.trim()
    if (!repoDir || autoScannedRepo.current === repoDir) return
    autoScannedRepo.current = repoDir
    void scan(repoDir).catch((cause) => {
      setStatusError(`Unable to scan saved repository: ${cause instanceof Error ? cause.message : String(cause)}`)
    })
  }, [scan, status?.repoDir])

  const saveCurrentUser = async (currentUser: CurrentUser) => {
    await api.saveCurrentUser(currentUser)
    await refreshStatus()
  }

  const run = async (input: RunInput) => {
    await api.run(input)
    setRecentAppNames((current) => new Set(current).add(input.name))
    await refreshRunning()
  }

  const stop = async (port: number) => {
    await api.stop(port)
    await refreshRunning()
  }

  const rescan = async () => {
    const repoDir = status?.repoDir?.trim()
    if (!repoDir || rescanning) return
    setRescanning(true)
    setScanError('')
    try {
      await scan(repoDir)
    } catch (cause) {
      setScanError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setRescanning(false)
    }
  }

  const visibleApps = useMemo(() => {
    if (apps === null) return null
    const query = appQuery.trim().toLowerCase()
    const runningNames = new Set(running.map((app) => app.name))
    return apps.filter((app) => {
      if (appView === 'running' && !runningNames.has(app.name)) return false
      if (appView === 'recent' && !recentAppNames.has(app.name)) return false
      if (!query) return true
      return [
        app.name,
        app.group,
        app.path,
        ...app.resources.map((resource) => resource.displayName),
      ].some((value) => value.toLowerCase().includes(query))
    })
  }, [appQuery, apps, appView, recentAppNames, running])

  const emptyAppsMessage = appQuery.trim()
    ? `No apps match “${appQuery.trim()}”.`
    : appView === 'running'
      ? 'No scanned apps are currently running.'
      : appView === 'recent'
        ? 'Apps launched during this panel session will appear here.'
        : undefined

  return (
    <div className="min-h-screen">
      <AppHeader status={status} runningCount={running.length} loading={statusLoading} />
      <Tabs defaultValue="apps">
        <div className="border-b bg-card">
          <div className="mx-auto max-w-[1480px] px-4 sm:px-6">
            <TabsList aria-label="Dashboard sections" className="flex h-12 w-full rounded-none bg-transparent p-0">
              <TabsTrigger value="apps" className="h-11 rounded-none border-b-2 border-transparent px-0 font-mono text-[10px] tracking-[0.04em] data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">
                Apps <span className="ml-1.5">{apps?.length ?? 0}</span>
              </TabsTrigger>
              <TabsTrigger value="resources" className="ml-7 h-11 rounded-none border-b-2 border-transparent px-0 font-mono text-[10px] tracking-[0.04em] data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">
                Resources{resourceCount !== null ? <span className="ml-1.5">{resourceCount}</span> : null}
              </TabsTrigger>
              <TabsTrigger value="local-resources" className="ml-7 h-11 rounded-none border-b-2 border-transparent px-0 font-mono text-[10px] tracking-[0.04em] data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">
                Local API specs <span className="ml-1.5">{status?.localResources?.length ?? 0}</span>
              </TabsTrigger>
              <TabsTrigger value="settings" className="ml-auto h-11 rounded-none border-b-2 border-transparent px-0 font-mono text-[10px] tracking-[0.04em] data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">
                Settings
              </TabsTrigger>
            </TabsList>
          </div>
        </div>

      <main className="mx-auto max-w-[1480px] px-4 py-4 sm:px-6">
        {statusError && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>Unable to load panel status: {statusError}</AlertDescription>
          </Alert>
        )}
          <TabsContent value="apps" className="mt-0">
            <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="min-w-0 space-y-4">
                {scanError && (
                  <Alert variant="destructive">
                    <AlertDescription>Unable to rescan apps: {scanError}</AlertDescription>
                  </Alert>
                )}
                {(apps !== null || status?.repoDir?.trim()) && (
                  <div className="flex flex-col gap-2 border-y bg-card p-2 sm:flex-row">
                    <Input
                      aria-label="Filter apps"
                      placeholder="Filter apps…"
                      value={appQuery}
                      onChange={(event) => setAppQuery(event.target.value)}
                      className="h-10 rounded-none shadow-none"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 rounded-none shadow-none"
                      disabled={!status?.repoDir?.trim() || rescanning}
                      onClick={() => void rescan()}
                    >
                      {rescanning ? 'Rescanning…' : 'Rescan'}
                    </Button>
                    <div className="flex shrink-0" role="group" aria-label="App view">
                      {(['all', 'running', 'recent'] as const).map((view) => (
                        <button
                          key={view}
                          type="button"
                          className={`min-w-20 px-4 font-mono text-[10px] capitalize tracking-[0.04em] transition-colors ${appView === view ? 'bg-muted font-semibold text-primary' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`}
                          aria-pressed={appView === view}
                          onClick={() => setAppView(view)}
                        >
                          {view}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <DiscoveredApps apps={visibleApps} onRun={run} emptyMessage={emptyAppsMessage} />
              </div>
              <RunningApps
                apps={running}
                loading={runningLoading}
                error={runningError}
                onStop={stop}
              />
            </div>
          </TabsContent>

          <TabsContent value="resources" className="mt-0">
            <div className="max-w-5xl">
              <ResourceCard api={api} />
            </div>
          </TabsContent>

          <TabsContent value="local-resources" className="mt-0">
            <div className="max-w-5xl">
              <LocalResourceCard status={status} api={api} onSaved={refreshStatus} />
            </div>
          </TabsContent>

          <TabsContent value="settings" className="mt-0">
            <div className="grid items-start gap-4 lg:grid-cols-[minmax(360px,2fr)_minmax(0,3fr)]">
              <div className="lg:col-span-2">
                <RepositoryCard api={api} initialRepoDir={status?.repoDir || ''} onScan={scan} />
              </div>
              <CurrentUserCard
                currentUser={status?.currentUser ?? null}
                loadGroups={async () => status?.currentUser?.groups ?? []}
                onSave={saveCurrentUser}
              />
            </div>
          </TabsContent>

      </main>
      </Tabs>
    </div>
  )
}
