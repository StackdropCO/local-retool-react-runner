import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { logQuery } from './queryLog.js'

describe('logQuery', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'qlog-')) })

  it('appends one JSONL line per call into a date-named file', () => {
    logQuery({ ts: '2026-07-16T10:00:00.000Z', endpoint: 'getShiftTimeline', resourceNames: ['Databricks'], code: 'return await databricks.query("SELECT 1")', ok: true, rowCount: 1, durationMs: 42 }, dir)
    logQuery({ ts: '2026-07-16T10:00:01.000Z', endpoint: 'getShiftTimeline', resourceNames: ['Lakebase'], code: 'return await lakebaseRetoolOltp.query("SELECT 2")', ok: false, error: 'boom', durationMs: 5 }, dir)
    const files = readdirSync(dir)
    expect(files).toEqual(['queries-2026-07-16.jsonl'])
    const lines = readFileSync(join(dir, files[0]), 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]).ok).toBe(true)
    expect(JSON.parse(lines[1]).error).toBe('boom')
  })
})
