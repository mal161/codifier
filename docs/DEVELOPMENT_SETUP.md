# Development setup and environment decisions

## Current state

The workspace includes `domain`, `contracts`, SQLite `storage`, `analysis-core`, the authenticated `apps/local-agent`, the local web explorer, and an initial command-based VS Code extension. The extension reuses the agent for workspace analysis and graph navigation; a local VSIX has been packaged, while Extension Host, installation, and cross-platform verification remain pending. Selective incremental analysis and cloud sync are not implemented. The user-directed MVP architecture and implementation sequence are in [ADR 0006](decisions/0006-local-companion-agent.md) and [TECH_STACK.md](TECH_STACK.md).

The local API currently requires a `CODIFIER_AGENT_TOKEN` of at least 32 bytes, binds only to loopback, and checks Host/Origin. The selected SQLite adapter is `better-sqlite3` with Drizzle; it stores the current graph plus append-only graph snapshot history as described in [ADR 0009](decisions/0009-local-graph-revision-storage.md). History export and UI, retention, cross-platform native packaging, secure token provisioning/pairing, cloud provider/identity, sync conflict rules, and the OS support matrix still require implementation, validation, or separate decisions.

## Install and validate

Use Node.js 24.x and the pinned pnpm version from the root `package.json`:

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm format:check
```

`pnpm check` runs lint, type-checking, and tests across the workspace. Native SQLite installation and packaging should also be validated on each supported operating system before release.

## Run the local agent

In PowerShell, generate a random token and launch the server:

```powershell
$env:CODIFIER_AGENT_TOKEN = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
pnpm --filter @codifier/local-agent start -- serve
```

The default listener is `127.0.0.1:4141`; the default SQLite file is under the current user's application-data directory. Keep the token private and set the same value in the terminal running each client command:

```powershell
$env:CODIFIER_AGENT_TOKEN = "<same token>"
pnpm --filter @codifier/local-agent start -- health
pnpm --filter @codifier/local-agent start -- graph get <repository-uuid>
pnpm --filter @codifier/local-agent start -- graph put .\snapshot.json
```

`graph put` validates the JSON snapshot before sending it to the agent. Use `serve --database <path>` to select a database file; the agent intentionally rejects non-loopback bind addresses. Authenticated clients can list graph revisions at `/v1/repositories/<repository-uuid>/revisions` retrieve a snapshot at `/v1/repositories/<repository-uuid>/revisions/<revision-uuid>`, and restore it by `POST` to `.../revisions/<revision-uuid>/restore`, which commits a new revision and keeps history ([ADR 0014](decisions/0014-graph-revision-restore.md)). To use a browser client, explicitly allow its loopback origin with `CODIFIER_AGENT_ALLOWED_ORIGINS` as a comma-separated list. Source files are read locally by the agent and are not sent to an external service.

## Run the local web explorer

The browser UI uses the same local agent; it does not scan the filesystem itself. Start the agent in one PowerShell terminal with the Vite origin allowed:

```powershell
$env:CODIFIER_AGENT_TOKEN = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$env:CODIFIER_AGENT_ALLOWED_ORIGINS = "http://127.0.0.1:5173"
pnpm --filter @codifier/local-agent start -- serve
```

Keep that token available in the second terminal, start the web app, and open the local address:

```powershell
$env:CODIFIER_AGENT_TOKEN = "<same token>"
pnpm --filter @codifier/local-web dev
```

Open `http://127.0.0.1:5173`, enter the token in the connection panel, and connect. The browser keeps the token in memory only. Enter a repository folder path to analyze it, or enter a previously printed repository UUID to load/refresh an existing graph. Analysis shows the current stage and file progress and can be cancelled; a cancelled or incomplete job leaves the last saved graph unchanged. After a successful save, the explorer shows an initial-map count or added/changed/removed entity and relationship counts from the previous saved graph; incomplete analyses do not show a change summary. Switch between the searchable Browse list and a React Flow map centered on the selected file or symbol and its direct relationships. The map is bounded for readability; the full list remains available as the structured alternative. Use **Find source in map** with a repository-relative `path:line` or `path:line:column` to find graph items at a source location; matches are ordered from narrowest to widest range. The explorer also supports coverage and diagnostics, evidence provenance, copyable source locations, and an **Open in VS Code** link that uses the VS Code `vscode://file/` URI handler to open the recorded source range. A browser may ask permission to open VS Code; VS Code must be installed and registered as the handler. For a saved graph, enter its repository path before using source navigation.

## VS Code extension development

