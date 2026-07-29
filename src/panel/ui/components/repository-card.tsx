import { useEffect, useState } from 'react'
import { FolderGit2, LoaderCircle, ScanSearch } from 'lucide-react'
import type { PanelApi } from '../lib/api'
import { Alert, AlertDescription } from './ui/alert'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
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

  useEffect(() => {
    if (initialRepoDir) setRepoDir(initialRepoDir)
  }, [initialRepoDir])

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
          <CardTitle className="flex items-center gap-2"><FolderGit2 aria-hidden="true" /> Apps repository</CardTitle>
          <CardDescription>Choose a checkout, then scan it for apps-as-code projects.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="repo-dir">Apps repository</label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="repo-dir"
                value={repoDir}
                onChange={(event) => setRepoDir(event.target.value)}
                placeholder="/path/to/apps-repo"
                className="font-mono text-xs"
              />
              <Button variant="outline" onClick={() => setBrowserOpen(true)}>Browse</Button>
              <Button disabled={!repoDir.trim() || scanning} onClick={() => scan()}>
                {scanning ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <ScanSearch aria-hidden="true" />}
                Scan apps
              </Button>
            </div>
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
