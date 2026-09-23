import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createLiveSqlRunner } from '../liveSql.js'
import { capturePostgresSchema } from '../postgresSchema.js'

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const resourceId = argument('resource')
const outputArg = argument('out')
const environmentName = argument('environment')
const schemas = (argument('schemas') ?? 'public').split(',').map((value) => value.trim()).filter(Boolean)
const force = process.argv.includes('--force')

if (!resourceId || !outputArg || !environmentName) {
  console.error('Usage: pnpm schema:postgres -- --resource <Retool UUID> --environment <name> --out <schema.sql> [--schemas public,app] [--force]')
  process.exitCode = 1
} else {
  const outputPath = resolve(outputArg)
  if (existsSync(outputPath) && !force) {
    console.error(`Refusing to overwrite ${outputPath}; pass --force to replace it.`)
    process.exitCode = 1
  } else {
    const live = await createLiveSqlRunner({
      resources: { postgres: resourceId },
      environmentName,
    })
    try {
      const schema = await capturePostgresSchema({
        schemas,
        runSql: (sql) => live.runSql('postgres', sql),
      })
      mkdirSync(dirname(outputPath), { recursive: true })
      writeFileSync(outputPath, schema, { encoding: 'utf8', mode: 0o600 })
      console.log(`Wrote schema-only PostgreSQL fixture to ${outputPath}`)
    } finally {
      await live.close()
    }
  }
}
