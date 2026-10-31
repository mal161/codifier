# Local companion agent

## Status and purpose

The standalone local companion agent is a required part of the user-directed MVP architecture. It is one local process, not a separately deployed microservice. It provides the shared boundary for the CLI, VS Code extension, and local React web application.

The exact package versions, SQLite driver, token-pairing UX, and cloud identity/hosting choices remain subject to implementation spikes and separate decisions.

## Responsibilities and ownership

The agent is the sole owner of:

- Repository discovery, bounded file access, and analysis job lifecycle.
- Canonical graph operations, evidence/provenance, source locators, and query behavior.
- Local SQLite storage, schema migrations, job state, and durable synchronization outbox.
- Authenticated local REST and WebSocket APIs.
- Optional cloud synchronization of approved graph metadata/events to the cloud API.

Clients request actions and render results; they do not independently scan repositories, mutate graph state, or maintain competing analysis indexes. Operational CLI commands use the agent API. Agent lifecycle commands may start or stop the process, but must not create a second analysis or persistence implementation.

## Interfaces

| Interface | Responsibility |
|---|---|
| CLI (Commander.js) | Start/stop/status, analyze, query, sync, and diagnostics commands using shared contracts. |
| Local REST (Fastify) | Versioned commands and queries with Zod input/output validation and OpenAPI documentation. |
| Local WebSockets (Fastify) | Authenticated progress and change notifications; bounded payloads and explicit reconnect behavior. |
| VS Code extension | Agent lifecycle/client integration, editor commands, tree/map display, and exact source navigation. |
| Local web client (React/Vite) | Graph browsing and visualization through the same local API; no direct repository filesystem access. |
| Cloud API | Authenticated, authorized ingestion and retrieval of explicitly synchronized graph metadata/events. |

## Offline behavior and synchronization

- Repository inventory, analysis, graph queries, source navigation, and SQLite persistence work without network access.
- Network failure must not discard local changes or present a queued sync as successful.
- A durable local outbox records syncable changes; retries use stable event identifiers and cloud ingestion is idempotent.
- Sync scope is limited to the approved graph metadata/events contract. Complete source files are not uploaded by default.
- The sync boundary must define workspace identity, authorization, schema/version compatibility, ordering, conflict behavior, retry limits, retention, export, and deletion.
- Show pending, failed, and completed synchronization states to the user. Local analysis remains usable when synchronization is unavailable.

## Local API security

Loopback binding alone does not authorize access. The implementation MUST:

1. Bind to `127.0.0.1` by default and reject non-loopback bind addresses unless a separately reviewed feature explicitly requires them.
2. Generate a high-entropy per-installation or per-agent token and require it for every REST request and WebSocket handshake; never expose it in URLs, logs, or diagnostics.
3. Validate `Host` and browser `Origin` against an explicit allowlist; reject unexpected and missing origins for browser clients.
4. Treat cross-origin browser access as disabled by default. Hosted web clients require explicit pairing and tested browser private-network controls before they can connect.
5. Apply request/payload bounds, input validation, rate limits, safe error responses, and token rotation/revocation.
6. Avoid permissive CORS and test DNS rebinding, CSWSH, origin spoofing, and unauthorized localhost requests as part of the security test suite.

Repository paths and requested operations are untrusted API inputs. Resolve and validate paths against an explicitly authorized repository root; reject traversal and do not execute repository content.

## Acceptance evidence

- All three clients use one agent and produce consistent graph/query results.
- Analysis and local queries work with network access disabled.
- Interrupted sync resumes from a durable outbox without duplicate cloud effects.
- API tests demonstrate that missing/invalid tokens, unexpected Host/Origin values, unauthorized WebSocket handshakes, oversized requests, and paths outside the authorized repository are rejected.
- A hosted page cannot access the agent without explicit pairing and passing browser-origin/private-network safeguards.
- Agent crashes, malformed repository files, or sync errors are visible and recoverable without losing committed local graph state.

See [technology stack](../TECH_STACK.md), [security and privacy](../SECURITY_PRIVACY.md), and [MVP implementation phases](../REMAINING_FEATURES_PHASES.md).
