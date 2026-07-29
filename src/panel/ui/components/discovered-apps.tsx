import { Boxes } from 'lucide-react'
import type { RunInput, ScannedApp } from '../lib/types'
import { AppCard } from './app-card'

type DiscoveredAppsProps = {
  apps: ScannedApp[] | null
  onRun(input: RunInput): Promise<void>
}

export function DiscoveredApps({ apps, onRun }: DiscoveredAppsProps) {
  if (apps === null) return null

  return (
    <section className="space-y-3" aria-labelledby="discovered-apps-title">
      <div className="flex items-center justify-between">
        <div>
          <h2 id="discovered-apps-title" className="flex items-center gap-2 text-base font-semibold"><Boxes aria-hidden="true" /> Discovered apps</h2>
          <p className="mt-1 text-sm text-muted-foreground">{apps.length} app{apps.length === 1 ? '' : 's'} found.</p>
        </div>
      </div>
      {apps.length ? apps.map((app) => <AppCard key={app.path} app={app} onRun={onRun} />) : (
        <div className="rounded-xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
          No apps were found in that folder. Choose the repository root or a folder containing apps-as-code projects.
        </div>
      )}
    </section>
  )
}

