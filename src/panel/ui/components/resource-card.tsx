import { useState } from 'react'
import type { PanelApi } from '../lib/api'
import type { Resource } from '../lib/types'
import { Alert, AlertDescription } from './ui/alert'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'

export function ResourceCard({ api }: { api: PanelApi }) {
  const [resources, setResources] = useState<Resource[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      setResources((await api.resources()).resources)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>
          Resources
          {resources ? <span className="font-normal text-muted-foreground"> ({resources.length})</span> : null}
        </CardTitle>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : resources ? 'Refresh' : 'Load'}
        </Button>
      </CardHeader>
      <CardContent>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {!error && resources === null && <p className="text-xs text-muted-foreground">Not loaded.</p>}
        {!error && resources?.length === 0 && <p className="text-xs text-muted-foreground">None returned.</p>}
        {resources && resources.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Queryable</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {resources.map((resource) => (
                <TableRow key={resource.name}>
                  <TableCell>{resource.displayName}</TableCell>
                  <TableCell className="mono text-xs text-muted-foreground">{resource.type}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {resource.readable ? (resource.note ? `conditional — ${resource.note}` : 'yes') : 'no'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
