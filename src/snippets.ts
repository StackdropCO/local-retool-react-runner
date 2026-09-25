const WRITE_RE = /\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|REPLACE|UPSERT|GRANT|REVOKE)\b/i

function executableSql(sql: string): string {
  return sql
    .replace(/(\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$)[\s\S]*?\1/g, ' ')
    .replace(/'(?:''|[^'])*'/g, ' ')
    .replace(/"(?:""|[^"])*"/g, ' ')
    .replace(/`(?:``|[^`])*`/g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
}

export function isWrite(sql: string): boolean {
  return WRITE_RE.test(executableSql(sql))
}

export function buildSqlSnippet(binding: string, sql: string, params?: unknown[]): string {
  const args = params === undefined ? [sql] : [sql, params]
  return `return await ${binding}.query(${args.map((value) => JSON.stringify(value)).join(', ')})`
}

export function buildRestSnippet(binding: string, path: string[], args: unknown[]): string {
  const encoded = args.map((a) => JSON.stringify(a)).join(', ')
  return `return await ${binding}.${path.join('.')}(${encoded})`
}
