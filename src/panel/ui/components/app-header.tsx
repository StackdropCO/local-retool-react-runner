import type { PanelStatus } from '../lib/types'

type AppHeaderProps = {
  status: PanelStatus | null
  runningCount: number
  loading: boolean
}

function host(mcpUrl?: string) {
  if (!mcpUrl) return null
  try {
    return new URL(mcpUrl).host
  } catch {
    return mcpUrl
  }
}

/**
 * One line: what this is, plus the few facts worth knowing at a glance.
 * Plain text and a single state dot — no pills, no decorative icons.
 */
export function AppHeader({ status, runningCount, loading }: AppHeaderProps) {
  const mcpHost = host(status?.mcpUrl)
  const connected = Boolean(status?.connected)

  const facts = loading
    ? ['checking…']
    : [
        mcpHost ? (connected ? 'connected' : status?.cachedAuth ? 'authorized' : 'not authorized') : 'no endpoint set',
        runningCount === 1 ? '1 app running' : `${runningCount} apps running`,
      ]

  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-6 py-3">
        <h1 className="text-[13px] font-semibold tracking-tight">Local Retool Runner</h1>
        <div className="flex items-baseline gap-2 text-xs text-muted-foreground">
          <span
            aria-hidden="true"
            className={`inline-block size-1.5 rounded-full ${connected ? 'bg-[#1f7a4d]' : 'bg-[#c4ccd6]'}`}
          />
          {mcpHost && <span className="mono">{mcpHost}</span>}
          <span>{facts.join(' · ')}</span>
        </div>
      </div>
    </header>
  )
}
