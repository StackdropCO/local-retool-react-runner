import { describe, expect, it, vi } from 'vitest'
import { capturePostgresSchema } from './postgresSchema.js'

describe('capturePostgresSchema', () => {
  it('builds a schema-only fixture from read-only catalog queries', async () => {
    const runSql = vi.fn(async (sql: string): Promise<Array<Record<string, unknown>>> => {
      if (sql.includes('FROM pg_type')) return [{ schema_name: 'public', type_name: 'mood', labels: ['ok', "it's fine"] }]
      if (sql.includes('FROM pg_sequences')) return []
      if (sql.includes('FROM pg_attribute')) return [
        { schema_name: 'public', table_name: 'widgets', ordinal: 1, column_name: 'id', data_type: 'integer', not_null: true, identity_kind: 'a', generated_kind: '', default_expression: null },
        { schema_name: 'public', table_name: 'widgets', ordinal: 2, column_name: 'name', data_type: 'text', not_null: false, identity_kind: '', generated_kind: '', default_expression: "'new'::text" },
      ]
      if (sql.includes('FROM pg_constraint')) return [{ schema_name: 'public', table_name: 'widgets', constraint_name: 'widgets_pkey', definition: 'PRIMARY KEY (id)' }]
      if (sql.includes('FROM pg_index')) return [{ schema_name: 'public', index_name: 'widgets_name_idx', definition: 'CREATE INDEX widgets_name_idx ON public.widgets USING btree (name)' }]
      if (sql.includes('FROM pg_views')) return [{ schema_name: 'public', view_name: 'widget_names', definition: ' SELECT name FROM widgets;' }]
      return []
    })

    const schema = await capturePostgresSchema({ runSql })

    expect(runSql).toHaveBeenCalledTimes(6)
    expect(schema).toContain(`CREATE TYPE "public"."mood" AS ENUM ('ok', 'it''s fine');`)
    expect(schema).toContain('"id" integer GENERATED ALWAYS AS IDENTITY NOT NULL')
    expect(schema).toContain(`"name" text DEFAULT 'new'::text`)
    expect(schema).toContain('ADD CONSTRAINT "widgets_pkey" PRIMARY KEY (id);')
    expect(schema).toContain('CREATE INDEX widgets_name_idx ON public.widgets USING btree (name);')
    expect(schema).toContain('CREATE VIEW "public"."widget_names" AS')
  })

  it('rejects unsafe schema names before querying the live database', async () => {
    const runSql = vi.fn()
    await expect(capturePostgresSchema({ runSql, schemas: ['public); DROP DATABASE prod; --'] }))
      .rejects.toThrow(/Invalid PostgreSQL schema name/)
    expect(runSql).not.toHaveBeenCalled()
  })
})
