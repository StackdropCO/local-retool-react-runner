import type { RunInput, RunResult, ScannedApp } from '../lib/types'
import { AppCard } from './app-card'
import { Button } from './ui/button'
import { Card, CardContent } from './ui/card'

type DiscoveredAppsProps = {
  apps: ScannedApp[] | null
  loading: boolean
  configured: boolean
  sourceMode: 'cli' | 'git'
  onConfigure(sourceMode: 'cli' | 'git'): void
  onRun(input: RunInput): Promise<RunResult>
  onPull(checkoutDir: string): Promise<unknown>
  onPush(checkoutDir: string, message: string): Promise<unknown>
  emptyMessage?: string
}

export function DiscoveredApps({
  apps,
  loading,
  configured,
  sourceMode,
  onConfigure,
  onRun,
  onPull,
  onPush,
  emptyMessage,
}: DiscoveredAppsProps) {
  if (apps === null) {
    return (
      <Card>
        <CardContent className="flex min-h-52 flex-col items-center justify-center px-6 py-10 text-center">
          <h2 className="text-base font-semibold">
            {loading ? 'Scanning apps…' : `Configure ${sourceMode === 'cli' ? 'CLI checkouts' : 'a Git repository'}`}
          </h2>
          <p className="mt-2 max-w-lg text-sm text-muted-foreground" role={loading ? 'status' : undefined} aria-live={loading ? 'polite' : undefined}>
            {loading
              ? 'Looking for Retool apps in the saved source folder.'
              : sourceMode === 'cli'
                ? 'Connect the Retool CLI and choose the parent folder that contains your local app checkouts.'
                : 'Choose the Apps as Code repository that contains the Retool apps you want to preview.'}
          </p>
          {!loading && !configured && (
            <Button className="mt-5" onClick={() => onConfigure(sourceMode)}>
              Configure {sourceMode === 'cli' ? 'CLI source' : 'Git source'}
            </Button>
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      {apps.length ? (
        apps.map((app) => <AppCard key={app.path} app={app} onRun={onRun} onPull={onPull} onPush={onPush} />)
      ) : (
        <Card>
          <CardContent className="pt-5">
          <p className="px-4 pb-4 text-xs text-muted-foreground">
            {emptyMessage ?? 'No apps here. Pick the repository root, or a folder that contains apps.'}
          </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
