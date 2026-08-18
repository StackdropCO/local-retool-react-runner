# Local REST Resource Specifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute UUID-mapped Retool `restapi` resources locally from private OpenAPI documents when MCP cannot execute them.

**Architecture:** Load a gitignored registry and OpenAPI files at preview startup, validate them into a small immutable policy keyed by Retool resource UUID, and prefer a local `.query(...)` adapter over MCP for configured UUIDs. The adapter enforces OpenAPI method/path/server restrictions, existing write safety, redirect-origin safety, and redacted query logging while preserving the app-facing binding.

**Tech Stack:** TypeScript, Node.js fetch, `yaml`, Express/Vite, Vitest

## Global Constraints

- The Retool apps repository must remain unchanged.
- `.local-resources/` and all real API documentation remain gitignored.
- Tracked examples contain fake UUIDs, hosts, paths, and environment names only.
- Local definitions always take precedence over MCP for the same resource UUID.
- Resource identity is the Retool UUID; display names and bindings are metadata.
- Updating an existing resource replaces its private definition under the same UUID.
- REST mutations require the existing explicit writes mode.
- Logs and errors never expose bodies, authorization headers, credentials, or signed query values.

---

### Task 1: Private registry and OpenAPI policy

**Files:**
- Create: `src/localResourceConfig.ts`
- Create: `src/localResourceConfig.test.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `loadLocalResourceDefinitions(options?): LocalResourceMap`.
- Produces: `LocalResourceDefinition` with `resourceId`, `binding`, `baseUrl`, `specPath`, `specHash`, and `operations`.
- Consumes: `.local-resources/resources.json` and referenced OpenAPI JSON/YAML files.

- [x] **Step 1: Add failing registry tests**

Create fixtures in a temporary directory and assert that an absent registry returns an empty map, a valid registry/spec returns a UUID-keyed definition with a SHA-256 hash and compiled `/upload/v1/{token}` POST path, and invalid versions, unknown fields, non-HTTPS servers, escaping spec paths, or base URL/spec-server mismatches throw startup errors.

- [x] **Step 2: Verify the tests fail for the missing module**

Run: `./node_modules/.bin/vitest run src/localResourceConfig.test.ts`

Expected: FAIL because `./localResourceConfig.js` does not exist.

- [x] **Step 3: Add YAML support and implement strict loading**

Add `yaml` as a direct runtime dependency. Implement:

```ts
export type LocalResourceDefinition = {
  resourceId: string
  binding: string
  baseUrl: URL
  specPath: string
  specHash: string
  operations: Array<{ method: string; template: string; pattern: RegExp; requestContentTypes: string[] }>
}

export type LocalResourceMap = Record<string, LocalResourceDefinition>

export function loadLocalResourceDefinitions(options?: {
  directory?: string
  appResourceIds?: Set<string>
}): LocalResourceMap
```

Parse JSON by extension and YAML with `yaml.parse`. Accept registry keys only from the documented version-1 schema. Resolve specs under the registry directory with `realpathSync`, require OpenAPI `3.x`, require HTTPS base/server URLs with equal origins, compile literal segments and `{parameter}` segments into anchored patterns, and reject unsupported path constructs or duplicate method/template pairs.

- [x] **Step 4: Run registry tests and typecheck**

Run: `./node_modules/.bin/vitest run src/localResourceConfig.test.ts && ./node_modules/.bin/tsc --noEmit`

Expected: all registry tests pass and typecheck exits 0.

### Task 2: Safe local `.query(...)` adapter

**Files:**
- Create: `src/localRestResource.ts`
- Create: `src/localRestResource.test.ts`
- Modify: `src/queryLog.ts` only if a typed local-operation field is required

**Interfaces:**
- Consumes: `LocalResourceDefinition` from Task 1.
- Produces: `createLocalRestResource(definition, options): { query(request): Promise<LocalRestResponse> }`.

- [x] **Step 1: Add failing adapter tests**

Using a real temporary HTTP server and a directly constructed test definition, assert observable behavior: a matching POST forwards the raw Buffer and returns `{status, headers, data}`; an unmatched method/path is rejected before fetch; absolute and protocol-relative paths are rejected; read-only mode blocks mutation before fetch; cross-origin redirects are rejected; JSON and text responses normalize correctly; and thrown errors omit the signed query string and body.

- [x] **Step 2: Verify the tests fail for the missing module**

Run: `./node_modules/.bin/vitest run src/localRestResource.test.ts`

Expected: FAIL because `./localRestResource.js` does not exist.

- [x] **Step 3: Implement the minimal adapter**

Implement:

```ts
export type LocalRestRequest = {
  method?: string
  path: string
  headers?: Record<string, string>
  body?: BodyInit | Buffer
}

