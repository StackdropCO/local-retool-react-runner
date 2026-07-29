# Local MCP Runner — Product Requirements Document

**Purpose of this doc:** give a designer everything needed to design a good UX for the
tool — the problem, who it's for, what they're trying to do, the flows, and the
screen-by-screen requirements (including empty/loading/error states). It is
implementation-aware but design-first.

---

## 1. Problem

Retool "apps-as-code" (React SDK) apps can't be meaningfully run or previewed outside
Retool's cloud: the frontend is a normal Vite app, but the backend functions and their
resource connections (Databricks, Lakebase, REST APIs) only exist in Retool's runtime.
Engineers editing these apps today must push to Retool to see changes against real data —
a slow, blind loop, and awkward for reviewing a teammate's branch.

**We solve this** by running the real app locally and routing its backend/resource calls
through the Retool MCP, so engineers get a local URL with live data — for any app, on any
branch, without touching Retool.

## 2. Goals & non-goals

**Goals**
- Run any apps-as-code app locally in **under 2 minutes from zero**.
- Show **real resource data** (read-only by default; writes are deliberate).
- Let a user **preview a specific git branch** without disturbing their working tree.
- Be **org-agnostic**: no hardcoded URLs/paths; each user brings their own.
- Make what's happening **legible**: connection status, which branch/commit is running,
  what queries ran.

**Non-goals**
- Not a Retool replacement or a deploy tool.
- Not a general MCP client / tool explorer.
- Not a hosted/multi-tenant service — it's a local dev tool per engineer.

## 3. Users & personas

| Persona | Context | Primary need |
|---|---|---|
| **App developer** | Building/editing an apps-v2 app | Fast local loop against real data; run their branch |
| **Reviewer** | Reviewing a teammate's PR | Spin up *their* branch quickly, click around, verify |
| **Occasional/other-team dev** | Rarely touches Retool | Zero-assumption setup; guidance at each step |

Assume: comfortable with a terminal and git, **not** familiar with this tool's internals.

## 4. Jobs-to-be-done (user stories)

1. *As a dev,* I set my Retool MCP URL once and authorize, so the tool can reach my org.
2. *As a dev,* I point the tool at my apps repo and see a list of runnable apps.
3. *As a dev,* I pick an app **and a branch**, click Run, and open it locally with real data.
4. *As a reviewer,* I run a teammate's branch side-by-side with mine on different ports.
5. *As a dev,* I edit code and see it reflected (frontend instantly, backend on reload).
6. *As a dev,* I can tell at a glance: am I connected? which branch/commit is running?
   did my query succeed?
7. *As a cautious dev,* I stay read-only unless I explicitly enable writes to production.

## 5. Conceptual model (so the design speaks the domain)

- **MCP connection** — a URL + auth token to a Retool org. One at a time; per-user.
- **Apps repo** — a local git checkout containing many apps (a monorepo).
- **App** — one apps-v2 app: name, group, endpoints, resources, and the git branches it
  can run on.
- **Run** — a launched instance of one app on one branch, at a port, read-only or writes.
- **Resource** — a data connection the app uses; may or may not be queryable via the MCP.

## 6. Core flow (happy path)

```
Connect MCP ──► Pick apps repo ──► Scan ──► Choose app + branch ──► Run ──► Open (localhost)
   (once)          (once)                      (per run)                     live data
```
Everything except "Run" is set once and remembered.

## 7. Functional requirements

### 7.1 MCP connection & auth
- Enter/edit an **MCP URL**; persist it.
- **Connect / Authorize**: browser-based login on first use per org; token cached and
  auto-refreshed. Support **multiple orgs** without collision.
- Surface two distinct states: **token cached** (yes/no) and **connected** (live session).
- Clear, non-cryptic errors when the URL is missing/invalid or auth fails.

### 7.2 Resource visibility
- List the org's resources with a **"queryable via MCP"** indicator (yes / no / "maybe —
  needs OpenAPI"). Read-only, informational.

### 7.3 App discovery
- Accept an apps-repo directory by typing **or a filesystem browser** (navigate folders,
  recognize a repo). Persist the last-used directory.
