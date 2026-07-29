import { useEffect, useState } from 'react'
import { CheckCircle2, Link2, LoaderCircle, LogIn } from 'lucide-react'
import type { PanelStatus } from '../lib/types'
import { Alert, AlertDescription } from './ui/alert'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Input } from './ui/input'

type ConnectionCardProps = {
  status: PanelStatus | null
  onSave(mcpUrl: string): Promise<void>
  onAuthorize(): Promise<void>
}

export function ConnectionCard({ status, onSave, onAuthorize }: ConnectionCardProps) {
  const [mcpUrl, setMcpUrl] = useState('')
  const [action, setAction] = useState<'save' | 'authorize' | null>(null)
  const [message, setMessage] = useState<{ text: string; kind: 'success' | 'error' } | null>(null)

  useEffect(() => {
    if (status?.mcpUrl) setMcpUrl(status.mcpUrl)
  }, [status?.mcpUrl])

  const runAction = async (kind: 'save' | 'authorize', operation: () => Promise<void>) => {
    setAction(kind)
    setMessage(null)
    try {
      await operation()
      setMessage({
        text: kind === 'save' ? 'MCP endpoint saved.' : 'MCP connection authorized.',
        kind: 'success',
      })
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : String(error), kind: 'error' })
    } finally {
      setAction(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2"><Link2 aria-hidden="true" /> MCP connection</CardTitle>
            <CardDescription className="mt-1">Save your organization endpoint, then authorize this machine.</CardDescription>
          </div>
          {status?.connected && <CheckCircle2 className="size-5 text-emerald-600" aria-label="MCP session is active" />}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2">
          <label className="text-sm font-medium" htmlFor="mcp-url">MCP endpoint URL</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="mcp-url"
              type="url"
              value={mcpUrl}
              onChange={(event) => setMcpUrl(event.target.value)}
              placeholder="https://your-org.retool.com/mcp"
              className="font-mono text-xs"
            />
            <Button
              variant="outline"
              disabled={!mcpUrl.trim() || action !== null}
              onClick={() => runAction('save', () => onSave(mcpUrl.trim()))}
            >
              {action === 'save' && <LoaderCircle className="animate-spin" aria-hidden="true" />}
              Save URL
            </Button>
            <Button
              disabled={!mcpUrl.trim() || action !== null}
              onClick={() => runAction('authorize', onAuthorize)}
            >
              {action === 'authorize' ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <LogIn aria-hidden="true" />}
              Authorize
            </Button>
          </div>
        </div>
        {message && (
          <Alert variant={message.kind === 'error' ? 'destructive' : 'success'}>
            <AlertDescription>{message.text}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
