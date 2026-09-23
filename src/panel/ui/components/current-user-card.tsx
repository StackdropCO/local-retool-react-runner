import { useEffect, useState } from 'react'
import type { CurrentUser, RetoolGroup } from '../lib/types'
import { Alert, AlertDescription } from './ui/alert'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Input } from './ui/input'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'

type CurrentUserCardProps = {
  currentUser: CurrentUser | null
  loadGroups(): Promise<RetoolGroup[]>
  onSave(currentUser: CurrentUser): Promise<void>
}

const copyUser = (user: CurrentUser): CurrentUser => ({
  ...user,
  groups: user.groups.map((group) => ({ ...group })),
  metadata: { ...user.metadata },
})

export function CurrentUserCard({ currentUser, loadGroups, onSave }: CurrentUserCardProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<CurrentUser | null>(null)
  const [metadata, setMetadata] = useState('{}')
  const [availableGroups, setAvailableGroups] = useState<RetoolGroup[] | null>(null)
  const [groupsError, setGroupsError] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || !currentUser) return
    setDraft(copyUser(currentUser))
    setMetadata(JSON.stringify(currentUser.metadata, null, 2))
    setError('')
    setGroupsError('')
    setAvailableGroups(null)
    void loadGroups()
      .then((groups) => setAvailableGroups(groups))
      .catch((cause) => setGroupsError(cause instanceof Error ? cause.message : String(cause)))
  }, [open, currentUser])

  const field = <Key extends keyof CurrentUser>(key: Key, value: CurrentUser[Key]) => {
    setDraft((current) => current ? { ...current, [key]: value } : current)
  }

  const toggleGroup = (group: RetoolGroup, selected: boolean) => {
    setDraft((current) => {
      if (!current) return current
      const groups = selected
        ? [...current.groups.filter((item) => item.id !== group.id), group]
        : current.groups.filter((item) => item.id !== group.id)
      return { ...current, groups }
    })
  }

  const save = async () => {
    if (!draft) return
    setError('')
    setSaving(true)
    try {
      const parsedMetadata = JSON.parse(metadata)
      if (!parsedMetadata || typeof parsedMetadata !== 'object' || Array.isArray(parsedMetadata)) {
        throw new Error('Metadata must be a JSON object')
      }
      await onSave({ ...draft, metadata: parsedMetadata })
      setOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Emulated current user</CardTitle>
          <Button variant="outline" size="sm" disabled={!currentUser} onClick={() => setOpen(true)}>
            Edit emulated user
          </Button>
        </CardHeader>
        <CardContent>
          {currentUser ? (
            <div className="grid gap-5 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
              <div>
                <div className="mb-2 text-xs font-semibold text-muted-foreground">Identity</div>
                <div className="text-sm font-medium">{currentUser.fullName || currentUser.email}</div>
                <div className="mono mt-1 truncate text-xs text-muted-foreground" title={currentUser.email}>{currentUser.email}</div>
              </div>
              <div>
                <div className="mb-2 text-xs font-semibold text-muted-foreground">Group membership</div>
                <div className="flex flex-wrap gap-1.5">
                  {currentUser.groups.length > 0
                    ? currentUser.groups.map((group, index) => <Badge key={`${group.id}-${index}`} variant="secondary">{group.name}</Badge>)
                    : <span className="text-xs text-muted-foreground">No groups</span>}
                </div>
              </div>
              <p className="border-t pt-3 text-xs text-muted-foreground sm:col-span-2">
                Used by useCurrentUser and backend req.user. Reload open previews after saving.
              </p>
            </div>
          ) : <p className="text-xs text-muted-foreground">Loading local persona…</p>}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(next) => { if (!saving) setOpen(next) }}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Mimic a Retool user</DialogTitle>
            <DialogDescription>Set the identity and groups exposed to the local app.</DialogDescription>
          </DialogHeader>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          {draft && (
            <div className="space-y-5">
              <section className="grid gap-3 sm:grid-cols-2">
                <LabeledInput label="Email" value={draft.email} type="email" onChange={(value) => field('email', value)} />
                <LabeledInput label="User ID" value={String(draft.id)} type="number" onChange={(value) => field('id', Number(value))} />
                <LabeledInput label="First name" value={draft.firstName} onChange={(value) => field('firstName', value)} />
                <LabeledInput label="Last name" value={draft.lastName} onChange={(value) => field('lastName', value)} />
                <LabeledInput label="Full name" value={draft.fullName} onChange={(value) => field('fullName', value)} />
                <LabeledInput label="Locale" value={draft.locale} onChange={(value) => field('locale', value)} />
                <LabeledInput label="SID" value={draft.sid} onChange={(value) => field('sid', value)} />
                <LabeledInput label="External identifier" value={draft.externalIdentifier ?? ''} onChange={(value) => field('externalIdentifier', value || null)} />
                <div className="sm:col-span-2">
                  <LabeledInput label="Profile photo URL" value={draft.profilePhotoUrl ?? ''} type="url" onChange={(value) => field('profilePhotoUrl', value || null)} />
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-semibold">Retool groups</h3>
                {groupsError && <Alert variant="destructive"><AlertDescription>{groupsError}</AlertDescription></Alert>}
                {availableGroups === null && !groupsError && <p className="text-xs text-muted-foreground">Loading groups from Retool MCP…</p>}
                {availableGroups && (
                  <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2" aria-label="Retool groups">
                    {availableGroups.map((group) => {
                      const checked = draft.groups.some((selected) => selected.id === group.id)
                      return (
                        <label key={group.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => toggleGroup(group, event.target.checked)}
                          />
                          <span>{group.name}</span>
                        </label>
                      )
                    })}
                    {availableGroups.length === 0 && <p className="p-2 text-xs text-muted-foreground">Retool returned no groups.</p>}
                  </div>
                )}
              </section>

              <section className="space-y-2">
                <label htmlFor="current-user-metadata" className="text-xs font-medium">Metadata (JSON)</label>
                <textarea
                  id="current-user-metadata"
                  aria-label="Metadata (JSON)"
                  value={metadata}
                  onChange={(event) => setMetadata(event.target.value)}
                  spellCheck={false}
                  className="mono min-h-24 w-full resize-y rounded-md border border-input bg-background p-3 text-xs leading-5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </section>
            </div>
          )}
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="outline" disabled={saving}>Cancel</Button></DialogClose>
            <Button type="button" onClick={() => void save()} disabled={saving || !draft}>
              {saving ? 'Saving…' : 'Save emulated user'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function LabeledInput({ label, value, onChange, type = 'text' }: {
  label: string
  value: string
  onChange(value: string): void
  type?: string
}) {
  return (
    <label className="space-y-1 text-xs font-medium">
      <span>{label}</span>
      <Input aria-label={label} type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}
