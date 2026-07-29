import { useState } from 'react'
import { Database, LoaderCircle, RefreshCw } from 'lucide-react'
import type { PanelApi } from '../lib/api'
import type { Resource } from '../lib/types'
import { Alert, AlertDescription } from './ui/alert'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
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
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2"><Database aria-hidden="true" /> Resources</CardTitle>
          <CardDescription className="mt-1">Check which connected resources can be queried locally.</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
          {resources ? 'Refresh' : 'Load'}
        </Button>
      </CardHeader>
      <CardContent>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        {!error && resources === null && <p className="text-sm text-muted-foreground">Resources load only when requested.</p>}
        {!error && resources?.length === 0 && <p className="text-sm text-muted-foreground">No resources were returned by this MCP endpoint.</p>}
        {resources && resources.length > 0 && (
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Queryable</TableHead></TableRow></TableHeader>
            <TableBody>
              {resources.map((resource) => (
                <TableRow key={resource.name}>
                  <TableCell className="font-medium">{resource.displayName}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{resource.type}</TableCell>
                  <TableCell>
                    <Badge variant={resource.readable ? (resource.note ? 'warning' : 'success') : 'outline'}>
                      {resource.readable ? (resource.note ? 'Conditional' : 'Yes') : 'No'}
                    </Badge>
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