- **Scan** → list apps with: name, group, endpoint count, resources, path, and git branch
  info. Clear empty state ("no apps found here") and not-found errors.

### 7.4 Run an app (the centerpiece)
- Per app: a **branch selector** (defaults to the checked-out branch) and a **writes**
  toggle (default off), then **Run**.
- Running a non-current branch must **not** disturb the user's working tree.
- Launch on an auto-assigned free port; support **multiple concurrent runs** (incl. two
  branches of the same app). Reuse an already-running app+branch instead of duplicating.
- Show progress: starting → serving (with the URL) → or a clear failure reason.

### 7.5 Running apps management
- A live list of runs: app name, **branch + short commit**, writes on/off, port, with
  **Open** and **Stop**.

### 7.6 Editing loop
- Frontend edits hot-reload in the browser. Backend edits reload automatically. The design
  should set the expectation that backend changes require a browser refresh to re-fetch.

### 7.7 Safety
- **Read-only by default.** Writes require an explicit per-run opt-in and should be
  visually loud wherever a write-enabled run appears (it hits production).

### 7.8 Observability
- A visible record of executed queries (resource, statement, ok/error, rows, duration) is
  available for debugging.

## 8. Screen-by-screen (control panel) with states

Single-page panel, four stacked sections. For each, design the **empty, loading, success,
and error** states.

1. **MCP connection**
   - Inputs: URL field, Save, Connect/Authorize.
   - Status: two indicators (token cached / connected).
   - States: no URL set (prompt) · authorizing (in-progress, "a tab may open") · connected ·
     auth failed (retry).

2. **Resources**
   - Action: Load resources → table (name, type, queryable badge).
   - States: not loaded · loading · list · empty · error ("connect first").

3. **Apps**
   - Inputs: repo dir field + **Browse…** (folder navigator) + Scan.
   - Result: list of app cards, each with **branch dropdown**, writes toggle, Run.
   - States: no dir · browsing · scanning · results · none found · error.

4. **Running**
   - Live list of runs with Open / Stop.
   - States: nothing running · one or more runs (show branch + commit + writes).

**Key micro-states to design:** the Run button's lifecycle (idle → starting → running →
already-running), the writes toggle's "danger" affordance, and the branch dropdown showing
the current branch as default.

## 9. UX principles / design direction

- **Clean, technical, calm.** Navy accent (`#14284b`), system font, 1px borders, generous
  whitespace. **No** gradients, glassmorphism, emoji-as-UI, or decorative hero art.
- **Status is first-class** — the user should never wonder whether they're connected or
  what branch is live.
- **Progressive disclosure** — the four steps read top-to-bottom; later steps make sense
  only after earlier ones, but nothing is hard-gated (power users jump around).
- **Loud about danger, quiet about the routine** — writes-enabled and production actions
  stand out; everything else stays understated.
- **Forgiving inputs** — accept a pasted path with a missing leading slash, expand `~`,
  and give a precise error otherwise.

## 10. Success metrics

- Time-from-clone-to-first-running-app (target: < 2 min).
- % of runs that reach "serving" without an error.
- Repeat usage per engineer per week (is it in the daily loop?).
- Support pings about "is it connected / which branch" (should trend to zero as status UX
  improves).

## 11. Edge cases & risks (design must account for)

- **Stale branch:** running a local branch reflects local git state; if it's behind the
  remote it won't show merged code. Design should surface the **commit SHA** so this is
  visible (and ideally offer "run latest from remote").
- **Heavy queries:** some large analytical queries exceed the MCP gateway (error/timeout);
  the app should degrade and show the error, not hang silently.
- **Unsupported resource types:** non-OpenAPI REST / GraphQL / storage aren't queryable via
  the MCP yet — mark them clearly.
- **Multiple orgs / auth expiry:** re-auth should be obvious and low-friction.
- **Port already in use / orphaned run:** handled by auto-skipping ports; surface running
  state clearly.

## 12. Out of scope (v1) / future

- Auto-fetch + run the remote's latest (`origin/<branch>`) so "run main" always reflects merges.
- Shims for more resource types (Postgres/GraphQL/S3, prepared-statement params).
- Per-run environment selection (`--env`).
- One-click cleanup of old worktrees; a discovery/list view across many repos.
