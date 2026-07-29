import { useEffect, useState } from 'react'
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
import { Button } from './ui/button'
import { Switch } from './ui/switch'

type AppCardProps = {
  app: ScannedApp
  onRun(input: RunInput): Promise<void>
}

/**
 * Branch names here nearly all share an owner prefix ("arsanymiladext/…"), so
 * showing it wastes the width that the distinguishing part needs. Drop the
 * prefix for display; the full name stays as the option's value and title.
 */
function branchLabel(name: string, current?: string | null) {
  const short = name.includes('/') ? name.slice(name.indexOf('/') + 1) : name
  return name === current ? `${short} (current)` : short
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
    <div className="border-b px-4 py-3 last:border-b-0">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <h3 className="truncate text-sm font-medium">{app.name}</h3>
            <span className="text-xs text-muted-foreground">{app.group}</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {app.endpoints.length} endpoint{app.endpoints.length === 1 ? '' : 's'}
            {app.resources.length ? ` · ${app.resources.map((resource) => resource.displayName).join(', ')}` : ' · no resources'}
          </p>
          <p className="mono mt-0.5 truncate text-xs text-muted-foreground/80" title={app.path}>
            {app.path}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <select
            aria-label={`Branch for ${app.name}`}
            title={branch || undefined}
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
            className="mono h-8 w-72 rounded-[4px] border border-input bg-card px-2 text-xs outline-none focus:border-ring"
          >
            {branches.length ? (
              branches.map((item) => (
                <option key={item} value={item} title={item}>
                  {branchLabel(item, app.branch)}
                </option>
              ))
            ) : (
              <option value="">current files</option>
            )}
          </select>

          {/* Writes gets exactly one signal here: the switch (plus a confirm). */}
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Switch
              aria-label={`Enable writes for ${app.name}`}
              checked={writes}
              onCheckedChange={(checked) => (checked ? setConfirmOpen(true) : setWrites(false))}
            />
            writes
          </label>

          <Button size="sm" onClick={run} disabled={running} aria-label={`Run ${app.name}`}>
            {running ? 'Starting…' : 'Run'}
          </Button>
        </div>
      </div>
      {error && (
        <Alert className="mt-2" variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enable writes for {app.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Writes go to production resources. There is no sandbox.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => setWrites(true)}>Enable writes</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
