import type { RunInput, ScannedApp } from '../lib/types'
import { AppCard } from './app-card'
import { Card, CardContent } from './ui/card'

type DiscoveredAppsProps = {
  apps: ScannedApp[] | null
  onRun(input: RunInput): Promise<void>
  emptyMessage?: string
}

export function DiscoveredApps({ apps, onRun, emptyMessage }: DiscoveredAppsProps) {
  if (apps === null) return null

  return (
    <Card>
      <CardContent className="px-0 pb-0">
        {apps.length ? (
          apps.map((app) => <AppCard key={app.path} app={app} onRun={onRun} />)
        ) : (
          <p className="px-4 pb-4 text-xs text-muted-foreground">
            {emptyMessage ?? 'No apps here. Pick the repository root, or a folder that contains apps.'}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
