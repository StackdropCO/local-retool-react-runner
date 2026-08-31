import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import ts from 'typescript'
import { listWorktrees } from './git.js'
import { TOOL_ROOT } from './paths.js'

export type TypecheckTarget = {
  appDir: string
  branch: string
  worktreePath: string
}

export type TypecheckDiagnostic = {
  file: string
  line: number
  column: number
  code: number
  category: 'error' | 'warning' | 'suggestion' | 'message'
  message: string
}

export type TypecheckResult = {
  ok: boolean
  appDir: string
  errorCount: number
  warningCount: number
  diagnostics: TypecheckDiagnostic[]
}

const canonical = (path: string) => realpathSync.native(resolve(path))

export function resolveTypecheckTarget(input: { repoDir: string; branch: string; app: string }): TypecheckTarget {
  if (!input.repoDir) throw new Error('no apps repository configured; pass --repo "/path/to/apps-repo"')
  if (!input.branch) throw new Error('missing --branch')
  if (!input.app) throw new Error('missing --app')

  const worktrees = listWorktrees(input.repoDir)
  const matches = worktrees.filter((worktree) => worktree.branch === input.branch)
  if (!matches.length) throw new Error(`no registered worktree for branch "${input.branch}"`)
  if (matches.length > 1) throw new Error(`multiple registered worktrees found for branch "${input.branch}"`)

  const worktreePath = canonical(matches[0].path)
  const relativeApp = input.app.startsWith(`apps-v2${sep}`) || input.app === 'apps-v2'
    ? input.app
    : join('apps-v2', input.app)
  const candidate = isAbsolute(input.app) ? resolve(input.app) : resolve(worktreePath, relativeApp)
  if (!existsSync(candidate)) throw new Error(`app path not found in branch "${input.branch}": ${candidate}`)
  const appDir = canonical(candidate)
  const fromWorktree = relative(worktreePath, appDir)
  if (fromWorktree === '..' || fromWorktree.startsWith(`..${sep}`) || isAbsolute(fromWorktree)) {
    throw new Error(`app path is outside the worktree for branch "${input.branch}": ${appDir}`)
  }
  if (!existsSync(join(appDir, 'frontend', 'App.tsx'))) {
    throw new Error(`not a Retool React app (missing frontend/App.tsx): ${appDir}`)
  }
  return { appDir, branch: input.branch, worktreePath }
}

function sourceFilesUnder(directory: string): string[] {
  if (!existsSync(directory)) return []
  const files: string[] = []
  const visit = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const path = join(current, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (/\.tsx?$/.test(entry.name)) files.push(path)
    }
  }
  visit(directory)
  return files.sort()
}

const camel = (value: string) => value
  .replace(/[^a-zA-Z0-9]+(.)?/g, (_, next) => next ? next.toUpperCase() : '')
  .replace(/^([A-Z])/, (first) => first.toLowerCase())

function identifiersByLowercase(files: string[]): Map<string, Set<string>> {
  const identifiers = new Map<string, Set<string>>()
  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, false)
    const visit = (node: ts.Node) => {
      if (ts.isIdentifier(node)) {
        const names = identifiers.get(node.text.toLowerCase()) ?? new Set<string>()
        names.add(node.text)
        identifiers.set(node.text.toLowerCase(), names)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return identifiers
}

function resourceBindings(appDir: string, backendFiles: string[]): string[] {
  try {
    const pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'))
    const refs = Object.values<any[]>(pkg?.retool?.app?.resourceReferencesByFile ?? {}).flat()
    const identifiers = identifiersByLowercase(backendFiles)
    const bindings = new Set<string>()
    for (const ref of refs) {
      const generated = camel(String(ref?.displayName ?? ''))
      if (!generated) continue
      const sourceNames = identifiers.get(generated.toLowerCase())
      if (sourceNames?.size) for (const name of sourceNames) bindings.add(name)
      else bindings.add(generated)
    }
    return [...bindings].sort()
  } catch {
    return []
  }
}

function globalDeclarations(appDir: string, backendFiles: string[]): string {
  const resources = resourceBindings(appDir, backendFiles)
    .map((binding) => `declare const ${binding}: RetoolLocalResource`)
    .join('\n')
  return [
    'type User = { email?: string; [key: string]: unknown }',
    'type RetoolLocalResource = { query<T = unknown>(...args: any[]): Promise<any>; [key: string]: any }',
    resources,
    "declare module '*.css' { const value: string; export default value }",
  ].filter(Boolean).join('\n')
}

const cap = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)

