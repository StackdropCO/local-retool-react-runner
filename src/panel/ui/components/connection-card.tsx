import { useEffect, useState } from 'react'
import type { PanelStatus } from '../lib/types'
import { Alert, AlertDescription } from './ui/alert'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Input } from './ui/input'

type ConnectionCardProps = {
  status: PanelStatus | null
  onSave(mcpUrl: string): Promise<void>
  onAuthorize(): Promise<void>
}

export function ConnectionCard({ status, onSave, onAuthorize }: ConnectionCardProps) {
  const [mcpUrl, setMcpUrl] = useState('')
  const [action, setAction] = useState<'save' | 'authorize' | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (status?.mcpUrl) setMcpUrl(status.mcpUrl)
  }, [status?.mcpUrl])

  // Success needs no announcement — the header status already reflects it.
  const runAction = async (kind: 'save' | 'authorize', operation: () => Promise<void>) => {
    setAction(kind)
    setError('')
    try {
      await operation()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setAction(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>MCP endpoint</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="mcp-url"
            type="url"
            aria-label="MCP endpoint URL"
            value={mcpUrl}
            onChange={(event) => setMcpUrl(event.target.value)}
            placeholder="https://your-org.retool.com/mcp"
            className="mono text-xs"
          />
          <Button
            variant="outline"
            disabled={!mcpUrl.trim() || action !== null}
            onClick={() => runAction('save', () => onSave(mcpUrl.trim()))}
          >
            {action === 'save' ? 'Saving…' : 'Save'}
          </Button>
          <Button disabled={!mcpUrl.trim() || action !== null} onClick={() => runAction('authorize', onAuthorize)}>
            {action === 'authorize' ? 'Authorizing…' : 'Authorize'}
          </Button>
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
