import { useState } from 'react'
import type { RunningApp } from '../lib/types'
import { Alert, AlertDescription } from './ui/alert'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'

type RunningAppsProps = {
  apps: RunningApp[]
  loading: boolean
  error: string
  onStop(port: number): Promise<void>
}

function RevealedValue({ value, className = '' }: { value: string; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`block truncate outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`} tabIndex={0}>
          {value}
        </span>
      </TooltipTrigger>
      <TooltipContent className="mono break-all" side="bottom" align="end">
        {value}
      </TooltipContent>
    </Tooltip>
  )
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
    <TooltipProvider delayDuration={250}>
    <Card className="overflow-hidden xl:sticky xl:top-5">
      <CardHeader className="flex-row items-center justify-between space-y-0 border-b px-4 py-3.5">
        <CardTitle>Running previews</CardTitle>
        {!loading && apps.length > 0 && <Badge variant="secondary">{apps.length}</Badge>}
      </CardHeader>
      <CardContent className="space-y-3 p-3">
        {(error || actionError) && (
          <Alert variant="destructive">
            <AlertDescription>{error || actionError}</AlertDescription>
          </Alert>
        )}
        {loading && <p className="text-xs text-muted-foreground">Checking…</p>}
        {!loading && apps.length === 0 && (
          <p className="px-1 py-3 text-xs text-muted-foreground">No local previews are running.</p>
        )}
        {apps.map((app) => (
          <article key={app.port} className="rounded-lg border bg-background p-3 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold" title={app.name}>{app.name}</p>
                <a
                  href={app.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mono mt-0.5 block w-fit text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  localhost:{app.port}
                </a>
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-1">
                <Badge variant={app.environment === 'production' ? 'destructive' : 'secondary'}>
                  {app.environment}
                </Badge>
                <Badge variant={app.writes ? 'warning' : 'outline'}>
                  {app.writes ? 'writes on' : 'read only'}
                </Badge>
              </div>
            </div>

            <dl className="mt-3 space-y-2 border-t pt-3 text-xs">
              {app.branch && (
                <>
                  <div className="grid grid-cols-[4rem_minmax(0,1fr)] gap-2">
                    <dt className="text-muted-foreground">Branch</dt>
                    <dd className="min-w-0 text-right">
                      <RevealedValue value={app.branch} className="mono font-medium" />
                    </dd>
                  </div>
                  <div className="grid grid-cols-[4rem_minmax(0,1fr)] gap-2">
                    <dt className="text-muted-foreground">Revision</dt>
                    <dd className="mono text-right text-muted-foreground">
                      {app.head.slice(0, 7)} · {app.dirty ? 'modified' : 'clean'}
                    </dd>
                  </div>
                </>
              )}
              <div className="grid grid-cols-[4rem_minmax(0,1fr)] gap-2">
                <dt className="text-muted-foreground">Worktree</dt>
                <dd className="min-w-0 text-right">
                  <RevealedValue value={app.worktreePath} className="mono text-muted-foreground" />
                </dd>
              </div>
            </dl>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button asChild size="sm">
                <a href={app.url} target="_blank" rel="noreferrer">
                  Open preview
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
          </article>
        ))}
      </CardContent>
    </Card>
    </TooltipProvider>
  )
}
