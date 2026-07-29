import { Activity, DatabaseZap, FolderGit2, KeyRound, TerminalSquare } from 'lucide-react'
import type { PanelStatus } from '../lib/types'
import { Badge } from './ui/badge'

type AppHeaderProps = {
  status: PanelStatus | null
  runningCount: number
  loading: boolean
}

export function AppHeader({ status, runningCount, loading }: AppHeaderProps) {
  return (
    <header className="border-b bg-card/90">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-5 px-5 py-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <TerminalSquare className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Local Retool Runner</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Connect, discover, and run apps against your Retool resources.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2" aria-label="System status">
          <Badge variant={status?.connected ? 'success' : 'outline'}>
            <DatabaseZap aria-hidden="true" />
            {loading ? 'Checking MCP' : status?.connected ? 'Connected' : 'Disconnected'}
          </Badge>
          <Badge variant={status?.cachedAuth ? 'success' : 'warning'}>
            <KeyRound aria-hidden="true" />
            {status?.cachedAuth ? 'Token cached' : 'Authorization needed'}
          </Badge>
          <Badge variant={status?.repoDir ? 'secondary' : 'outline'}>
            <FolderGit2 aria-hidden="true" />
            {status?.repoDir ? 'Repository selected' : 'No repository'}
          </Badge>
          <Badge variant={runningCount ? 'default' : 'outline'}>
            <Activity aria-hidden="true" />
            {runningCount ? `${runningCount} app${runningCount === 1 ? '' : 's'} running` : 'No apps running'}
          </Badge>
        </div>
      </div>
    </header>
  )
}
