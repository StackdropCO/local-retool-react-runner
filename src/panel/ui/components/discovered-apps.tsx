import type { RunInput, RunResult, ScannedApp } from '../lib/types'
import { AppCard } from './app-card'
import { Card, CardContent } from './ui/card'

type DiscoveredAppsProps = {
  apps: ScannedApp[] | null
  onRun(input: RunInput): Promise<RunResult>
  onPull(checkoutDir: string): Promise<unknown>
  onPush(checkoutDir: string, message: string): Promise<unknown>
  emptyMessage?: string
}

export function DiscoveredApps({ apps, onRun, onPull, onPush, emptyMessage }: DiscoveredAppsProps) {
  if (apps === null) return null

  return (
    <Card>
      <CardContent className="px-0 pb-0">
        {apps.length ? (
          apps.map((app) => <AppCard key={app.path} app={app} onRun={onRun} onPull={onPull} onPush={onPush} />)
        ) : (
          <p className="px-4 pb-4 text-xs text-muted-foreground">
            {emptyMessage ?? 'No apps here. Pick the repository root, or a folder that contains apps.'}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
