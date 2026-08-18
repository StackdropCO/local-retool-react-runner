# Local REST Resource Specifications

## Goal

Allow the local runner to execute Retool `restapi` resources that Retool MCP
cannot execute because they have only a base URL and no MCP-visible OpenAPI
definition. The Retool apps repository remains unchanged.

The first target is a private file-upload resource, whose app-facing binding
is `privateUpload` and whose identity is its Retool resource UUID.

## Repository and privacy model

The local-runner repository contains tracked, non-functional examples:

```text
resources.example/
  resources.json
  generic-upload.openapi.yaml
```

Each developer creates private definitions under:

```text
.local-resources/
  resources.json
  private-upload.openapi.yaml
```

`.local-resources/` is gitignored. The filled resource mapping, real API
documentation, base URLs, and any environment-specific values are therefore
never committed to either the local-runner repository or the Retool apps
repository. The examples use fake UUIDs, hosts, paths, and environment-variable
names.

## Identity and update behavior

Resources are keyed by the UUID from Retool's `resourceReferencesByFile`.
Display names and JavaScript bindings are metadata, not identity.

When an existing Retool resource changes, its private mapping and OpenAPI file
are updated in place under the same UUID. A new entry is created only when:

- Retool creates a new resource UUID; or
- two incompatible API versions must remain runnable in parallel.

The runner reads the private registry and referenced specs at preview startup.
It logs the selected file and a content hash. Restarting the preview activates a
changed spec; there is no hidden live mutation during an RPC request.

## Registry

The private registry has this shape:

```json
{
  "version": 1,
  "resources": {
    "00000000-0000-0000-0000-000000000000": {
      "binding": "exampleUpload",
      "spec": "./example-upload.openapi.yaml",
      "baseUrl": "https://uploads.example.invalid"
    }
  }
}
```

Paths are resolved relative to `.local-resources/resources.json`. The resource
UUID must exist in the app manifest. `binding` must match one of the aliases
derived from the app source. `baseUrl` must be HTTPS and must agree with an
allowed server in the OpenAPI document. Unknown registry fields are rejected so
configuration mistakes fail visibly.

Credentials are referenced by environment-variable name rather than stored as
literal values. The initial upload resource uses pre-signed URLs, so its local
definition does not require an API token.

## Execution precedence and API compatibility

A registered local resource always executes locally. It never calls MCP first
and does not depend on parsing an MCP unsupported-resource error. Resources with
no local definition retain their current MCP execution path.

The app continues using its existing interface:

```ts
await privateUpload.query({
  method: "POST",
  path: uploadUrl.pathname + uploadUrl.search,
  body: buffer,
})
```

The adapter accepts `method`, `path`, optional `headers`, and optional `body`.
It resolves `path` against the configured base URL and refuses absolute URLs,
protocol-relative paths, credentials in URLs, origin changes, redirects to a
different origin, and methods or paths not allowed by the OpenAPI document.

The response is normalized to a Retool-compatible object containing `status`,
`headers`, and parsed `data` when possible. Network, validation, and HTTP errors
include the resource UUID and binding without printing credentials or request
bodies.

## Write safety

The existing read-only mode applies to local REST resources:

- `GET`, `HEAD`, and `OPTIONS` are allowed in read-only mode.
- `POST`, `PUT`, `PATCH`, and `DELETE` require `--writes`.

This means a file upload cannot occur accidentally in a read-only
preview. The adapter logs request metadata and duration but never logs the PDF
body, authorization headers, or signed query values.

## Components

`localResourceConfig.ts` loads and validates the private registry, resolves spec
paths, computes hashes, and returns entries keyed by UUID.

`openApiPolicy.ts` loads the subset of OpenAPI needed for method, server, path,
content-type, and response validation. Unsupported OpenAPI constructs fail at
startup rather than silently weakening validation.

`localRestResource.ts` implements the Retool-compatible `.query(...)` adapter,
origin restrictions, redirect handling, response normalization, logging, and
write gating.

`resourceGlobals.ts` selects the local adapter before constructing an MCP REST
proxy when the endpoint references a UUID present in the local registry.

The CLI and panel show whether local resources were loaded and surface startup
errors. Each configured resource can be opened in a lightweight modal that
loads its private OpenAPI source and saves edits back to the same configured
file. The browser sends only the resource UUID and document text; it cannot
choose a filesystem path. The server validates the complete candidate document
before replacing the existing file atomically. Invalid documents remain in the
editor with an error and never change the on-disk spec. Successful saves return
the new content hash so the panel can refresh its status.

The modal uses the existing dialog components and a plain monospace textarea.
It does not add a code-editor dependency, edit the resource registry, or expose
secrets beyond the local browser session.

## Testing

Unit tests cover registry validation, relative path resolution, UUID and binding
matching, spec server/path/method enforcement, response normalization, write
blocking, redirect-origin rejection, redaction, local-over-MCP precedence, and
atomic validation-before-save. Panel tests cover loading, editing, validation
errors, saving, and refreshing the displayed content hash.

HTTP adapter tests use a temporary local server and fake OpenAPI document. They
never call an external service. A manual verification uses the private upload
definition only after write mode is explicitly enabled;
it must not publish a report or upload a file as part of the automated suite.

## Out of scope

- Uploading private specs to Retool or either GitHub repository.
- Editing Retool resources.
- Generating a complete OpenAPI client.
- Editing the resource registry or creating resource mappings in the panel.
- Automatic migration between incompatible resource UUIDs.
