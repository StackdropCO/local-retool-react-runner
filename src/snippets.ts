const WRITE_RE = /^(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|REPLACE|UPSERT|GRANT|REVOKE)\b/i

function stripLeading(sql: string): string {
  let s = sql
  for (;;) {
    const before = s
    s = s.replace(/^\s+/, '')
    s = s.replace(/^--[^\n]*\n?/, '')
    s = s.replace(/^\/\*[\s\S]*?\*\//, '')
    if (s === before) return s
  }
}

export function isWrite(sql: string): boolean {
  return WRITE_RE.test(stripLeading(sql))
}

export function buildSqlSnippet(binding: string, sql: string, params?: unknown[]): string {
  const args = params === undefined ? [sql] : [sql, params]
  return `return await ${binding}.query(${args.map((value) => JSON.stringify(value)).join(', ')})`
}

export function buildRestSnippet(binding: string, path: string[], args: unknown[]): string {
  const encoded = args.map((a) => JSON.stringify(a)).join(', ')
  return `return await ${binding}.${path.join('.')}(${encoded})`
}
