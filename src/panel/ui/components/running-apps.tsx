import { useState } from 'react'
import type { RunningApp } from '../lib/types'
import { Alert, AlertDescription } from './ui/alert'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'

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
        <CardTitle>Running</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {(error || actionError) && (
          <Alert variant="destructive">
            <AlertDescription>{error || actionError}</AlertDescription>
          </Alert>
        )}
        {loading && <p className="text-xs text-muted-foreground">Checking…</p>}
        {!loading && apps.length === 0 && <p className="text-xs text-muted-foreground">Nothing running.</p>}
        {apps.map((app) => (
          <div key={app.port} className="border-t pt-2 first:border-t-0 first:pt-0">
            <p className="truncate text-sm font-medium">{app.name}</p>
            <p className="mono mt-0.5 text-xs text-muted-foreground">
              localhost:{app.port}
              {app.writes ? ' · writes' : ''}
            </p>
            {/* Branch on its own line, wrapping — these names are long. */}
            {app.branch && (
              <p className="mono mt-0.5 break-all text-xs text-muted-foreground/80" title={app.branch}>
                {app.branch} · {app.head.slice(0, 7)} · {app.dirty ? 'modified' : 'clean'}
              </p>
            )}
            <p className="mono mt-0.5 break-all text-xs text-muted-foreground/80" title={app.worktreePath}>
              {app.worktreePath}
            </p>
            <div className="mt-2 flex gap-2">
              <Button asChild size="sm" variant="outline">
                <a href={app.url} target="_blank" rel="noreferrer">
                  Open
                </a>
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={stoppingPort === app.port}
                onClick={() => stop(app.port)}
                aria-label={`Stop ${app.name}`}
              >
                {stoppingPort === app.port ? 'Stopping…' : 'Stop'}
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
