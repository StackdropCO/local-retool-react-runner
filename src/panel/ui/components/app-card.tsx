import { useEffect, useState } from 'react'
import { GitBranch, LoaderCircle, Play, ShieldAlert } from 'lucide-react'
import type { RunInput, ScannedApp } from '../lib/types'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog'
import { Alert, AlertDescription } from './ui/alert'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent } from './ui/card'
import { Switch } from './ui/switch'

type AppCardProps = {
  app: ScannedApp
  onRun(input: RunInput): Promise<void>
}

export function AppCard({ app, onRun }: AppCardProps) {
  const branches = app.branches.length ? app.branches : app.branch ? [app.branch] : []
  const [branch, setBranch] = useState(app.branch || branches[0] || '')
  const [writes, setWrites] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => setBranch(app.branch || branches[0] || ''), [app.path, app.branch])

  const run = async () => {
    setRunning(true)
    setError('')
    try {
      await onRun({ appPath: app.path, name: app.name, branch, writes })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setRunning(false)
    }
  }

  return (
    <Card className={writes ? 'border-amber-300 bg-amber-50/35' : undefined}>
      <CardContent className="p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">{app.name}</h3>
              <Badge variant="secondary">{app.group}</Badge>
              {writes && <Badge variant="warning"><ShieldAlert aria-hidden="true" /> Writes enabled</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">
              {app.endpoints.length} endpoint{app.endpoints.length === 1 ? '' : 's'}
              {app.resources.length ? ` · ${app.resources.map((resource) => resource.displayName).join(', ')}` : ' · No resources declared'}
            </p>
            <p className="truncate font-mono text-xs text-muted-foreground" title={app.path}>{app.path}</p>
          </div>

          <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-end">
            <div className="grid gap-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor={`branch-${app.path}`}>
                <span className="inline-flex items-center gap-1"><GitBranch className="size-3" aria-hidden="true" /> Branch for {app.name}</span>
              </label>
              <select
                id={`branch-${app.path}`}
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
                className="h-9 min-w-40 rounded-md border border-input bg-background px-3 text-sm shadow-sm outline-none focus:ring-2 focus:ring-ring"
              >
                {branches.length ? branches.map((item) => <option key={item} value={item}>{item}</option>) : <option value="">Current files</option>}
              </select>
            </div>
            <div className="flex h-9 items-center gap-2">
              <Switch
                aria-label={`Enable writes for ${app.name}`}
                checked={writes}
                onCheckedChange={(checked) => checked ? setConfirmOpen(true) : setWrites(false)}
              />
              <span className="text-xs text-muted-foreground">Writes</span>
            </div>
            <Button onClick={run} disabled={running} aria-label={`Run ${app.name}`}>
              {running ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Play aria-hidden="true" />}
              Run
            </Button>
          </div>
        </div>
        {error && <Alert className="mt-3" variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enable write access for {app.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This app can modify production data through connected resources. Enable writes only when you intend to persist changes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep read-only</AlertDialogCancel>
            <AlertDialogAction onClick={() => setWrites(true)}>Enable writes</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
