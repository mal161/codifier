# End-to-end technology stack recommendation

## Status

**User-directed architecture with proposed implementation details.** The required standalone local agent, shared local clients, offline analysis, and incremental cloud synchronization are recorded in [ADR 0006](decisions/0006-local-companion-agent.md). Exact package versions, native drivers, cloud vendor, identity provider, and some client/framework choices still require validation.

## Executive recommendation

Use a **TypeScript modular monorepo** with a standalone **local companion agent as a required MVP component**. The agent owns repository access, analysis, graph operations, local SQLite persistence, offline work, and synchronization. A VS Code extension, CLI, and local React web application are clients of the same agent; none embeds a second analyzer.

The MVP has a local-first path and a minimal cloud path: the local agent works without connectivity, writes to SQLite, and queues graph synchronization; when connected, a Fastify cloud API persists shared graph data in PostgreSQL. Do not upload complete source repositories by default. Keep analyzer, graph domain, evidence, and source-location behavior independent of UI, storage vendor, cloud provider, and AI provider.

The exact local-agent responsibilities and MVP sequencing below reflect the user's latest direction. Specific package versions, native drivers, cloud vendor, identity provider, and browser pairing protocol remain proposals requiring validation.

## Updated direction versus the previous recommendation

The attached stack proposal and follow-up requirements supersede the earlier recommendation to run analysis inside the VS Code extension and postpone cloud persistence:

- The standalone local agent is fundamental to the MVP, not a later optional service.
- The agent owns the local HTTP/WebSocket API, CLI, repository analysis, SQLite persistence, and offline sync outbox.
- VS Code and the local React application communicate with the same agent.
- Local SQLite and cloud PostgreSQL are both in the planned graph architecture; online synchronization must not be required for analysis.
- pnpm workspaces and Turborepo form the monorepo foundation.
- Drizzle ORM replaces the earlier Kysely recommendation for SQLite and PostgreSQL.
- The MVP includes hierarchical React Flow visualization, bidirectional source traceability, intended/actual comparison, Git integration, and basic architecture rules.
- AI orchestration, runtime instrumentation, multi-agent execution, enterprise governance, and plugin marketplace remain deferred.

