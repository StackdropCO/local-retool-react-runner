import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, Search } from 'lucide-react'
import { Alert, AlertDescription } from './components/ui/alert'
import { AppHeader } from './components/app-header'
import { DiscoveredApps } from './components/discovered-apps'
import { ResourceCard } from './components/resource-card'
import { RunningApps } from './components/running-apps'
import { LocalResourceCard } from './components/local-resource-card'
import { CurrentUserCard } from './components/current-user-card'
import { RetoolCliCard } from './components/retool-cli-card'
import { RepositoryCard } from './components/repository-card'
import { ConnectionCard } from './components/connection-card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs'
import { Input } from './components/ui/input'
import { Button } from './components/ui/button'
import { panelApi, type PanelApi } from './lib/api'
import type { CurrentUser, PanelStatus, Resource, RunningApp, RunInput, ScannedApp } from './lib/types'

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
  const [resources, setResources] = useState<Resource[] | null>(null)
  const [resourcesError, setResourcesError] = useState('')
  const [resourcesLoading, setResourcesLoading] = useState(true)
  const [appsBySource, setAppsBySource] = useState<Record<'cli' | 'git', ScannedApp[] | null>>({ cli: null, git: null })
  const [appSourceMode, setAppSourceMode] = useState<'cli' | 'git' | null>(null)
  const [activeSection, setActiveSection] = useState('apps')
  const [settingsSource, setSettingsSource] = useState<'cli-source' | 'git-source'>('cli-source')
  const [currentUserOpen, setCurrentUserOpen] = useState(false)
  const [appQuery, setAppQuery] = useState('')
  const [appView, setAppView] = useState<'all' | 'running' | 'recent'>('all')
  const [rescanning, setRescanning] = useState(false)
  const [scanError, setScanError] = useState('')
  const [recentAppNames, setRecentAppNames] = useState<Set<string>>(() => new Set())
  const autoScannedRepo = useRef('')
  const cliIdentitySynced = useRef(false)
  const useMcpGroups = status?.mcpConfigured ?? Boolean(status?.mcpUrl?.trim())
  const activeSourceMode = appSourceMode ?? status?.sourceMode ?? 'cli'
  const apps = appsBySource[activeSourceMode]
  const activeAppsRoot = activeSourceMode === 'cli' ? status?.cliAppsDir?.trim() : status?.gitRepoDir?.trim()

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

  const refreshResources = useCallback(async () => {
    setResourcesError('')
    setResourcesLoading(true)
    try {
      setResources((await api.resources()).resources)
    } catch (cause) {
      setResourcesError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setResourcesLoading(false)
    }
  }, [api])

  const scan = useCallback(async (repoDir: string, sourceMode: 'cli' | 'git') => {
    const result = await api.scan(repoDir, sourceMode)
    setAppsBySource((current) => ({ ...current, [result.sourceMode]: result.apps }))
    setAppSourceMode(result.sourceMode)
    setStatus((current) => current ? {
      ...current,
      repoDir: result.repoDir,
      sourceMode: result.sourceMode,
      ...(result.sourceMode === 'cli' ? { cliAppsDir: result.repoDir } : { gitRepoDir: result.repoDir }),
    } : current)
    return result
  }, [api])

  const refreshCliBridge = useCallback(async (appId: string) => {
    const checkoutDir = status?.exploreCheckoutDir?.trim()
    const gitRepoDir = status?.gitRepoDir?.trim()
    if (!checkoutDir) throw new Error('Configure one CLI resource checkout in Settings before refreshing resources.')
    if (!gitRepoDir) throw new Error('The Git apps repository is not configured.')
    await api.cliPull(checkoutDir)
    const result = await scan(gitRepoDir, 'git')
    await refreshStatus()
    const refreshedApp = result.apps.find((app) => app.uuid === appId)
    if (!refreshedApp?.cliCheckoutAvailable) {
      throw new Error('The CLI resource bridge refreshed, but it still does not expose every resource required by this app.')
    }
  }, [api, refreshStatus, scan, status?.exploreCheckoutDir, status?.gitRepoDir])

  useEffect(() => {
    void Promise.all([refreshStatus(), refreshRunning(), refreshResources()])
  }, [refreshStatus, refreshRunning, refreshResources])

  useEffect(() => {
    const repoDir = activeAppsRoot
    const sourceMode = activeSourceMode
    const scanKey = `${sourceMode}:${repoDir}`
    if (!repoDir || autoScannedRepo.current === scanKey) return
    autoScannedRepo.current = scanKey
    void scan(repoDir, sourceMode).catch((cause) => {
      setStatusError(`Unable to scan saved repository: ${cause instanceof Error ? cause.message : String(cause)}`)
    })
  }, [activeAppsRoot, activeSourceMode, scan])

  useEffect(() => {
    if (!status || status.mcpConfigured !== false || cliIdentitySynced.current) return
    cliIdentitySynced.current = true
    void api.syncCurrentUserFromCli()
      .then(({ currentUser }) => setStatus((current) => current ? { ...current, currentUser } : current))
      .catch((cause) => setStatusError(`Unable to load CLI identity: ${cause instanceof Error ? cause.message : String(cause)}`))
  }, [api, status])

  const saveCurrentUser = async (currentUser: CurrentUser) => {
    await api.saveCurrentUser(currentUser)
    await refreshStatus()
  }

  const saveMcpUrl = async (mcpUrl: string) => {
    await api.saveMcpUrl(mcpUrl)
    await refreshStatus()
  }

  const authorizeMcp = async () => {
    await api.authorize()
    await refreshStatus()
  }

  const run = async (input: RunInput) => {
    const result = await api.run(input)
    setRecentAppNames((current) => new Set(current).add(input.name))
    await refreshRunning()
    return result
  }

  const push = async (checkoutDir: string, message: string) => (
    await api.cliPush(checkoutDir, message, true)
  ).result

  const pull = async (checkoutDir: string) => {
    const result = (await api.cliPull(checkoutDir)).result
    const appsRootDir = status?.cliAppsDir?.trim()
    if (appsRootDir) await scan(appsRootDir, 'cli')
    return result
  }

  const stop = async (port: number) => {
    await api.stop(port)
    await refreshRunning()
  }

  const rescan = async () => {
    const repoDir = activeAppsRoot
    if (!repoDir || rescanning) return
    setRescanning(true)
    setScanError('')
    try {
      await scan(repoDir, activeSourceMode)
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
      <AppHeader
        status={status}
        runningCount={running.length}
        loading={statusLoading}
        onEditCurrentUser={() => {
          setActiveSection('settings')
          setCurrentUserOpen(true)
        }}
      />
      <Tabs value={activeSection} onValueChange={setActiveSection}>
        <div className="border-b bg-card/75 backdrop-blur-sm">
          <div className="mx-auto max-w-[1480px] px-4 py-2 sm:px-6">
            <TabsList aria-label="Dashboard sections" className="flex h-10 w-full rounded-xl bg-muted/70 p-1">
              <TabsTrigger value="apps" className="h-8 rounded-lg px-3 font-mono text-xs tracking-[0.04em]">
                Apps <span className="ml-1.5">{apps?.length ?? 0}</span>
              </TabsTrigger>
              <TabsTrigger value="resources" className="h-8 rounded-lg px-3 font-mono text-xs tracking-[0.04em]">
                Resources{resources !== null ? <span className="ml-1.5">{resources.length}</span> : null}
              </TabsTrigger>
              <TabsTrigger value="local-resources" className="h-8 rounded-lg px-3 font-mono text-xs tracking-[0.04em]">
                Local API specs <span className="ml-1.5">{status?.localResources?.length ?? 0}</span>
              </TabsTrigger>
              <TabsTrigger value="settings" className="ml-auto h-8 rounded-lg px-3 font-mono text-xs tracking-[0.04em]">
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
            <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
              <div className="min-w-0 space-y-4">
                <Tabs
                  value={activeSourceMode}
                  onValueChange={(value) => setAppSourceMode(value as 'cli' | 'git')}
                >
                  <TabsList aria-label="App source">
                    <TabsTrigger value="cli">CLI checkouts</TabsTrigger>
                    <TabsTrigger value="git">Git</TabsTrigger>
                  </TabsList>
                </Tabs>
                <p className="text-xs text-muted-foreground">
                  {activeSourceMode === 'cli'
                    ? 'Locally cloned Retool CLI apps. Run, pull, or create a preview build from each app card.'
                    : 'Protected Apps as Code sources. Select a Git branch or worktree, then run it locally.'}
                </p>
                {scanError && (
                  <Alert variant="destructive">
                    <AlertDescription>Unable to rescan apps: {scanError}</AlertDescription>
                  </Alert>
                )}
                {(apps !== null || activeAppsRoot) && (
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(18rem,1fr)_auto_auto]">
                    <div className="relative min-w-0">
                      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                      <Input
                        aria-label="Filter apps"
                        placeholder="Search apps, resources, or paths…"
                        value={appQuery}
                        onChange={(event) => setAppQuery(event.target.value)}
                        className="h-11 bg-card pl-10 shadow-sm"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11"
                      disabled={!activeAppsRoot || rescanning}
                      onClick={() => void rescan()}
                    >
                      <RefreshCw className={rescanning ? 'animate-spin' : ''} aria-hidden="true" />
                      {rescanning ? 'Rescanning…' : 'Rescan'}
                    </Button>
                    <div className="flex h-11 shrink-0 gap-1 rounded-xl border bg-card p-1 shadow-sm sm:col-span-2 lg:col-span-1" role="group" aria-label="App view">
                      {(['all', 'running', 'recent'] as const).map((view) => (
                        <button
                          key={view}
                          type="button"
                          className={`min-w-20 flex-1 rounded-lg px-4 text-sm capitalize transition-colors ${appView === view ? 'bg-primary font-semibold text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
                          aria-pressed={appView === view}
                          onClick={() => setAppView(view)}
                        >
                          {view}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <DiscoveredApps
                  apps={visibleApps}
                  loading={apps === null && Boolean(activeAppsRoot)}
                  configured={Boolean(activeAppsRoot)}
                  sourceMode={activeSourceMode}
                  onRefreshCli={refreshCliBridge}
                  onConfigure={(sourceMode) => {
                    setSettingsSource(sourceMode === 'cli' ? 'cli-source' : 'git-source')
                    setActiveSection('settings')
                  }}
                  onRun={run}
                  onPull={pull}
                  onPush={push}
                  emptyMessage={emptyAppsMessage}
                />
              </div>
              <div className="space-y-4">
                <RunningApps
                  apps={running}
                  loading={runningLoading}
                  error={runningError}
                  onStop={stop}
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="resources" className="mt-0">
            <div className="max-w-5xl">
              <ResourceCard
                resources={resources}
                loading={resourcesLoading}
                error={resourcesError}
                onRefresh={refreshResources}
              />
            </div>
          </TabsContent>

          <TabsContent value="local-resources" className="mt-0">
            <div className="max-w-5xl">
              <LocalResourceCard status={status} api={api} onSaved={refreshStatus} />
            </div>
          </TabsContent>

          <TabsContent value="settings" className="mt-0">
            <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="space-y-4">
                <ConnectionCard status={status} onSave={saveMcpUrl} onAuthorize={authorizeMcp} />
                <Tabs value={settingsSource} onValueChange={(value) => setSettingsSource(value as 'cli-source' | 'git-source')}>
                  <TabsList aria-label="App source type">
                    <TabsTrigger value="cli-source">CLI checkouts</TabsTrigger>
                    <TabsTrigger value="git-source">Git</TabsTrigger>
                  </TabsList>
                  <TabsContent value="cli-source">
                    <RetoolCliCard
                      api={api}
                      appsRootDir={status?.cliAppsDir || ''}
                      onAppsRootReady={async (appsRootDir) => {
                        await scan(appsRootDir, 'cli')
                        await refreshStatus()
                      }}
                    />
                  </TabsContent>
                  <TabsContent value="git-source">
                    <RepositoryCard
                      api={api}
                      initialRepoDir={status?.gitRepoDir || ''}
                      onScan={async (gitRepoDir) => {
                        await scan(gitRepoDir, 'git')
                        await refreshStatus()
                      }}
                    />
                  </TabsContent>
                </Tabs>
              </div>
              <div className="xl:sticky xl:top-5">
                <CurrentUserCard
                  currentUser={status?.currentUser ?? null}
                  groupMode={useMcpGroups ? 'directory' : 'manual'}
                  loadGroups={async () => (await api.groups()).groups}
                  onSave={saveCurrentUser}
                  open={currentUserOpen}
                  onOpenChange={setCurrentUserOpen}
                />
              </div>
            </div>
          </TabsContent>

      </main>
      </Tabs>
    </div>
  )
}
