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

const NO_WORKTREES: ScannedApp['worktrees'] = []

/**
 * Branch names here often share an owner prefix, so showing it wastes the
 * width that the distinguishing part needs. Drop the
 * prefix for display; the full name stays as the option's value and title.
 */
function branchLabel(name: string, current?: string | null) {
  const short = name.includes('/') ? name.slice(name.indexOf('/') + 1) : name
  return name === current ? `${short} (current)` : short
}

export function AppCard({ app, onRun }: AppCardProps) {
  const worktrees = app.worktrees ?? NO_WORKTREES
  const initialWorktree = worktrees.find((worktree) => worktree.appPath === app.path)
    ?? worktrees.find((worktree) => worktree.branch === app.branch)
    ?? worktrees[0]
  const [worktreePath, setWorktreePath] = useState(initialWorktree?.worktreePath || '')
  const [writes, setWrites] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const next = worktrees.find((worktree) => worktree.appPath === app.path)
      ?? worktrees.find((worktree) => worktree.branch === app.branch)
      ?? worktrees[0]
    setWorktreePath(next?.worktreePath || '')
  }, [app.path, app.branch, worktrees])

  const selectedWorktree = worktrees.find((worktree) => worktree.worktreePath === worktreePath)

  const run = async () => {
    setRunning(true)
    setError('')
    try {
      if (!selectedWorktree) throw new Error('Select a registered worktree before running this app.')
      await onRun({
        appPath: selectedWorktree.appPath,
        worktreePath: selectedWorktree.worktreePath,
        name: app.name,
        branch: selectedWorktree.branch || '',
        writes,
      })
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
            aria-label={`Worktree for ${app.name}`}
            title={selectedWorktree?.worktreePath}
            value={worktreePath}
            onChange={(event) => setWorktreePath(event.target.value)}
            className="mono h-8 w-72 rounded-[4px] border border-input bg-card px-2 text-xs outline-none focus:border-ring"
          >
            {worktrees.length ? (
              worktrees.map((item) => (
                <option key={item.worktreePath} value={item.worktreePath} title={item.worktreePath}>
                  {branchLabel(item.branch || 'detached', app.branch)} · {item.head.slice(0, 7)} · {item.dirty ? 'modified' : 'clean'}
                </option>
              ))
            ) : (
              <option value="">no registered worktree</option>
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

          <Button size="sm" onClick={run} disabled={running || !selectedWorktree} aria-label={`Run ${app.name}`}>
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
