import type { PanelStatus } from '../lib/types'
import { UserRound } from 'lucide-react'

type AppHeaderProps = {
  status: PanelStatus | null
  runningCount: number
  loading: boolean
  onEditCurrentUser(): void
}

/**
 * One line: what this is, plus the few facts worth knowing at a glance.
 * Plain text and a single state dot — no pills, no decorative icons.
 */
export function AppHeader({ status, runningCount, loading, onEditCurrentUser }: AppHeaderProps) {
  const appsRootDir = status?.repoDir
  const connected = Boolean(appsRootDir)
  const connectionLabel = loading ? 'Checking' : connected ? 'Apps folder ready' : 'Apps folder not configured'
  const panelPort = typeof window === 'undefined' ? '' : window.location.port

  return (
    <header className="border-b bg-card/90 backdrop-blur-sm">
      <div className="mx-auto flex min-h-14 max-w-[1480px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-2 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="size-2.5 rounded-full bg-primary shadow-[0_0_0_4px_rgba(26,24,48,0.12)]" aria-hidden="true" />
          <h1 className="text-sm font-bold tracking-tight">Retool React Local Runner</h1>
          <span className="mono text-xs text-muted-foreground">
            Panel {panelPort ? `· :${panelPort}` : ''}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {appsRootDir && <span className="mono hidden max-w-72 truncate normal-case tracking-normal text-muted-foreground sm:inline" title={appsRootDir}>{appsRootDir}</span>}
          <button
            type="button"
            className="inline-flex h-8 max-w-56 items-center gap-2 rounded-full border bg-card px-3 font-medium text-foreground shadow-sm transition-colors hover:border-primary/25 hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            disabled={!status?.currentUser}
            aria-label={`Edit emulated user${status?.currentUser ? `, currently ${status.currentUser.fullName || status.currentUser.email}` : ''}`}
            onClick={onEditCurrentUser}
          >
            <UserRound className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
            <span className="truncate">Previewing as {status?.currentUser?.fullName || status?.currentUser?.email || 'user'}</span>
          </button>
          <span
            className={`inline-flex h-7 items-center gap-2 rounded-full px-3 font-semibold ${connected ? 'bg-emerald-50 text-emerald-700' : 'bg-muted text-muted-foreground'}`}
          >
            <span aria-hidden="true" className={`size-1.5 rounded-full ${connected ? 'bg-emerald-600' : 'bg-muted-foreground'}`} />
            {connectionLabel}
          </span>
          <span className="rounded-full bg-secondary px-3 py-1.5 font-semibold text-primary" aria-live="polite">
            {runningCount} running
          </span>
        </div>
      </div>
    </header>
  )
}
