import type { RunInput, ScannedApp } from '../lib/types'
import { AppCard } from './app-card'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'

type DiscoveredAppsProps = {
  apps: ScannedApp[] | null
  onRun(input: RunInput): Promise<void>
}

export function DiscoveredApps({ apps, onRun }: DiscoveredAppsProps) {
  if (apps === null) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Apps <span className="font-normal text-muted-foreground">({apps.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        {apps.length ? (
          apps.map((app) => <AppCard key={app.path} app={app} onRun={onRun} />)
        ) : (
          <p className="px-4 pb-4 text-xs text-muted-foreground">
            No apps here. Pick the repository root, or a folder that contains apps.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
