import { describe, it, expect } from 'vitest'
import { isWrite, buildSqlSnippet, buildRestSnippet } from './snippets.js'

describe('isWrite', () => {
  it('flags writes and clears reads, ignoring whitespace/comments/case', () => {
    expect(isWrite('  SELECT * FROM t')).toBe(false)
    expect(isWrite('with x as (select 1) select * from x')).toBe(false)
    expect(isWrite('insert into shift_ops.t values (1)')).toBe(true)
    expect(isWrite('  -- note\n UPDATE t SET a=1')).toBe(true)
    expect(isWrite('DELETE FROM t')).toBe(true)
    expect(isWrite('/* c */ merge into t ...')).toBe(true)
  })
})

describe('buildSqlSnippet', () => {
  it('json-encodes the sql so quotes/newlines survive', () => {
    const s = buildSqlSnippet('databricks', "SELECT 'a\nb'")
    expect(s).toBe('return await databricks.query(' + JSON.stringify("SELECT 'a\nb'") + ')')
  })

  it('forwards positional parameters as the second query argument', () => {
    const s = buildSqlSnippet('databricks', 'SELECT * FROM t WHERE day = ? AND geo = ?', ['2026-08-18', 'lhr'])
    expect(s).toBe(
      'return await databricks.query("SELECT * FROM t WHERE day = ? AND geo = ?", ["2026-08-18","lhr"])',
    )
  })
})

describe('buildRestSnippet', () => {
  it('joins the property path and json-encodes each arg', () => {
    const s = buildRestSnippet('connectteamapi', ['schedulev1', 'getShifts'], [123, { limit: 200 }])
    expect(s).toBe('return await connectteamapi.schedulev1.getShifts(123, {"limit":200})')
  })
})
