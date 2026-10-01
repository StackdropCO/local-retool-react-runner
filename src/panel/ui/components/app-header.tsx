import type { PanelStatus } from '../lib/types'

type AppHeaderProps = {
  status: PanelStatus | null
  runningCount: number
  loading: boolean
}

/**
 * One line: what this is, plus the few facts worth knowing at a glance.
 * Plain text and a single state dot — no pills, no decorative icons.
 */
export function AppHeader({ status, runningCount, loading }: AppHeaderProps) {
  const appsRootDir = status?.repoDir
  const connected = Boolean(appsRootDir)
  const connectionLabel = loading ? 'Checking' : connected ? 'Apps folder ready' : 'Apps folder not configured'
  const panelPort = typeof window === 'undefined' ? '' : window.location.port

  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex min-h-14 max-w-[1480px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-2 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="size-2 bg-primary" aria-hidden="true" />
          <h1 className="text-sm font-bold tracking-tight">Retool React Local Runner</h1>
          <span className="mono text-xs text-muted-foreground">
            Panel {panelPort ? `· :${panelPort}` : ''}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {appsRootDir && <span className="mono hidden max-w-72 truncate normal-case tracking-normal text-muted-foreground sm:inline" title={appsRootDir}>{appsRootDir}</span>}
          <span
            className={`inline-flex h-6 items-center gap-2 px-2.5 font-semibold ${connected ? 'bg-emerald-50 text-emerald-700' : 'bg-muted text-muted-foreground'}`}
          >
            <span aria-hidden="true" className={`size-1.5 ${connected ? 'bg-emerald-600' : 'bg-muted-foreground'}`} />
            {connectionLabel}
          </span>
          <span className="bg-[#eef0f5] px-3 py-1.5 font-semibold text-primary">
            {runningCount} running
          </span>
        </div>
      </div>
    </header>
  )
}
