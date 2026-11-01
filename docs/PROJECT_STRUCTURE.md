# Project structure

## Status

This is the target organization for the user-directed MVP monorepo. The pnpm workspace, shared tooling, graph `domain`/`contracts`, SQLite `storage`, initial `analysis-core`, `apps/local-agent` CLI/API, and first `apps/local-web` explorer are implemented. The web client can author intended components and map them to observed code through the local agent; analysis-core preserves this intent during re-analysis. Deeper semantic analysis, a shared typed agent-client package, VS Code, and sync remain planned. Create additional folders incrementally as their milestone begins; do not add empty placeholder packages for deferred capabilities.

The structure follows the standalone local-agent architecture and ordered milestones in the [implementation plan](IMPLEMENTATION_PLAN.md). Package boundaries are logical boundaries inside one pnpm/Turborepo workspace, not a requirement to deploy every package as a separate service.

## Target repository tree

```text
codifier/
├── AGENTS.md
├── README.md
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── .node-version
├── turbo.json
├── tsconfig.base.json
├── eslint.config.js
├── prettier.config.js
├── .prettierignore
├── playwright.config.ts                 # Add with local-web end-to-end tests
├── .editorconfig
├── .gitignore
├── .npmrc
├── assets/
│   └── brand/
│       └── codifier-logo.svg            # Logo source; extension icon and web favicon are rendered from it
├── .github/
│   └── workflows/
│       ├── checks.yml
│       └── release.yml                  # Add when releases are defined
├── apps/
│   ├── local-agent/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── cli.ts                   # Commander entry point and lifecycle
│   │   │   └── server.ts                # Authenticated Fastify REST/WebSocket API
│   │   └── test/
│   │       └── server.test.ts           # API, auth, Host/Origin, and WebSocket tests
│   ├── vscode-extension/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── extension.ts             # Activation and composition root
│   │   │   ├── agent/                   # Agent discovery, start/connect, status
│   │   │   ├── commands/
│   │   │   ├── navigation/              # Source and graph bidirectional links
│   │   │   ├── views/                   # Tree, map/webview, diagnostics
│   │   │   └── settings/
│   │   └── test/
│   │       ├── unit/
│   │       └── extension/
│   ├── local-web/                       # Implemented Vite/React explorer (Tailwind CSS v4)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   ├── src/
│   │   │   ├── main.tsx
│   │   │   ├── app.tsx                  # Repository setup, explorer, details
│   │   │   ├── agent/client.ts          # Loopback-only authenticated API client
│   │   │   └── styles.css               # Tailwind v4 theme and base layer
│   │   └── test/
│   │       └── client.test.ts
│   └── cloud-api/
│       ├── package.json
│       ├── tsconfig.json
│       ├── src/
│       │   ├── main.ts                  # Cloud API composition root
│       │   ├── routes/                  # Authenticated sync endpoints
│       │   ├── auth/                    # Cloud identity/workspace authorization
│       │   └── services/                # Idempotent graph event ingestion
│       └── test/
│           ├── unit/
│           ├── integration/
│           └── security/
├── packages/
│   ├── domain/                          # Canonical graph, evidence, locators, invariants
│   ├── contracts/                       # Zod schemas and versioned REST/WS/sync messages
│   ├── graph/                           # Graph use cases, identity, queries, rule inputs
│   ├── analysis-core/                   # Bounded TS/JS AST, module resolution, identity
│   ├── analyzer-typescript/             # TS/JS parser and semantic adapter
│   ├── storage/                         # Implemented Drizzle/SQLite adapter and migrations;
│   │                                    # PostgreSQL adapter remains future work
│   ├── sync/                            # Outbox, retries, idempotency, conflict reporting
│   ├── agent-client/                    # Typed authenticated client for CLI and UI clients
│   ├── git/                             # Git revision and working-tree adapter
│   └── architecture-rules/              # Basic evidence-backed rule evaluation
├── fixtures/
│   └── golden-repositories/
│       └── typescript-basic/             # Synthetic source and expected graph results
├── tests/
│   ├── integration/                     # Cross-package graph, agent, storage, and sync tests
│   └── e2e/                             # User-facing flows across clients
├── scripts/                             # Workspace checks and packaging utilities only
└── docs/
    ├── ...                              # Product, architecture, engine, and pipeline guides
    ├── decisions/
    ├── engines/
    └── pipelines/
```

