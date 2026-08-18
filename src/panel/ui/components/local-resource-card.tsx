import { useState } from 'react'
import type { PanelStatus } from '../lib/types'
import type { LocalResourceSummary } from '../lib/types'
import type { PanelApi } from '../lib/api'
import { Alert, AlertDescription } from './ui/alert'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'

type LocalResourceCardProps = {
  status: PanelStatus | null
  api: PanelApi
  onSaved(): Promise<void>
}

export function LocalResourceCard({ status, api, onSaved }: LocalResourceCardProps) {
  const resources = status?.localResources ?? []
  const [selected, setSelected] = useState<LocalResourceSummary | null>(null)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const openEditor = async (resource: LocalResourceSummary) => {
    setSelected(resource)
    setContent('')
    setError('')
    setLoading(true)
    try {
      setContent((await api.loadLocalResourceSpec(resource.resourceId)).content)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }

  const save = async () => {
    if (!selected) return
    setError('')
    setSaving(true)
    try {
      await api.saveLocalResourceSpec(selected.resourceId, content)
      await onSaved()
      setSelected(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            Local API specs
            <span className="font-normal text-muted-foreground"> ({resources.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {status?.localResourceError && (
            <Alert variant="destructive">
              <AlertDescription>{status.localResourceError}</AlertDescription>
            </Alert>
          )}
          {resources.length === 0 && !status?.localResourceError ? (
            <p className="text-xs text-muted-foreground">
              None configured. Copy resources.example to .local-resources and replace the fake values.
            </p>
          ) : resources.length > 0 ? (
            <div className="space-y-3">
              {resources.map((resource) => (
                <div key={resource.resourceId} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{resource.binding}</div>
                    <div className="mono mt-0.5 truncate text-xs text-muted-foreground">
                      {resource.specFile} · #{resource.specHash}
                    </div>
                    <div className="mono mt-1 break-all text-[11px] text-muted-foreground">{resource.resourceId}</div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => void openEditor(resource)}>
                    Edit <span className="sr-only">{resource.binding}</span>
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={selected !== null} onOpenChange={(open) => { if (!open && !saving) setSelected(null) }}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Edit {selected?.binding}</DialogTitle>
            <DialogDescription>
              {selected?.specFile} · YAML or JSON · validated before the private file is replaced
            </DialogDescription>
          </DialogHeader>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <label htmlFor="local-openapi-editor" className="sr-only">
            OpenAPI document for {selected?.binding}
          </label>
          <textarea
            id="local-openapi-editor"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            disabled={loading || saving}
            spellCheck={false}
            className="mono min-h-[55vh] w-full resize-y rounded-md border border-input bg-background p-3 text-xs leading-5 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={saving}>Cancel</Button>
            </DialogClose>
            <Button type="button" onClick={() => void save()} disabled={loading || saving}>
              {saving ? 'Saving…' : 'Validate and save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
