import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { loadLocalResourceEntries, validateLocalResourceSpec } from './localResourceConfig.js'

export type LocalResourceSpec = {
  resourceId: string
  binding: string
  specFile: string
  specHash: string
  content: string
}

type StoreOptions = { directory?: string }

function configuredEntry(resourceId: string, options: StoreOptions) {
  const entry = loadLocalResourceEntries(options)[resourceId]
  if (!entry) throw new Error(`Local resource ${resourceId} is not configured`)
  return entry
}

function result(resourceId: string, binding: string, specPath: string, content: string): LocalResourceSpec {
  return {
    resourceId,
    binding,
    specFile: basename(specPath),
    specHash: createHash('sha256').update(content).digest('hex').slice(0, 12),
    content,
  }
}

export function readLocalResourceSpec(resourceId: string, options: StoreOptions = {}): LocalResourceSpec {
  const entry = configuredEntry(resourceId, options)
  return result(resourceId, entry.binding, entry.specPath, readFileSync(entry.specPath, 'utf8'))
}

export function saveLocalResourceSpec(
  resourceId: string,
  content: string,
  options: StoreOptions = {},
): LocalResourceSpec {
  if (typeof content !== 'string') throw new Error('OpenAPI document content must be a string')
  const entry = configuredEntry(resourceId, options)
  validateLocalResourceSpec(entry.specPath, content, entry.baseUrl)

  const temporaryPath = join(dirname(entry.specPath), `.${basename(entry.specPath)}.${randomUUID()}.tmp`)
  try {
    writeFileSync(temporaryPath, content, { encoding: 'utf8', mode: 0o600 })
    renameSync(temporaryPath, entry.specPath)
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath)
  }
  return result(resourceId, entry.binding, entry.specPath, content)
}