These are not a mandate to build every engine in the product catalog. See the [MVP execution order](IMPLEMENTATION_PLAN.md#revised-mvp-execution-order).

## Recommended stack by layer

| Layer                           | Recommendation                                                                                                                                                    | When                                 |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Primary language                | TypeScript with strict compiler options                                                                                                                           | MVP and shared application services  |
| Runtime                         | Pinned Node.js LTS for the standalone agent; clients communicate over versioned APIs                                                                              | MVP                                  |
| Monorepo/build                  | pnpm workspaces + Turborepo; keep workspace packages minimal and use Turbo for affected-task caching                                                              | MVP foundation                       |
| Local companion agent           | Standalone Node.js + TypeScript process; sole owner of repository access, analysis, graph, SQLite, and sync                                                       | Required MVP                         |
| CLI                             | Commander.js commands call the local agent API rather than duplicate business logic                                                                               | MVP                                  |
| Local API                       | Fastify REST + WebSockets; bind to `127.0.0.1`; authenticate every connection with a token                                                                        | MVP                                  |
| IDE surface                     | VS Code Extension API; client of the local agent, responsible for editor navigation only                                                                          | MVP                                  |
| Local web UI                    | React + Vite + TypeScript; connects to the same local agent                                                                                                       | MVP                                  |
| UI styling/components           | Tailwind CSS + shadcn/ui; semantic labels and accessible states                                                                                                   | MVP                                  |
| Graph visualization             | React Flow (`@xyflow/react`) for hierarchical maps; paired keyboard-operable tree/list/table                                                                      | MVP                                  |
| Client state                    | Zustand for local view state; TanStack Query for API query/cache state where useful                                                                               | MVP                                  |
| Syntax analysis                 | Tree-sitter through a cross-platform packaging spike; versioned language adapters and common IR                                                                   | Analyzer                             |
| TypeScript/JavaScript semantics | TypeScript compiler API for project-aware symbol/type resolution; preserve unresolved relationships                                                               | Initial language target              |
| Framework analysis              | React and Express conventions only where covered by golden fixtures                                                                                               | MVP                                  |
| Additional language semantics   | Python, Django, and Flask after the TypeScript/JavaScript quality gate                                                                                            | Later                                |
| Core/domain model               | TypeScript packages for graph contracts, evidence, locators, queries, and validation; no UI or provider dependencies                                              | MVP onward                           |
| Local persistence               | SQLite + Drizzle ORM for graph, symbol index, job state, sync outbox, and local config                                                                            | MVP                                  |
| Cloud persistence               | PostgreSQL + Drizzle ORM; relational graph tables and recursive CTEs; no graph database initially                                                                 | MVP synchronization backend          |
| API contracts                   | Zod runtime validation and versioned REST/OpenAPI + WebSocket message contracts                                                                                   | MVP                                  |
| Local file watch                | Chokidar behind a watcher interface; debounce/coalesce changes; never execute project hooks                                                                       | MVP                                  |
| Logging                         | Pino structured logs with source/secret redaction                                                                                                                 | MVP                                  |
| Local jobs/sync                 | SQLite-backed durable jobs/outbox and idempotent event delivery                                                                                                   | MVP                                  |
| Cloud jobs                      | BullMQ + Redis only if measured workload justifies an asynchronous worker                                                                                         | Later                                |
| AI integration                  | Provider-neutral adapter, bounded context retrieval, runtime validation, secure credentials, explicit opt-in; choose provider SDK only after data-policy decision | Optional later                       |
| Agent integration               | Official TypeScript MCP SDK behind a read-only query interface                                                                                                    | After graph/API contracts stabilize  |
| Tests                           | Vitest, golden repos, VS Code Extension Test Runner, Playwright for the local web UI                                                                              | From first code                      |
| Quality/CI                      | ESLint, Prettier, TypeScript checks, GitHub Actions, Turbo pipelines, OS packaging matrix                                                                         | From scaffold                        |
| Observability                   | OpenTelemetry-compatible instrumentation and structured, redacted logs; local diagnostics first; backend/exporter selected later                                  | Incrementally                        |
| Cloud candidate                 | AWS ECS Fargate + RDS PostgreSQL; Cognito/OIDC, Secrets Manager, CloudWatch; all provider choices remain unapproved                                               | MVP synchronization/cloud evaluation |
| Cloud assets                    | No object store initially; add S3 only for a defined export/artifact use case                                                                                     | Later                                |

These choices reflect the user's latest stack requirements where stated; exact versions and native packages remain subject to cross-platform packaging spikes. The cloud vendor, identity service, and cloud observability provider remain proposals.

The initial TypeScript/JavaScript analyzer slice uses the existing TypeScript compiler AST to get fixture-backed coverage into the local agent. This implementation detail does not supersede the Tree-sitter direction; validate parser packaging before expanding to additional languages.

## Architecture from local MVP to full product

### Phase A: Local-first MVP with required companion agent

```text
VS Code Extension ───┐
CLI ─────────────────┼── authenticated REST/WebSocket ── Local Agent
Local React Web App ─┘                                      ├─ Repository inventory
                                                            ├─ Analysis engine
                                                            ├─ Canonical graph
                                                            ├─ SQLite + Drizzle
                                                            └─ Durable sync outbox
                                                                  │ when online
                                                                  ▼
                                                         Cloud Fastify API
                                                                  │
                                                        PostgreSQL + Drizzle
```

The local agent is the single owner of repository access and analysis. CLI, extension, and local web clients share the same graph/query contracts. The agent binds only to `127.0.0.1` by default, authenticates every REST and WebSocket connection, validates Host/Origin, and rejects unauthenticated or cross-origin requests. A hosted web page must not be assumed able to access localhost safely; require explicit pairing and browser-origin/private-network safeguards before enabling that path.

Analysis, graph navigation, and local persistence work offline. Synchronization sends approved graph metadata/events only, not complete source files by default. Use a durable local outbox and idempotent cloud ingestion; define conflicts and repository/workspace authorization before sync is enabled.

### Phase B: Minimal MVP cloud synchronization

The requested MVP priorities include local SQLite and cloud PostgreSQL. Begin with minimal sync and workspace identity, preserve offline use, and authorize each operation. Define which metadata leaves the device, conflict behavior, account ownership, retention, export, and deletion. Do not build broad collaboration workflows simply because a cloud database exists.

### Phase C: Evidence-grounded AI (later/optional)

Add bounded retrieval from local graph facts and source excerpts, followed by a provider adapter. Keep context construction and evidence validation independent from provider SDKs. Require explicit user control before sending repository context outside the machine. Local models may use the same provider contract.

### Phase D: Expanded shared SaaS

```text
Hosted React Client ───┐
                       ├── Cloud Fastify REST API ── PostgreSQL + Drizzle
Local Agent (sync only)┘

VS Code / CLI / Local React Client ── authenticated loopback API ── Local Agent
```

Start with one deployable modular API. Separate workers, object storage, cloud WebSockets, and service decomposition only when workload or validated product requirements justify them. Keep repository source local by default.

**Concrete hosting default to evaluate:** AWS ECS Fargate + RDS PostgreSQL, with Cognito for OIDC identity, Secrets Manager for runtime secrets, and CloudWatch as the initial telemetry backend behind OpenTelemetry instrumentation. Host a later static React client on S3/CloudFront if a web client is justified. Do not introduce S3, SQS, a worker service, or Kubernetes until a real product need exists. This is a recommended default, not an accepted cloud-provider decision; compare cost, operational ownership, data residency, and portability needs before adoption.

### Phase E: External agents and enterprise capabilities

Expose read-only architecture queries through MCP after authorization, evidence, result-bound, and API contracts are tested. Add write or code-modification tools only after explicit approval and audit/rollback semantics exist. Treat self-hosted deployment, billing, customization, compliance, and plugins as separate product decisions.

## Monorepo layout proposal

The detailed target tree, package responsibilities, dependency rules, test placement, local-data handling, and scaffold sequence are in [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md). The summary below is only a quick overview.

```text
apps/
  local-agent/           # Agent process, CLI, Fastify REST/WebSocket, sync
  vscode-extension/      # VS Code activation, commands, views, editor navigation
  local-web/             # React/Vite local client for the same agent
  api/                   # Cloud Fastify API and graph synchronization
  web/                   # Later hosted React/Vite client, if needed
packages/
  domain/                # Graph types, provenance, source locators, invariants
  analyzer/              # Repository inventory, IR, parser/semantic adapters
  graph/                 # Graph operations, queries, identity reconciliation
  storage/               # Drizzle SQLite/PostgreSQL adapters and migrations
  contracts/             # Zod schemas and versioned API contracts
  sync/                  # Local outbox, idempotency, conflict policy
  ai/                    # Context retrieval/provider boundary, later
fixtures/
  golden-repositories/   # Synthetic language fixtures and expected graph output
```

Use pnpm workspaces and Turborepo as requested, but begin with only packages needed by the first vertical slice. Keep modular boundaries without prematurely building every planned service/package.

## Key technology choices and trade-offs

### TypeScript and Node.js

**Why:** one language can cover the agent, analyzer orchestration, graph contracts, APIs, clients, and later MCP adapter; strict shared types reduce contract drift.

**Trade-off:** native parser/database modules and VS Code's extension runtime can complicate packaging. Keep native dependencies out until a cross-platform VSIX build/test spike succeeds.

### Shared local agent with multiple clients

**Why:** a standalone agent centralizes repository access, analysis, graph operations, and local persistence. CLI, VS Code, and the local web UI can use the same service and contracts.

**Trade-off:** a local HTTP/WebSocket server creates a browser and local-network security boundary. Bind to loopback only, require per-installation token authentication, validate Host/Origin, and test WebSocket/browser protections. Keep core packages client-neutral.

### Tree-sitter plus language-specific semantics

**Why:** Tree-sitter supports the approved multi-language syntax direction; semantic adapters provide deeper resolution only when evidence exists. The TypeScript compiler API can supply project-aware TypeScript/JavaScript semantics.

**Trade-off:** two analysis mechanisms for the first language and parser packaging risk. Run a prototype that verifies real source ranges, incremental updates, and Windows/macOS/Linux packaging before committing to exact bindings and grammar distribution.

### SQLite locally and PostgreSQL for cloud synchronization

**Why:** SQLite keeps offline analysis self-contained; PostgreSQL is a fit for cloud graph synchronization and shared durable data. Drizzle is the requested ORM for both stores.

**Trade-off:** schemas, migrations, constraints, and query behavior can diverge. Do not promise conflict-free sync or share every SQL query. Establish a portable graph repository contract, durable local outbox, idempotent cloud ingestion, explicit conflict handling, and backend-specific tests. Validate the SQLite driver across supported operating systems.

### Authenticated local REST and WebSockets

**Why:** the required local clients need a shared API, with REST for commands/queries and WebSockets for streaming updates and progress. Define versioned Zod-validated contracts and OpenAPI documentation.

**Trade-off:** localhost is not a trust boundary. Authenticate both transports, restrict binding to loopback, validate Host/Origin, reject unexpected browser origins, rate-limit and bound requests, and rotate/revoke tokens safely. A hosted page must not connect without explicit pairing and browser private-network safeguards.

### One deployable service before microservices

**Why:** few operational owners and no validated scale justify beginning with a modular monolith.

**Trade-off:** scale and failure isolation are less independent. Preserve internal module boundaries and extract a worker/service only when measurements support it. Kubernetes is not needed for the initial service.

## Recommended development and release toolchain

- Pin Node.js LTS, pnpm, and package versions; commit `pnpm-lock.yaml`.
- Use `tsc --noEmit`, ESLint, Prettier, and Vitest in local and CI checks.
- Add golden fixture tests before claiming a language is supported.
- Use the VS Code Extension Test Runner for agent lifecycle/client integration, commands, workspace handling, and source navigation.
- Build and install a packaged VSIX in CI on supported OS targets; a passing unit test alone does not validate native dependencies or extension packaging.
- Use GitHub Actions for checks and release automation; publish only signed/reviewed extension artifacts through the chosen distribution process.
- Select dependency/security scanning and artifact signing policy before public release; do not make unsupported security claims.
- Use Playwright for the local web UI and browser-origin/API security checks; test canvas accessibility with a structured alternative.

## Decisions that remain to be confirmed

1. First workflow and measurable success criteria.
2. Exact TypeScript/JavaScript and React/Express analysis coverage and supported OS/runtime versions.
3. Repository ignore, size, generated-file, symlink, and secret-handling policy.
4. SQLite driver, migration strategy, cloud synchronization protocol, conflict resolution, and account/workspace ownership.
5. Authentication/pairing design for local clients, especially browser-origin protections.
6. AI inclusion, provider, and data-flow policy.
7. Cloud hosting/identity vendor, retention, data residency, and performance targets.

## Adoption gates

Before implementation choices are locked, build small spikes that:

- Run/package the standalone local agent and authenticated REST/WebSocket clients on all intended operating systems.
- Parse fixture repositories and verify exact source ranges.
- Perform project-aware symbol resolution for the selected first language.
- Demonstrate acceptable indexing and cancellation on representative repositories.
- Prove SQLite and PostgreSQL migrations, local outbox delivery, idempotency, and recovery.
- Verify API token, Origin/Host, WebSocket, and browser-origin protections.
- Confirm accessibility of the React Flow map and its structured alternative.
- For the SaaS phase, compare the proposed AWS baseline with at least one lower-operations alternative and verify projected operating costs and regional availability.

If a gate fails, revise the specific implementation choice before broad scaffolding. Do not add cloud infrastructure or AI provider dependencies to work around an unresolved policy or product decision.

## Related documentation

- [Product requirements](PRODUCT_REQUIREMENTS.md)
- [Development setup](DEVELOPMENT_SETUP.md)
- [Architecture overview](ARCHITECTURE.md)
- [Analysis pipeline](ANALYSIS_PIPELINE.md)
- [Security and privacy](SECURITY_PRIVACY.md)
- [Engine catalog](engines/README.md)
- [Open decisions](decisions/README.md)
