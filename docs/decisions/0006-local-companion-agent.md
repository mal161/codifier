# 0006: Local companion agent and user-directed MVP stack

- Status: accepted
- Date: Not stated; recorded from the user's explicit direction

## Context

Codifier needs local repository access, analysis, graph operations, and offline persistence shared by multiple clients. Hosting analysis independently in the VS Code extension would duplicate behavior and prevent the local web application and CLI from using the same service. The user explicitly requires a standalone local Node.js/TypeScript agent. The later MVP implementation specification makes cloud synchronization conditional on explicit data-scope and conflict decisions.

## Decision

- Build a standalone local companion agent as a required MVP component. It owns repository access, analysis, canonical graph operations, and SQLite persistence. Add a durable sync outbox only if cloud synchronization is selected after the required policy decisions.
- CLI, VS Code extension, and local React web application are clients of the same agent. The analyzer and graph domain do not depend on UI, IDE, or cloud.
- Use pnpm workspaces and Turborepo; TypeScript/Node.js; Commander.js for CLI; Fastify REST and WebSockets for the local API; SQLite through Drizzle; React/Vite and React Flow for the local client/map; Zod for runtime contract validation; Chokidar for file watching; and Pino for structured logging. PostgreSQL through Drizzle is a conditional cloud-sync target, not a local-MVP prerequisite.
- Keep analysis and graph browsing functional offline. If cloud sync is approved, synchronize only the explicitly approved graph metadata/events contract using durable outbox delivery and idempotent ingestion. Do not upload complete source repositories by default.
- Prioritize MVP work in the order recorded in the [implementation plan](../IMPLEMENTATION_PLAN.md#mvp-execution-order) and [remaining-feature phases](../REMAINING_FEATURES_PHASES.md), including TypeScript/JavaScript with React/Express conventions first, then stable identity, evidence, incremental sync, visualization, precise source links, intended/actual comparison, Git, and basic architecture rules.
- Defer Python/Django/Flask, advanced AI orchestration, runtime analysis, multi-agent execution, enterprise governance, and plugin marketplace.
- Bind the local API to loopback by default and authenticate REST and WebSocket connections. Validate Host and Origin; hosted-browser access requires explicit pairing and browser private-network safeguards.

This decision fixes the local-agent architecture and the user-specified technologies above. Exact versions, native SQLite package, token-pairing protocol, cloud provider, cloud identity, data retention, sync conflict policy, and target performance remain implementation decisions or open requirements; this ADR does not authorize cloud infrastructure or source-code upload. Cloud sync remains gated by [the remaining-feature phases](../REMAINING_FEATURES_PHASES.md#phase-7--conditional-cloud-synchronization).

## Alternatives considered

- Run analysis inside the VS Code extension: rejected because the agent must be shared with CLI and local web clients.
- Require cloud connectivity for analysis or persistence: rejected because the product must operate offline.
- Upload complete repositories by default: rejected in favor of local source retention and an explicit graph metadata/events synchronization contract.
- Introduce microservices, Redis/BullMQ, or a graph database for the MVP: deferred until validated workload justifies them.
- Use a hosted web page to access localhost without explicit pairing: rejected because loopback binding alone is not browser authorization.

## Consequences

- Agent lifecycle, protocol versioning, crash recovery, local database migration, and secure client pairing are MVP concerns.
- SQLite and PostgreSQL need compatible domain contracts but may require backend-specific migrations and queries.
- Sync requires explicit workspace authorization, event ordering, idempotency, conflict behavior, retention, export, and deletion rules before it is enabled.
- Security testing must cover loopback API tokens, Host/Origin checks, WebSockets, browser-origin access, repository path boundaries, and sync authorization.
- See the [local companion agent specification](../engines/local-companion-agent.md), [technology stack](../TECH_STACK.md), and [security and privacy guide](../SECURITY_PRIVACY.md).
