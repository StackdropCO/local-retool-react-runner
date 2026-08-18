# Local API Spec Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let developers view, validate, and edit configured private OpenAPI documents from a lightweight panel modal.

**Architecture:** A focused filesystem service resolves documents exclusively through the existing UUID registry, validates candidate source with the existing OpenAPI compiler, and atomically replaces valid files. Two panel endpoints expose source read/save operations, while the existing resource card owns the modal editor and asks the panel to refresh status after a successful save.

**Tech Stack:** TypeScript, Express, React, Radix Dialog, Vitest, Testing Library, Node filesystem APIs.

## Global Constraints

- Do not add a frontend code-editor dependency.
- Do not expose or accept arbitrary filesystem paths.
- Do not modify `.local-resources/resources.json` from the panel.
- Validate the full candidate OpenAPI document before replacing the existing file.
- Do not use browser automation; the user will perform visual verification.

---

### Task 1: Safe private spec storage

**Files:**
- Modify: `src/localResourceConfig.ts`
- Create: `src/localResourceSpecStore.ts`
- Create: `src/localResourceSpecStore.test.ts`

**Interfaces:**
- Produces: `readLocalResourceSpec(resourceId, options)` and `saveLocalResourceSpec(resourceId, content, options)`.

- [ ] Write failing tests proving reads resolve by UUID, valid updates persist, and invalid updates leave the original file unchanged.
- [ ] Run `vitest run src/localResourceSpecStore.test.ts` and confirm the missing service fails.
- [ ] Export candidate-document validation and implement UUID-only reads plus atomic validated saves.
- [ ] Re-run the focused tests and confirm they pass.

### Task 2: Local panel API

**Files:**
- Modify: `src/panel/server.ts`
- Modify: `src/panel/server.test.ts`

**Interfaces:**
- Produces: `GET /api/local-resources/:resourceId/spec` and `PUT /api/local-resources/:resourceId/spec`.

- [ ] Write failing HTTP tests for load, save, unknown UUID, and invalid source.
- [ ] Run `vitest run src/panel/server.test.ts` and confirm the missing routes fail.
- [ ] Implement the routes using the storage service and return structured errors.
- [ ] Re-run the focused tests and confirm they pass.

### Task 3: Lightweight editor modal

**Files:**
- Modify: `src/panel/ui/lib/types.ts`
- Modify: `src/panel/ui/lib/api.ts`
- Modify: `src/panel/ui/components/local-resource-card.tsx`
- Modify: `src/panel/ui/PanelApp.tsx`
- Modify: `src/panel/ui/PanelApp.test.tsx`

**Interfaces:**
- Consumes: the two local spec endpoints.
- Produces: resource-row Edit action, modal textarea, Save action, inline errors, and status refresh.

- [ ] Write a failing interaction test that opens, edits, saves, and observes the refreshed hash; add an invalid-save error case.
- [ ] Run `vitest run src/panel/ui/PanelApp.test.tsx` and confirm the missing editor fails.
- [ ] Add typed API methods and implement the dependency-free modal editor.
- [ ] Re-run the focused UI tests and confirm they pass.

### Task 4: Documentation and verification

**Files:**
- Modify: `README.md`

**Interfaces:**
- Documents: opening, editing, validation, saving, restart behavior, and privacy limits.

- [ ] Update the local-resource instructions with the panel editor workflow.
- [ ] Run the full Vitest suite, `tsc --noEmit`, and `git diff --check`.
- [ ] Leave changes unpushed for the user to review and publish.
