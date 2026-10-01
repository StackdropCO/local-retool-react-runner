import { useEffect, useState } from 'react'
import type { PanelApi } from '../lib/api'
import { Alert, AlertDescription } from './ui/alert'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Input } from './ui/input'
import { DirectoryBrowser } from './directory-browser'

type RepositoryCardProps = {
  api: PanelApi
  initialRepoDir: string
  onScan(repoDir: string): Promise<void>
}

export function RepositoryCard({ api, initialRepoDir, onScan }: RepositoryCardProps) {
  const [repoDir, setRepoDir] = useState(initialRepoDir)
  const [browserOpen, setBrowserOpen] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { setRepoDir(initialRepoDir) }, [initialRepoDir])

  const scan = async (dir = repoDir) => {
    setScanning(true)
    setError('')
    try {
      await onScan(dir.trim())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setScanning(false)
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Protected apps Git repository</CardTitle>
          <p className="text-xs text-muted-foreground">
            Use Git branches and worktrees from an Apps as Code repository. The Retool CLI checkout remains the resource and authentication bridge.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              aria-label="Git apps repository directory"
              value={repoDir}
              onChange={(event) => setRepoDir(event.target.value)}
              placeholder="/path/to/retool-ops"
              className="mono text-xs"
            />
            <Button variant="outline" onClick={() => setBrowserOpen(true)}>Browse</Button>
            <Button disabled={!repoDir.trim() || scanning} onClick={() => void scan()}>
              {scanning ? 'Scanning…' : 'Use Git repository'}
            </Button>
          </div>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        </CardContent>
      </Card>
      <DirectoryBrowser
        api={api}
        open={browserOpen}
        initialDir={repoDir}
        onOpenChange={setBrowserOpen}
        onSelect={(dir) => {
          setRepoDir(dir)
          setBrowserOpen(false)
          void scan(dir)
        }}
      />
    </>
  )
}
