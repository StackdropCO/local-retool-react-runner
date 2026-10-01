import { useState } from 'react'
import { ExternalLink, FolderGit2, GitBranch, Radio, Square } from 'lucide-react'
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
        <span className={`block truncate rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`} tabIndex={0}>
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
    <Card className="overflow-hidden border-primary/10 xl:sticky xl:top-4">
      <CardHeader className="flex-row items-start justify-between space-y-0 border-b px-4 py-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Radio className="size-4 text-primary" aria-hidden="true" />
            Running previews
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">Local sessions ready to inspect.</p>
        </div>
        {!loading && apps.length > 0 && (
          <Badge variant="success" className="mt-0.5">
            <span className="size-1.5 rounded-full bg-emerald-600" aria-hidden="true" />
            {apps.length} live
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3 bg-control/55 p-3">
        {(error || actionError) && (
          <Alert variant="destructive">
            <AlertDescription>{error || actionError}</AlertDescription>
          </Alert>
        )}
        {loading && <p className="px-1 py-4 text-xs text-muted-foreground">Checking local sessions…</p>}
        {!loading && apps.length === 0 && (
          <div className="rounded-xl border border-dashed bg-card px-5 py-8 text-center">
            <span className="mx-auto flex size-9 items-center justify-center rounded-full bg-secondary text-primary">
              <Radio className="size-4" aria-hidden="true" />
            </span>
            <p className="mt-3 text-sm font-medium">No previews running</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Run an app to keep its local URL and source details here.</p>
          </div>
        )}
        {apps.map((app) => (
          <article key={app.port} className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <div className="p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-5" title={app.name}>{app.name}</p>
                  <a
                    href={app.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mono mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 transition-colors hover:bg-emerald-100"
                  >
                    <span className="size-1.5 rounded-full bg-emerald-600" aria-hidden="true" />
                    localhost:{app.port}
                    <ExternalLink className="size-3" aria-hidden="true" />
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
            </div>

            <dl className="space-y-2 border-y bg-control/70 px-3.5 py-3 text-xs">
              {app.branch && (
                <>
                  <div className="grid grid-cols-[5.25rem_minmax(0,1fr)] items-center gap-2">
                    <dt className="flex items-center gap-1.5 text-muted-foreground">
                      <GitBranch className="size-3.5" aria-hidden="true" /> Branch
                    </dt>
                    <dd className="min-w-0 text-right">
                      <RevealedValue value={app.branch} className="mono font-medium" />
                    </dd>
                  </div>
                  <div className="grid grid-cols-[5.25rem_minmax(0,1fr)] items-center gap-2">
                    <dt className="text-muted-foreground">Revision</dt>
                    <dd className={`mono text-right ${app.dirty ? 'font-medium text-amber-700' : 'text-muted-foreground'}`}>
                      {app.head.slice(0, 7)} · {app.dirty ? 'modified' : 'clean'}
                    </dd>
                  </div>
                </>
              )}
              <div className="grid grid-cols-[5.25rem_minmax(0,1fr)] items-center gap-2">
                <dt className="flex items-center gap-1.5 text-muted-foreground">
                  <FolderGit2 className="size-3.5" aria-hidden="true" /> Source
                </dt>
                <dd className="min-w-0 text-right">
                  <RevealedValue value={app.worktreePath} className="mono text-muted-foreground" />
                </dd>
              </div>
            </dl>

            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 p-3">
              <Button asChild size="sm" className="w-full">
                <a href={app.url} target="_blank" rel="noreferrer">
                  <ExternalLink aria-hidden="true" />
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
                <Square aria-hidden="true" />
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
