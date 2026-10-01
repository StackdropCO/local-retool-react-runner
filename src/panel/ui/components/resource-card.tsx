import type { Resource } from '../lib/types'
import { Alert, AlertDescription } from './ui/alert'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'

type ResourceCardProps = {
  resources: Resource[] | null
  loading: boolean
  error: string
  onRefresh(): Promise<void>
}

export function ResourceCard({ resources, loading, error, onRefresh }: ResourceCardProps) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>
          Resources
          {resources ? <span className="font-normal text-muted-foreground"> ({resources.length})</span> : null}
        </CardTitle>
        <Button variant="outline" size="sm" onClick={() => void onRefresh()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </Button>
      </CardHeader>
      <CardContent>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {!error && resources === null && <p className="text-sm text-muted-foreground" role="status">Loading resources…</p>}
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
                    {resource.localConfigured
                      ? `local — ${resource.note}`
                      : resource.readable ? (resource.note ? `conditional — ${resource.note}` : 'yes') : 'no'}
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
