import { useCallback, useEffect, useState } from 'react'
import { Alert, AlertDescription } from './components/ui/alert'
import { AppHeader } from './components/app-header'
import { ConnectionCard } from './components/connection-card'
import { DiscoveredApps } from './components/discovered-apps'
import { RepositoryCard } from './components/repository-card'
import { ResourceCard } from './components/resource-card'
import { RunningApps } from './components/running-apps'
import { panelApi, type PanelApi } from './lib/api'
import type { PanelStatus, RunningApp, RunInput, ScannedApp } from './lib/types'

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

  useEffect(() => {
    void Promise.all([refreshStatus(), refreshRunning()])
  }, [refreshStatus, refreshRunning])

  const saveMcpUrl = async (mcpUrl: string) => {
    await api.saveMcpUrl(mcpUrl)
    await refreshStatus()
  }

  const authorize = async () => {
    await api.authorize()
    await refreshStatus()
  }

  const scan = async (repoDir: string) => {
    const result = await api.scan(repoDir)
    setApps(result.apps)
    setStatus((current) => current ? { ...current, repoDir: result.repoDir } : current)
  }

  const run = async (input: RunInput) => {
    await api.run(input)
    await refreshRunning()
  }

  const stop = async (port: number) => {
    await api.stop(port)
    await refreshRunning()
  }

  return (
    <div className="min-h-screen">
      <AppHeader status={status} runningCount={running.length} loading={statusLoading} />
      <main className="mx-auto max-w-[1440px] px-5 py-6 lg:px-8">
        {statusError && (
          <Alert variant="destructive" className="mb-5">
            <AlertDescription>Unable to load panel status: {statusError}</AlertDescription>
          </Alert>
        )}
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-5">
            <ConnectionCard status={status} onSave={saveMcpUrl} onAuthorize={authorize} />
            <RepositoryCard api={api} initialRepoDir={status?.repoDir || ''} onScan={scan} />
            <DiscoveredApps apps={apps} onRun={run} />
            <ResourceCard api={api} />
          </div>
          <RunningApps
            apps={running}
            loading={runningLoading}
            error={runningError}
            onStop={stop}
          />
        </div>
      </main>
    </div>
  )
}
