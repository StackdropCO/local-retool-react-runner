# Shared Worktree Previews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every panel preview run directly from an existing Git worktree so an agent's edits appear live, while allowing separate branch worktrees to run concurrently.

**Architecture:** Git worktree discovery returns explicit path, branch, commit, and dirty metadata. App scanning maps each app to matching paths in registered worktrees, and the panel sends the selected absolute worktree/app path to the runner. The runner validates that exact path and expected branch and never creates a worktree or checks out a branch.

**Tech Stack:** TypeScript, Node.js child processes, Express, React, Vitest, Testing Library

## Global Constraints

- The panel must never run `git checkout`, `git reset`, `git pull`, or create a worktree implicitly.
- Agent and preview must read the same absolute app directory.
- Each worktree preview must use an independent dynamically allocated port.
- Preserve existing local dependency and resource-global changes.

---

### Task 1: Existing worktree discovery and validation

**Files:**
- Modify: `src/git.ts`
- Test: `src/git.test.ts`

**Interfaces:**
- Produces: `listWorktrees(dir): WorktreeInfo[]`
- Produces: `validateWorktreeTarget(appPath, expectedWorktreePath, expectedBranch): WorktreeInfo`

- [x] Write integration tests using a temporary Git repository and linked feature worktree.
- [x] Run `vitest run src/git.test.ts` and verify the new tests fail because the APIs do not exist.
- [x] Implement worktree metadata parsing, dirty-state discovery, and fail-closed target validation without Git mutations.
- [x] Run `vitest run src/git.test.ts` and verify all Git tests pass.

### Task 2: Exact worktree targets in app scanning and panel API

**Files:**
- Modify: `src/scan.ts`
- Modify: `src/scan.test.ts`
- Modify: `src/panel/server.ts`
- Modify: `src/panel/ui/lib/types.ts`
- Modify: `src/panel/ui/lib/api.test.ts`

**Interfaces:**
- Produces: `ScannedApp.worktrees`, containing exact worktree and app paths.
- Consumes: `RunInput.worktreePath` and `RunInput.branch` as validation expectations.

- [x] Write scan and API tests proving exact paths are returned and sent.
- [x] Run the focused tests and verify they fail for the missing worktree contract.
- [x] Add worktree targets to scanning and replace branch resolution in `/api/run` with exact-path validation.
- [x] Run the focused tests and verify they pass.

### Task 3: Worktree-aware app and running UI

**Files:**
- Modify: `src/panel/ui/components/app-card.tsx`
- Modify: `src/panel/ui/components/running-apps.tsx`
- Modify: `src/panel/ui/PanelApp.test.tsx`

**Interfaces:**
- Consumes: `ScannedApp.worktrees`
- Produces: a run request for the selected exact worktree and visible path/branch/dirty state.

- [x] Update the component test to select a worktree and assert the exact run payload.
- [x] Run `vitest run src/panel/ui/PanelApp.test.tsx` and verify the new assertion fails.
- [x] Replace the branch selector with a registered-worktree selector and display the attached path in running previews.
- [x] Run the component test and verify it passes.

### Task 4: Verification

**Files:**
- Verify all modified source and test files.

- [x] Run the focused Git, scan, API, and UI tests.
- [x] Run the complete Vitest suite, accounting separately for any sandbox-only socket failure.
- [x] Run TypeScript typechecking without emitting files.
- [x] Review `git diff` to confirm no implicit worktree mutation path remains and unrelated local edits were preserved.
