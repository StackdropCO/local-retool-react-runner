# UUID-Backed Resource Bindings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run backend endpoints when Retool app source and MCP TypeScript definitions use different casing for the same resource variable.

**Architecture:** Resource UUID remains the identity. The resolver records generated and source identifiers separately, exposes proxies under source-facing names, and prefers the spelling present in app source because live verification showed that Retool's executor may inject it even when its definition generator reports different casing. It retries the generated spelling only for an exact missing-binding error. Resources are selected per endpoint from `resourceReferencesByFile`, and ambiguous aliases fail before the HTTP server starts.

**Tech Stack:** TypeScript compiler API, Node.js, Express, Vitest

## Global Constraints

- Do not hard-code resource display names, UUIDs, or casing aliases.
- Preserve the existing app and MCP resource configuration.
- Do not change the private upload resource's execution behavior in this fix.
- Preserve all unrelated uncommitted changes.

---

### Task 1: Source and MCP binding separation

**Files:**
- Modify: `src/resourceGlobals.ts`
- Test: `src/resourceGlobals.test.ts`

**Interfaces:**
- Produces: `ResourceEntry` with `mcpBinding` and `sourceBindings`.
- Consumes: backend TypeScript source text when resolving resources.

- [x] Add a failing regression test where source uses `lakebaseRetoolOltp` and MCP exposes `lakebaseRetoolOLTP`.
- [x] Run `vitest run src/resourceGlobals.test.ts` and verify the original execution spelling fails.
- [x] Parse TypeScript identifiers, associate case-insensitive spellings with each UUID-backed MCP binding, and expose the same proxy under those source spellings.
- [x] Prefer the source spelling for execution and retry the generated spelling only after an exact missing-binding error.
- [x] Add and verify a collision test that rejects one source alias resolving to multiple UUIDs.

### Task 2: Endpoint-scoped resource manifests

**Files:**
- Modify: `src/endpointRunner.ts`
- Modify: `src/endpointRunner.test.ts`
- Modify: `src/server.ts`

**Interfaces:**
- Produces: `readEndpointResourceRefs(appDir): Record<string, ResourceRef[]>`.
- Consumes: the resolved UUID-backed resource map to build only each endpoint's globals.

- [x] Add a failing manifest test proving endpoint references remain separated.
- [x] Implement endpoint-keyed manifest parsing while retaining the existing flattened helper.
- [x] Resolve bindings once at startup, validate aliases, and select only referenced resources for each RPC endpoint.
- [x] Run focused endpoint and resource tests.

### Task 3: Live regression verification

**Files:**
- Verify: Shift Utilization Dashboard worktree without editing it.

- [x] Run the complete Vitest suite and TypeScript typecheck.
- [x] Restart the target REST-resource preview.
- [x] Call `getShiftOptions` and confirm `lakebaseRetoolOltp` succeeds end-to-end (19 Lakebase rows).
- [x] Confirm the preview remains listening after the request.
