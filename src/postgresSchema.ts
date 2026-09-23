export type SchemaQuery = (sql: string) => Promise<Array<Record<string, unknown>>>

export type CapturePostgresSchemaOptions = {
  runSql: SchemaQuery
  schemas?: string[]
}

const identifier = (value: string) => `"${value.replace(/"/g, '""')}"`
const literal = (value: string) => `'${value.replace(/'/g, "''")}'`
const qualified = (schema: string, name: string) => `${identifier(schema)}.${identifier(name)}`

function text(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  if (typeof value !== 'string') throw new Error(`PostgreSQL schema row is missing string field ${key}`)
  return value
}

function schemaFilter(schemas: string[]): string {
  if (!schemas.length) throw new Error('At least one PostgreSQL schema is required')
  for (const schema of schemas) {
    if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(schema)) throw new Error(`Invalid PostgreSQL schema name: ${schema}`)
  }
  return schemas.map(literal).join(', ')
}

/**
 * Capture a portable, schema-only PostgreSQL fixture through any read-only SQL
 * transport, including createLiveSqlRunner(). Production rows are never read.
 */
export async function capturePostgresSchema(
  options: CapturePostgresSchemaOptions,
): Promise<string> {
  const schemas = options.schemas ?? ['public']
  const filter = schemaFilter(schemas)
  const [enums, sequences, columns, constraints, indexes, views] = await Promise.all([
    options.runSql(`
      SELECT n.nspname AS schema_name, t.typname AS type_name,
             array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname IN (${filter})
      GROUP BY n.nspname, t.typname
      ORDER BY n.nspname, t.typname
    `),
    options.runSql(`
      SELECT schemaname AS schema_name, sequencename AS sequence_name,
             data_type, start_value, min_value, max_value, increment_by, cycle
      FROM pg_sequences
      WHERE schemaname IN (${filter})
      ORDER BY schemaname, sequencename
    `),
    options.runSql(`
      SELECT n.nspname AS schema_name, c.relname AS table_name, a.attnum AS ordinal,
             a.attname AS column_name, pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
             a.attnotnull AS not_null, a.attidentity AS identity_kind,
             a.attgenerated AS generated_kind,
             pg_get_expr(d.adbin, d.adrelid) AS default_expression
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid AND c.relkind IN ('r', 'p')
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attnum > 0 AND NOT a.attisdropped AND n.nspname IN (${filter})
      ORDER BY n.nspname, c.relname, a.attnum
    `),
    options.runSql(`
      SELECT n.nspname AS schema_name, c.relname AS table_name, con.conname AS constraint_name,
             pg_get_constraintdef(con.oid, true) AS definition
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN (${filter})
      ORDER BY CASE con.contype WHEN 'p' THEN 0 WHEN 'u' THEN 1 WHEN 'c' THEN 2 ELSE 3 END,
               n.nspname, c.relname, con.conname
    `),
    options.runSql(`
      SELECT n.nspname AS schema_name, i.relname AS index_name, pg_get_indexdef(i.oid) AS definition
      FROM pg_index x
      JOIN pg_class i ON i.oid = x.indexrelid
      JOIN pg_class t ON t.oid = x.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      LEFT JOIN pg_constraint con ON con.conindid = i.oid
      WHERE n.nspname IN (${filter}) AND con.oid IS NULL
      ORDER BY n.nspname, i.relname
    `),
    options.runSql(`
      SELECT schemaname AS schema_name, viewname AS view_name, definition
      FROM pg_views
      WHERE schemaname IN (${filter})
      ORDER BY schemaname, viewname
    `),
  ])

  const ddl: string[] = [
    '-- Generated schema-only fixture. Review before committing; contains no table rows.',
    ...schemas.filter((schema) => schema !== 'public').map((schema) => `CREATE SCHEMA IF NOT EXISTS ${identifier(schema)};`),
  ]

  for (const row of enums) {
    const labels = row.labels
    if (!Array.isArray(labels) || !labels.every((label) => typeof label === 'string')) {
      throw new Error('PostgreSQL enum schema row has invalid labels')
    }
    ddl.push(`CREATE TYPE ${qualified(text(row, 'schema_name'), text(row, 'type_name'))} AS ENUM (${labels.map(literal).join(', ')});`)
  }

  for (const row of sequences) {
    const target = qualified(text(row, 'schema_name'), text(row, 'sequence_name'))
    const cycle = row.cycle === true ? ' CYCLE' : ' NO CYCLE'
    ddl.push(
      `CREATE SEQUENCE ${target} AS ${text(row, 'data_type')}` +
      ` INCREMENT BY ${String(row.increment_by)} MINVALUE ${String(row.min_value)}` +
      ` MAXVALUE ${String(row.max_value)} START WITH ${String(row.start_value)}${cycle};`,
    )
  }

  const tables = new Map<string, { schema: string; name: string; definitions: string[] }>()
  for (const row of columns) {
    const schema = text(row, 'schema_name')
    const name = text(row, 'table_name')
    const key = `${schema}\0${name}`
    const table = tables.get(key) ?? { schema, name, definitions: [] }
    const defaultExpression = typeof row.default_expression === 'string' ? row.default_expression : ''
    const identity = row.identity_kind === 'a'
      ? ' GENERATED ALWAYS AS IDENTITY'
      : row.identity_kind === 'd' ? ' GENERATED BY DEFAULT AS IDENTITY' : ''
    const generated = row.generated_kind === 's' && defaultExpression
      ? ` GENERATED ALWAYS AS (${defaultExpression}) STORED`
      : ''
    const defaultClause = !identity && !generated && defaultExpression ? ` DEFAULT ${defaultExpression}` : ''
    table.definitions.push(
      `  ${identifier(text(row, 'column_name'))} ${text(row, 'data_type')}${identity}${generated}${defaultClause}${row.not_null === true ? ' NOT NULL' : ''}`,
    )
    tables.set(key, table)
  }
  for (const table of tables.values()) {
    ddl.push(`CREATE TABLE ${qualified(table.schema, table.name)} (\n${table.definitions.join(',\n')}\n);`)
  }

  for (const row of constraints) {
    ddl.push(
      `ALTER TABLE ${qualified(text(row, 'schema_name'), text(row, 'table_name'))}` +
      ` ADD CONSTRAINT ${identifier(text(row, 'constraint_name'))} ${text(row, 'definition')};`,
    )
  }
  for (const row of indexes) ddl.push(`${text(row, 'definition')};`)
  for (const row of views) {
    ddl.push(`CREATE VIEW ${qualified(text(row, 'schema_name'), text(row, 'view_name'))} AS\n${text(row, 'definition').replace(/;\s*$/, '')};`)
  }
  return `${ddl.join('\n\n')}\n`
}