The implemented paths include `packages/domain/src/index.ts`, `packages/contracts/src/index.ts`, `packages/storage/src/{index,schema,migrations}.ts`, `packages/analysis-core/src/index.ts`, `fixtures/golden-repositories/`, and the local-agent and local-web files shown above. Entries in the rest of the tree are target organization, not claims that those packages exist. The cloud API is needed only for the minimal synchronization milestone; do not create or deploy cloud infrastructure until sync authorization and data policies are defined.

## Target package ownership and dependency direction

The current dependency slice is `apps/local-agent` → `packages/contracts`, `packages/domain`, and `packages/storage`; both `contracts` and `storage` depend on `domain`. The local CLI currently calls the agent's REST API directly. Extracting the shared typed `agent-client` and adding analysis/graph/sync packages are later milestones represented below.

```text
apps/local-agent ──┬──> packages/analysis-core ──> packages/analyzer-typescript
                   ├──> packages/graph ──────────> packages/domain
                   ├──> packages/storage ────────> packages/domain
                   ├──> packages/sync ───────────> packages/contracts
                   └──> packages/contracts

apps/vscode-extension ──> packages/agent-client ──> packages/contracts
apps/local-web ─────────> packages/agent-client ──> packages/contracts
apps/local-agent/cli ───> packages/agent-client ──> packages/contracts

apps/cloud-api ─────────> packages/sync + packages/storage + packages/contracts
packages/architecture-rules ──> packages/graph + packages/domain
packages/git ───────────> packages/domain
```

Dependency rules:

- `domain` contains framework-free types and invariants; it must not import UI, database, filesystem, or network packages.
- `contracts` validates data at process/API boundaries and refers to domain concepts without becoming the graph store.
- `analysis-core` and language adapters produce versioned intermediate records; graph ingestion validates them before persistence.
- Only the local agent and cloud API compose storage adapters. UI and CLI clients do not open SQLite/PostgreSQL directly.
- The extension, web UI, and CLI share the typed agent client and do not implement separate analysis or graph mutations.
- Keep cloud sync as an explicit boundary; never make local analysis dependent on a cloud API.
- Add AI/MCP, runtime analysis, plugins, and enterprise packages only after their separate scope and decisions are accepted.

## Tests and fixtures

- Keep fast unit tests next to each package or in that package's `test/` directory.
- Use `fixtures/golden-repositories/` for synthetic source inputs and expected symbols, relationships, provenance, and exact ranges.
- Put tests requiring multiple packages, real SQLite/PostgreSQL instances, or HTTP/WebSocket boundaries in `tests/integration/` or the owning app's `test/integration/`.
- Put cross-client workflows and keyboard/browser checks in `tests/e2e/` and `apps/local-web/test/browser/`.
- Security tests must cover local tokens, WebSocket handshakes, Host/Origin checks, browser pairing, path boundaries, sync authorization, and event replay/idempotency.
- Never put customer repositories, credentials, or real source-derived data in fixtures.

## Local data and generated files

- Keep SQLite databases, WAL files, caches, logs, tokens, and temporary analysis output under a user-controlled application-data directory; never commit them.
- Do not write indexes or generated graph artifacts into the analyzed repository unless a future explicit export feature is designed.
- Store only safe setting examples in tracked configuration templates; secrets belong in an OS-backed secret store or an approved equivalent.
- Keep generated build output, coverage, packaged VSIX files, and web bundles out of source control.

## Scaffold order

Create the tree as implementation starts, not all at once:

1. Root workspace/config files, `packages/domain`, `packages/contracts`, and tests/fixtures foundation.
2. SQLite/PostgreSQL storage package and graph use cases.
3. Local agent, authenticated REST/WebSockets, CLI, and agent client.
4. TypeScript/JavaScript analysis packages, identity/evidence, and incremental jobs.
5. Local web and VS Code clients, visualization, and exact source navigation. The initial local web explorer and `apps/vscode-extension` both use the local agent; the extension supports source-to-architecture lookup and freshness-checked architecture-to-source navigation. Host verification and VSIX packaging remain pending.
6. Sync endpoints/outbox, intended/actual comparison, Git, and architecture rules according to the agreed MVP sequence.

The [development setup](DEVELOPMENT_SETUP.md) documents how to run the current local agent and the remaining packaging, security, and policy decisions before expanding the scaffold.