export function createLocalRestResource(
  definition: LocalResourceDefinition,
  options: { writes: boolean; endpoint: string; fetchImpl?: typeof fetch },
): { query(request: LocalRestRequest): Promise<{ status: number; headers: Record<string, string>; data: unknown }> }
```

Resolve only relative root paths against `baseUrl`, match the pathname (never query values) against compiled operations, block non-read methods unless writes are enabled, call fetch with `redirect: "manual"`, reject redirects, parse JSON by content type and otherwise return text, and log only method plus the matched OpenAPI template.

- [x] **Step 4: Run adapter and registry tests**

Run: `./node_modules/.bin/vitest run src/localRestResource.test.ts src/localResourceConfig.test.ts`

Expected: both test files pass.

### Task 3: UUID precedence in resource globals and server startup

**Files:**
- Modify: `src/resourceGlobals.ts`
- Modify: `src/resourceGlobals.test.ts`
- Modify: `src/server.ts`
- Modify: `src/server.test.ts`

**Interfaces:**
- Consumes: `LocalResourceMap` and `createLocalRestResource`.
- Changes: `buildGlobals` options gain `localResources?: LocalResourceMap`.
- Changes: `startServer` loads local definitions once using app manifest UUIDs.

- [x] **Step 1: Add failing precedence and startup tests**

Add a resource-global test with the same UUID in the MCP map and local map; call `privateUpload.query(...)`, assert the local server receives it, and assert MCP is never invoked. Add a mismatch test proving a configured binding not present among the UUID's source aliases fails at startup. Add a server test proving no `.local-resources` directory preserves existing behavior.

- [x] **Step 2: Verify the focused tests fail**

Run: `./node_modules/.bin/vitest run src/resourceGlobals.test.ts src/server.test.ts`

Expected: FAIL because local definitions are not accepted or selected.

- [x] **Step 3: Wire local definitions into startup and globals**

Load the registry in `startServer`, validate registry UUIDs against `readResourceRefs(appDir)`, validate each configured binding against the resolved entry's `sourceBindings`, and pass only endpoint-referenced local definitions to `buildGlobals`. For a locally configured UUID, expose `createLocalRestResource(...)` under all source bindings instead of creating the MCP REST proxy. Print one startup line per definition with UUID, private spec path, and short hash.

- [x] **Step 4: Run focused integration tests and typecheck**

Run: `./node_modules/.bin/vitest run src/resourceGlobals.test.ts src/server.test.ts src/localRestResource.test.ts src/localResourceConfig.test.ts && ./node_modules/.bin/tsc --noEmit`

Expected: all focused tests pass and typecheck exits 0.

### Task 4: Examples, private API setup, and documentation

**Files:**
- Modify: `.gitignore`
- Create: `resources.example/resources.json`
- Create: `resources.example/generic-upload.openapi.yaml`
- Create (ignored): `.local-resources/resources.json`
- Create (ignored): `.local-resources/private-upload.openapi.yaml`
- Modify: `README.md`

**Interfaces:**
- Consumes: registry schema and OpenAPI subset from Tasks 1-3.
- Produces: safe tracked examples and a private mapping for a developer-supplied Retool resource UUID.

- [x] **Step 1: Add the ignore rule before private files**

Add `.local-resources/` to `.gitignore`, then verify `git check-ignore .local-resources/resources.json` succeeds before creating any private content.

- [x] **Step 2: Add fake tracked examples**

Create a version-1 example registry using UUID `00000000-0000-0000-0000-000000000000`, binding `exampleUpload`, and host `uploads.example.invalid`. Add an OpenAPI 3.0 document allowing only `POST /upload/v1/{token}` with `application/octet-stream`.

- [x] **Step 3: Create the ignored private definition**

Create the developer's private registry entry using its Retool UUID, app-facing binding, and HTTPS origin. Create the private OpenAPI document allowing only the required upload operation. Verify both files are ignored and absent from `git status`.

- [x] **Step 4: Document setup and update semantics**

Document copying the example directory, mapping by UUID, keeping private files hidden, restarting previews after spec changes, updating a definition in place for the same UUID, creating a new entry only for a new UUID or parallel incompatible version, and the REST write gate.

- [x] **Step 5: Run full verification**

Run: `./node_modules/.bin/vitest run && ./node_modules/.bin/tsc --noEmit && git diff --check`

Expected: complete suite passes, typecheck exits 0, and no whitespace errors are reported.

- [x] **Step 6: Restart the target app read-only**

Restart the selected private app worktree through the panel with writes disabled. Confirm startup reports the private API definition and `GET /` returns HTTP 200. Do not publish a report or upload a file.
