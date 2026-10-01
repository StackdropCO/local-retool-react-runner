import { useEffect, useState } from 'react'
import type { RunInput, RunResult, ScannedApp } from '../lib/types'
import { PanelApiError, type MissingRetoolResource } from '../lib/api'
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
import { Input } from './ui/input'
import { Switch } from './ui/switch'

type AppCardProps = {
  app: ScannedApp
  onRun(input: RunInput): Promise<RunResult>
  onPull(checkoutDir: string): Promise<unknown>
  onPush(checkoutDir: string, message: string): Promise<unknown>
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

const resultText = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value, null, 2)

export function AppCard({ app, onRun, onPull, onPush }: AppCardProps) {
  const worktrees = app.worktrees ?? NO_WORKTREES
  const initialWorktree = worktrees.find((worktree) => worktree.appPath === app.path)
    ?? worktrees.find((worktree) => worktree.branch === app.branch)
    ?? worktrees[0]
  const [worktreePath, setWorktreePath] = useState(initialWorktree?.worktreePath || '')
  const [environment, setEnvironment] = useState<'staging' | 'production'>('staging')
  const [writes, setWrites] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [productionConfirmOpen, setProductionConfirmOpen] = useState(false)
  const [running, setRunning] = useState(false)
  const [pushOpen, setPushOpen] = useState(false)
  const [pushMessage, setPushMessage] = useState('')
  const [pushing, setPushing] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [pushResult, setPushResult] = useState('')
  const [previewUrl, setPreviewUrl] = useState('')
  const [error, setError] = useState<{ message: string; missingResources: MissingRetoolResource[] } | null>(null)

  useEffect(() => {
    const next = worktrees.find((worktree) => worktree.appPath === app.path)
      ?? worktrees.find((worktree) => worktree.branch === app.branch)
      ?? worktrees[0]
    setWorktreePath(next?.worktreePath || '')
  }, [app.path, app.branch, worktrees])

  const selectedWorktree = worktrees.find((worktree) => worktree.worktreePath === worktreePath)
  const resourceSummary = app.resources.length
    ? app.resources.map((resource) => resource.displayName).join(', ')
    : 'No resources'

  const run = async () => {
    const previewWindow = typeof window !== 'undefined' && !/jsdom/i.test(window.navigator.userAgent)
      ? window.open('about:blank', '_blank')
      : null
    setRunning(true)
    setError(null)
    try {
      if (!selectedWorktree) throw new Error('Select an app source directory before running this app.')
      const result = await onRun({
        appPath: selectedWorktree.appPath,
        worktreePath: selectedWorktree.worktreePath,
        name: app.name,
        branch: selectedWorktree.branch,
        environment,
        writes,
      })
      setPreviewUrl(result.url)
      if (previewWindow) previewWindow.location.replace(result.url)
    } catch (cause) {
      previewWindow?.close()
      setError({
        message: cause instanceof Error ? cause.message : String(cause),
        missingResources: cause instanceof PanelApiError ? cause.details.missingResources ?? [] : [],
      })
    } finally {
      setRunning(false)
    }
  }

  const requestRun = () => {
    if (environment === 'production') setProductionConfirmOpen(true)
    else void run()
  }

  const push = async () => {
    if (!selectedWorktree || !pushMessage.trim()) return
    setPushOpen(false)
    setPushing(true)
    setError(null)
    setPushResult('')
    try {
      const result = await onPush(selectedWorktree.worktreePath, pushMessage.trim())
      setPushResult(resultText(result))
      setPushMessage('')
    } catch (cause) {
      setError({
        message: cause instanceof Error ? cause.message : String(cause),
        missingResources: [],
      })
    } finally {
      setPushing(false)
    }
  }

  const pull = async () => {
    if (!selectedWorktree) return
    setPulling(true)
    setError(null)
    setPushResult('')
    try {
      const result = await onPull(selectedWorktree.worktreePath)
      setPushResult(resultText(result))
    } catch (cause) {
      setError({
        message: cause instanceof Error ? cause.message : String(cause),
        missingResources: [],
      })
    } finally {
      setPulling(false)
    }
  }

  return (
    <div className="border-b px-5 py-4 last:border-b-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-sm font-semibold" title={app.name}>{app.name}</h3>
            <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {app.group}
            </span>
          </div>
          <p
            className="mt-1 truncate text-xs text-muted-foreground"
            title={`${app.endpoints.length} endpoints · ${resourceSummary}`}
          >
            {app.endpoints.length} endpoint{app.endpoints.length === 1 ? '' : 's'}
            {` · ${resourceSummary}`}
          </p>
          <p className="mono mt-1 truncate text-[11px] text-muted-foreground/75" title={app.path}>
            {app.path}
          </p>
        </div>

        <div className="mt-0.5 flex shrink-0 gap-2">
          {selectedWorktree?.cliCheckout && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void pull()}
                disabled={pulling || pushing}
                aria-label={`Pull latest for ${app.name}`}
              >
                {pulling ? 'Pulling…' : 'Pull'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPushOpen(true)}
                disabled={pushing || pulling}
                aria-label={`Push preview for ${app.name}`}
              >
                {pushing ? 'Pushing…' : 'Push preview'}
              </Button>
            </>
          )}
          <Button
            size="sm"
            onClick={requestRun}
            disabled={running || !selectedWorktree}
            aria-label={`Run ${app.name}`}
          >
            {running ? 'Starting…' : 'Run'}
          </Button>
        </div>
      </div>

      <div className="mt-3 grid items-end gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_auto]">
        <label className="min-w-0 space-y-1">
          <span className="block text-xs font-semibold text-muted-foreground">
            Source
          </span>
          <select
            aria-label={`Source for ${app.name}`}
            title={selectedWorktree?.worktreePath}
            value={worktreePath}
            onChange={(event) => setWorktreePath(event.target.value)}
            className="mono h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring"
          >
            {worktrees.length ? (
              worktrees.map((item) => (
                <option key={item.worktreePath} value={item.worktreePath} title={item.worktreePath}>
                  {item.head
                    ? `${branchLabel(item.branch || 'detached', app.branch)} · ${item.head.slice(0, 7)} · ${item.dirty ? 'modified' : 'clean'}`
                    : 'Retool CLI checkout'}
                </option>
              ))
            ) : (
              <option value="">no app source found</option>
            )}
          </select>
        </label>

        <label className="space-y-1">
          <span className="block text-xs font-semibold text-muted-foreground">
            Environment
          </span>
          <select
            aria-label={`Environment for ${app.name}`}
            value={environment}
            onChange={(event) => setEnvironment(event.target.value as 'staging' | 'production')}
            className={`mono h-9 w-full rounded-md border bg-background px-2.5 text-xs outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring ${
              environment === 'production' ? 'border-destructive text-destructive' : 'border-input'
            }`}
          >
            <option value="staging">staging</option>
            <option value="production">production</option>
          </select>
        </label>

        <div className="space-y-1">
          <span className="block text-xs font-semibold text-muted-foreground">
            Access
          </span>
          <label className="flex h-9 min-w-32 items-center gap-2 rounded-md border border-input bg-background px-2.5 text-xs text-muted-foreground">
            <Switch
              aria-label={`Enable writes for ${app.name}`}
              checked={writes}
              onCheckedChange={(checked) => (checked ? setConfirmOpen(true) : setWrites(false))}
            />
            <span>{writes ? 'Writes enabled' : 'Read only'}</span>
          </label>
        </div>
      </div>
      {error && (
        <Alert className="mt-2" variant="destructive">
          <AlertDescription>
            <p>{error.message}</p>
            {error.missingResources.length > 0 && (
              <p className="mt-1">
                Missing Retool resources:{' '}
                {error.missingResources.map((resource, index) => (
                  <span key={resource.resourceId}>
                    {index > 0 && ', '}
                    <a
                      href={resource.url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium underline underline-offset-2"
                    >
                      {resource.name}
                    </a>
                  </span>
                ))}
              </p>
            )}
          </AlertDescription>
        </Alert>
      )}
      {pushResult && <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">{pushResult}</pre>}
      {previewUrl && (
        <Alert className="mt-2">
          <AlertDescription>
            Preview ready.{' '}
            <a href={previewUrl} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2">Open preview</a>
          </AlertDescription>
        </Alert>
      )}

      <AlertDialog open={pushOpen} onOpenChange={setPushOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Push {app.name} to a Retool preview?</AlertDialogTitle>
            <AlertDialogDescription>
              Retool will validate and push the selected source checkout, then wait for this app's preview build. This does not publish the app live.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            aria-label={`Push message for ${app.name}`}
            value={pushMessage}
            onChange={(event) => setPushMessage(event.target.value)}
            placeholder="Describe the completed changes"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={!pushMessage.trim()} onClick={() => void push()}>Push preview</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enable writes in {environment} for {app.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Resource mutations will run against the selected Retool {environment} environment.
              Local API resources continue to use their private local configuration.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => setWrites(true)}>Enable writes</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={productionConfirmOpen} onOpenChange={setProductionConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run {app.name} in production?</AlertDialogTitle>
            <AlertDialogDescription>
              Retool resource calls will use production. This preview is {writes ? 'write-enabled' : 'read-only'}.
              Local API resources continue to use their private local configuration.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void run()}>Run in production</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