See [the extension guide](../apps/vscode-extension/README.md). Start the agent with `CODIFIER_AGENT_TOKEN`, open the repository root in VS Code, and press **F5** to launch the saved **Run Codifier Extension Host** configuration. Connect through **Codifier: Connect to Local Agent**, analyze the workspace, then use the architecture lookup and source navigation commands. The extension stores credentials in VS Code SecretStorage and rejects non-loopback agent URLs. Generate a local package with `pnpm --filter codifier-vscode exec vsce package --no-dependencies --allow-missing-repository`; Extension Host workflow, installation, and supported editor versions still need verification.

The authenticated job API uses `POST /v1/analysis-jobs` for a new repository and `POST /v1/repositories/:repositoryId/analysis-jobs` to refresh a saved one, `GET /v1/analysis-jobs/:jobId` to poll, and `DELETE /v1/analysis-jobs/:jobId` to request cancellation. Job requests, progress, and outcomes persist in SQLite; at most two jobs run concurrently and 50 records are retained. After restart, interrupted queued/running jobs are reported as failed with a retry message; their partial work is not committed. Existing synchronous analyze endpoints remain available for the CLI.

Run analysis through the agent (not directly from the CLI):

```powershell
pnpm --filter @codifier/local-agent start -- analyze C:\path\to\repository
pnpm --filter @codifier/local-agent start -- analyze C:\path\to\repository <repository-uuid> --revision <revision>
```

The first command creates and prints a repository UUID; reuse it for future analyses. The initial inventory supports `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`, `.mjs`, and `.cjs`; it excludes `.git`, `node_modules`, common build/cache folders, and does not follow symlinks. Gitignored directories are not entered, and ignored, excluded, and symlinked paths are reported without blocking persistence. Root and nested `.gitignore` files are honored by default for common `*`, `**`, `?`, slash-scoped, directory-only, and negated rules; unsupported escaped/bracket-class patterns are reported. Authenticated web analysis requests can disable `.gitignore` or add repository-relative glob exclusions. Configured exclusions only add skips and cannot override built-in safety directories. The inventory caps at 10,000 files, individual source/manifest/ignore-file reads at 1 MiB, aggregate source/manifest reads at 100 MiB, and ignore-policy reads at 128 files/4 MiB total. TypeScript configuration inheritance is restricted to in-repository files (up to 32 files and 4 MiB total). Relative imports, inherited `compilerOptions.paths` aliases, and local workspace package imports declared in `package.json` are resolved only when their targets are inventoried inside the selected repository/package. These are safeguards and initial resolution boundaries, not full TypeScript semantic analysis. Unsupported files and syntax/read/configuration errors are reported. An incomplete analysis is returned but does not replace the last persisted graph. Re-analysis conservatively preserves IDs for matched files/symbols; ambiguous matches are surfaced in diagnostics.

## Remaining decisions before expanding the MVP

Resolve and record these in `docs/decisions/`:

1. **First user workflow and success criteria:** select a narrow repository-understanding task and measurable accuracy/latency/resource targets.
2. **Language coverage and repository policy:** define TypeScript/JavaScript constructs, ignore behavior, file-size limits, symlink handling, and treatment of generated/vendor directories; validate with golden fixtures.
3. **Local API security:** define token lifecycle, secure token storage/pairing, supported client origins, and browser pairing.
4. **Persistence and sync:** define PostgreSQL schema, sync authorization/conflicts/retention, and backup/recovery.
5. **AI boundary:** decide whether the first workflow uses an LLM, providers, what data can be sent, and how users opt in.
6. **Quality gates and platforms:** validate native-module packaging and supported OS targets.

Continue incrementally with source navigation, improved analyzer coverage, and a focused user test before adding sync or cloud infrastructure.

## Local data and secrets

- Never put API keys, tokens, passwords, or real repository secrets in source control.
- Keep any local configuration and analysis cache out of Git.
- Do not transmit source code to a remote AI service until provider, data scope, consent, retention, and redaction behavior are documented. Cloud graph sync is separately bounded to an approved metadata/events contract.
- Prefer synthetic fixtures for development and bug reports.

## Environment decisions and pins

| Item                            | Decision                                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime and version             | Node.js 24.14.1 for the initial workspace; Node 24.x required by `package.json`                                                            |
| Package manager and version     | pnpm 12.16.1 via Corepack; pinned in `packageManager`                                                                                      |
| Supported operating systems     | Windows, macOS, and Linux are a product direction; first-release support is open                                                           |
| Local persistence               | `better-sqlite3` + Drizzle implemented; migration/round-trip tested on Windows; cross-platform packaging, backup, and recovery remain open |
| Cloud database                  | PostgreSQL + Drizzle target for optional graph sync; provider, identity, authorization, schema, retention, and sync policy remain open     |
| AI provider and opt-in behavior | Open                                                                                                                                       |
| Installed checks                | TypeScript 6.0.3, `@types/node` 24.19.2, ESLint 10.13.0, Prettier 3.9.10, Vitest 5.0.5, Turborepo 2.11.10                                  |
