# 0005: Initial VS Code-first stack proposal (superseded)

- Status: superseded
- Date: 2026-10-30

## Context

An earlier stack analysis recommended implementing analysis inside a VS Code extension, delaying durable cloud synchronization, and choosing SQLite only if extension packaging validated. This proposal predates the user's explicit requirement for a standalone local companion agent shared by CLI, VS Code, and local web clients.

## Decision

This proposal is superseded by [0006: Local companion agent and user-directed MVP stack](0006-local-companion-agent.md). Do not use the former VS Code-hosted analyzer, deferred cloud storage, Kysely, or REST-only recommendation as the current implementation direction.

The original proposal is retained in [the stack analysis](../TECH_STACK.md) only as history; its detailed recommendations have been revised to match the current direction.

## Alternatives considered

The earlier alternatives included VS Code-hosted analysis, web-first SaaS, Python-first implementation, all-cloud deployment, a graph database, and microservices. The current decision retains a modular monorepo and relational stores, while requiring a standalone agent and shared local clients.

## Consequences

- The local agent is the single owner of repository access, analysis, graph operations, SQLite persistence, and synchronization.
- CLI, VS Code, and local React web clients share the same agent and contracts.
- Local analysis remains offline-capable; cloud sync is explicit and metadata-bounded.
- Remaining framework details, package versions, native drivers, cloud provider, and identity provider must be tracked separately and validated.
