import { useEffect, useState } from 'react'
import { ArrowUp, Folder, FolderCheck, LoaderCircle } from 'lucide-react'
import type { PanelApi } from '../lib/api'
import type { BrowseResult } from '../lib/types'
import { Alert, AlertDescription } from './ui/alert'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'

type DirectoryBrowserProps = {
  api: PanelApi
  open: boolean
  initialDir: string
  onOpenChange(open: boolean): void
  onSelect(dir: string): void
}

export function DirectoryBrowser({ api, open, initialDir, onOpenChange, onSelect }: DirectoryBrowserProps) {
  const [result, setResult] = useState<BrowseResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const browse = async (dir: string) => {
    setLoading(true)
    setError('')
    try {
      setResult(await api.browse(dir))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) void browse(initialDir)
  }, [open, initialDir])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Choose apps repository</DialogTitle>
          <DialogDescription>Navigate to the folder containing your Retool apps checkout.</DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border">
          <div className="flex min-h-11 items-center gap-2 border-b bg-muted/60 px-3 font-mono text-xs">
            {loading && <LoaderCircle className="animate-spin" aria-hidden="true" />}
            <span className="min-w-0 truncate">{result?.dir || initialDir || 'Home directory'}</span>
          </div>
          <div className="max-h-72 overflow-y-auto p-1">
            {error && <div className="p-2"><Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert></div>}
            {!error && result?.parent && (
              <button className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => browse(result.parent!)}>
                <ArrowUp className="size-4 text-muted-foreground" aria-hidden="true" /> Parent folder
              </button>
            )}
            {!error && result?.dirs.map((dir) => {
              const child = `${result.dir.replace(/\/$/, '')}/${dir}`
              return (
                <button key={child} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => browse(child)}>
                  <Folder className="size-4 text-muted-foreground" aria-hidden="true" /> {dir}
                </button>
              )
            })}
            {!loading && !error && result?.dirs.length === 0 && <p className="p-3 text-sm text-muted-foreground">No subfolders.</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!result}
            onClick={() => {
              if (result) onSelect(result.dir)
            }}
          >
            <FolderCheck aria-hidden="true" /> Use this folder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

