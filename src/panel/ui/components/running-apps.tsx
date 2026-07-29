import { useState } from 'react'
import { ExternalLink, LoaderCircle, Radio, Square } from 'lucide-react'
import type { RunningApp } from '../lib/types'
import { Alert, AlertDescription } from './ui/alert'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'

type RunningAppsProps = {
  apps: RunningApp[]
  loading: boolean
  error: string
  onStop(port: number): Promise<void>
}

export function RunningApps({ apps, loading, error, onStop }: RunningAppsProps) {
  const [stoppingPort, setStoppingPort] = useState<number | null>(null)
  const [actionError, setActionError] = useState('')

  const stop = async (port: number) => {
    setStoppingPort(port)
    setActionError('')
    try {
      await onStop(port)
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setStoppingPort(null)
    }
  }

  return (
    <Card className="xl:sticky xl:top-5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Radio className="text-emerald-600" aria-hidden="true" /> Running apps</CardTitle>
        <CardDescription>Active local processes and their safety mode.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {(error || actionError) && <Alert variant="destructive"><AlertDescription>{error || actionError}</AlertDescription></Alert>}
        {loading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="animate-spin" aria-hidden="true" /> Checking active apps…</div>}
        {!loading && apps.length === 0 && (
          <div className="rounded-lg border border-dashed p-6 text-center">
            <p className="text-sm font-medium">Nothing is running</p>
            <p className="mt-1 text-xs text-muted-foreground">Scan a repository and launch an app to see it here.</p>
          </div>
        )}
        {apps.map((app) => (
          <div key={app.port} className="rounded-lg border bg-background p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{app.name}</p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">localhost:{app.port}</p>
              </div>
              <Badge variant={app.writes ? 'warning' : 'success'}>{app.writes ? 'Writes' : 'Read-only'}</Badge>
            </div>
            {app.branch && <div className="mt-2"><Badge variant="outline">{app.branch}</Badge></div>}
            <div className="mt-3 flex gap-2">
              <Button asChild size="sm" variant="outline" className="flex-1">
                <a href={app.url} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" /> Open</a>
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={stoppingPort === app.port}
                onClick={() => stop(app.port)}
                aria-label={`Stop ${app.name}`}
              >
                {stoppingPort === app.port ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Square aria-hidden="true" />}
                Stop
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