function hookDeclarations(appDir: string, virtualFile: string): string | undefined {
  const marker = `${sep}frontend${sep}hooks${sep}backend${sep}`
  const markerIndex = virtualFile.indexOf(marker)
  if (markerIndex < 0 || !virtualFile.endsWith('.d.ts')) return undefined
  const group = virtualFile.slice(markerIndex + marker.length, -'.d.ts'.length)
  if (!group || group.includes(sep)) return undefined
  const backendGroup = join(appDir, 'backend', group)
  if (!existsSync(backendGroup)) return undefined
  const endpoints = sourceFilesUnder(backendGroup)
    .filter((file) => !file.endsWith('.d.ts'))
    .map((file) => file.slice(backendGroup.length + 1).replace(/\.tsx?$/, ''))
    .filter((name) => !name.includes(sep))
  if (!endpoints.length) return undefined
  return endpoints.map((endpoint, index) => {
    const alias = `Endpoint${index}`
    const importPath = `../../../backend/${group}/${endpoint}`
    return [
      `type ${alias} = typeof import(${JSON.stringify(importPath)}).default`,
      `type ${alias}Request = Parameters<${alias}>[0]`,
      `type ${alias}Params = ${alias}Request extends { params: infer Params } ? Params : never`,
      `type ${alias}Result = Awaited<ReturnType<${alias}>>`,
      `export declare function use${cap(endpoint)}(): {`,
      `  data: ${alias}Result | undefined`,
      '  isFetching: boolean',
      '  error: unknown',
      `  trigger(params: ${alias}Params, options?: unknown): { result: Promise<${alias}Result> }`,
      '}',
    ].join('\n')
  }).join('\n\n')
}

function categoryName(category: ts.DiagnosticCategory): TypecheckDiagnostic['category'] {
  return ts.DiagnosticCategory[category].toLowerCase() as TypecheckDiagnostic['category']
}

export function typecheckApp(inputDir: string): TypecheckResult {
  const appDir = canonical(inputDir)
  const backendFiles = sourceFilesUnder(join(appDir, 'backend'))
  const frontendFiles = sourceFilesUnder(join(appDir, 'frontend'))
  const globalsFile = join(appDir, '.local-mcp-runner', 'typecheck-globals.d.ts')
  const virtualSources = new Map<string, string>([[globalsFile, globalDeclarations(appDir, backendFiles)]])
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    noEmit: true,
    allowArbitraryExtensions: true,
    resolveJsonModule: true,
    baseUrl: appDir,
    paths: { '*': [join(TOOL_ROOT, 'node_modules', '*')] },
    typeRoots: [join(TOOL_ROOT, 'node_modules', '@types')],
  }
  const host = ts.createCompilerHost(options)
  const systemFileExists = host.fileExists.bind(host)
  const systemReadFile = host.readFile.bind(host)
  host.fileExists = (file) => {
    if (virtualSources.has(file)) return true
    const hooks = hookDeclarations(appDir, file)
    if (hooks !== undefined) {
      virtualSources.set(file, hooks)
      return true
    }
    return systemFileExists(file)
  }
  host.readFile = (file) => virtualSources.get(file) ?? hookDeclarations(appDir, file) ?? systemReadFile(file)
  const dependencyOptions = { ...options, baseUrl: undefined, paths: undefined }
  const toolContainingFile = join(TOOL_ROOT, 'src', '__app-typecheck.ts')
  host.resolveModuleNames = (moduleNames, containingFile) => moduleNames.map((moduleName) => {
    if (/(^|\/)hooks\/backend\/[^/]+$/.test(moduleName.replace(/\\/g, '/'))) {
      const virtualFile = `${resolve(dirname(containingFile), moduleName)}.d.ts`
      const source = hookDeclarations(appDir, virtualFile)
      if (source !== undefined) {
        virtualSources.set(virtualFile, source)
        return { resolvedFileName: virtualFile, extension: ts.Extension.Dts }
      }
    }
    if (!moduleName.startsWith('.') && !isAbsolute(moduleName)) {
      const dependency = ts.resolveModuleName(moduleName, toolContainingFile, dependencyOptions, host).resolvedModule
      if (dependency) return dependency
    }
    return ts.resolveModuleName(moduleName, containingFile, options, host).resolvedModule
  })

  const program = ts.createProgram([...backendFiles, ...frontendFiles, globalsFile], options, host)
  const diagnostics = ts.getPreEmitDiagnostics(program).map((diagnostic): TypecheckDiagnostic => {
    const position = diagnostic.file && diagnostic.start !== undefined
      ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
      : { line: 0, character: 0 }
    const absoluteFile = diagnostic.file?.fileName ?? '<typecheck>'
    return {
      file: absoluteFile.startsWith(appDir) ? relative(appDir, absoluteFile) : absoluteFile,
      line: position.line + 1,
      column: position.character + 1,
      code: diagnostic.code,
      category: categoryName(diagnostic.category),
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    }
  })
  const errorCount = diagnostics.filter((diagnostic) => diagnostic.category === 'error').length
  const warningCount = diagnostics.filter((diagnostic) => diagnostic.category === 'warning').length
  return { ok: errorCount === 0, appDir, errorCount, warningCount, diagnostics }
}

export function formatTypecheckResult(result: TypecheckResult, json: boolean): string {
  if (json) return JSON.stringify(result, null, 2)
  const diagnostics = result.diagnostics.map((diagnostic) =>
    `${diagnostic.file}:${diagnostic.line}:${diagnostic.column} - ${diagnostic.category} TS${diagnostic.code}: ${diagnostic.message}`,
  )
  const summary = result.ok
    ? `[typecheck] passed: ${result.appDir}`
    : `[typecheck] failed: ${result.errorCount} error(s), ${result.warningCount} warning(s)`
  return [...diagnostics, summary].join('\n')
}
