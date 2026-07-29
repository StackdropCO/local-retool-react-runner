# Control Panel shadcn/ui Redesign

**Date:** 2026-07-29  
**Status:** Approved for implementation  
**Scope:** The local runner control panel only

## Goal

Replace the control panel's single inline HTML/CSS/JavaScript file with a small
React application built from shadcn/ui-style components. Make the current
system state obvious, make the primary workflow faster to scan, and make write
access visibly safety-critical. Preserve the existing Express API behavior.

## Chosen approach

Use a dedicated React frontend served by the existing panel server. Keep the
four existing API capabilities—connection, resources, repository scanning, and
running apps—but organize them around status and tasks instead of a numbered
form.

Two alternatives were rejected:

- Restyling the existing static HTML would be faster initially, but would keep
  the growing imperative DOM code and would not actually adopt shadcn/ui.
- Rebuilding the panel as a separate standalone application would create an
  unnecessary second development and deployment lifecycle.

## Information architecture

The page has three regions:

1. **Header and system status:** Product identity plus compact MCP, token,
   repository, and running-app indicators.
2. **Main workspace:** Connection setup and app discovery. Once apps are
   discovered, the app list becomes the dominant content.
3. **Running apps:** A persistent panel that makes active instances, ports,
   branches, write mode, Open, and Stop actions easy to find.

Resources are supporting information rather than a required numbered step.
They appear in a compact card or collapsible section and can be refreshed on
demand.

## Components

- `PanelApp`: owns top-level queries and layout.
- `AppHeader`: title, description, and aggregate status badges.
- `ConnectionCard`: MCP URL editing, save/connect actions, token and connection
  state.
- `ResourceCard`: load/refresh action, empty/loading/error states, and a compact
  resource table.
- `RepositoryCard`: repository path, directory picker, scan action, and scan
  feedback.
- `DirectoryBrowser`: navigable folder list presented in a dialog.
- `DiscoveredApps`: responsive list of app cards.
- `AppCard`: app metadata, branch selection, guarded write-mode control, and Run
  action.
- `RunningApps`: active app list with Open and Stop actions.
- Shared UI primitives: button, input, badge, card, alert, dialog, select,
  switch, separator, skeleton, table, and tooltip.

Components use typed props and remain unaware of fetch URLs. API requests live
in a small client module so network behavior can be tested independently from
presentation.

## Visual design

- Neutral shadcn palette with one restrained primary accent.
- Clear typographic hierarchy instead of uppercase numbered headings.
- Consistent 8/12/16/24-pixel spacing rhythm and medium-radius cards.
- Lucide icons reinforce actions and status without decorative imagery.
- Green, amber, and red are reserved for connected/safe, attention, and
  destructive states.
- Responsive two-column desktop layout that collapses to one column on narrow
  screens.
- Dark mode is out of scope for the first pass.

## Write-access safety

Read-only remains the default. Enabling writes uses a warning-styled control
with production-impact copy. The user must confirm the change in an alert
dialog before an individual app can launch with writes enabled. App cards and
running-app rows show a persistent warning badge while write mode is active.

## Data flow

The frontend continues to call the existing endpoints:

- `GET /api/status`
- `POST /api/mcp-url`
- `POST /api/auth`
- `GET /api/resources`
- `GET /api/browse`
- `POST /api/scan`
- `POST /api/run`
- `GET /api/running`
- `POST /api/stop`

Initial load fetches status and running apps concurrently. Mutations disable
only their related controls and refresh the smallest affected query. No backend
payloads or routes change.

## Error and loading behavior

- Each card owns its loading and error state; one failed request does not blank
  unrelated content.
- Expected empty states explain the next useful action.
- Buttons show progress and prevent duplicate submissions.
- Errors are rendered in accessible alerts close to the action that failed.
- Stop and run errors remain visible until the user retries or dismisses them.

## Accessibility

- All controls have labels and keyboard focus states.
- Status is communicated with text and icons, never color alone.
- Dialog focus is trapped and returned to its trigger.
- Tables retain semantic headers.
- Interactive targets meet a minimum comfortable pointer size.

## Testing and verification

- Preserve the existing server test suite.
- Add component tests for initial loading, API errors, scanning, branch
  selection, run/stop actions, and write confirmation.
- Add focused tests for the API client and state transitions.
- Run TypeScript checks and the full Vitest suite.
- Verify the page at desktop and narrow viewport widths.
- Confirm that every existing panel action still calls the same endpoint with
  the same payload.

## Non-goals

- Changing MCP authentication or app-runner behavior.
- Changing API routes or response shapes.
- Adding query-log exploration, app editing, dark mode, or new backend
  capabilities.
- Introducing stock imagery or generated visual assets.
