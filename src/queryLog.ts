import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { logsDir } from './paths.js'

export type QueryRecord = {
  ts: string
  endpoint: string
  resourceNames: string[]
  code: string
  ok: boolean
  error?: string
  rowCount?: number
  durationMs: number
}

export function logQuery(rec: QueryRecord, dir: string = logsDir()): void {
  mkdirSync(dir, { recursive: true })
  const day = rec.ts.slice(0, 10)
  appendFileSync(join(dir, `queries-${day}.jsonl`), JSON.stringify(rec) + '\n')
}
