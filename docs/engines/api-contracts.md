# API Contracts and Integration Boundaries

## Status

**Mixed status.** Authenticated Fastify REST and WebSocket contracts for the local agent are required by the user-directed MVP. External MCP and third-party integration contracts remain proposed/later.

## Purpose

Define stable, validated boundaries between the core graph and possible clients: web UI, IDE extension, local agent, external AI agents, plugins, and third-party integrations.

## Candidate interfaces

- **Local REST:** versioned agent commands and queries, validated with Zod and documented through OpenAPI.
- **Local WebSocket:** authenticated progress and change notifications with bounded, versioned message schemas.
- **Cloud REST:** authorized graph synchronization and later hosted service operations.
- **MCP:** external-agent context tools, later and initially read-oriented.

The local REST and WebSocket interfaces are required; cloud and MCP operations have separate authorization and scope decisions.

## Contract requirements

- Keep transports limited to their defined client/service boundaries; avoid adding interfaces without a validated workflow.
- Version contracts and validate untrusted input at boundaries.
- Return consistent, actionable errors and explicit partial-result status.
- Bound queries with pagination, filtering, depth, and result-size limits.
- Authorize every shared-workspace operation; never rely on client-side filtering.
- Include evidence, provenance, source revision, and uncertainty in graph claims.
- Keep API transport models separate from canonical graph semantics.

## Acceptance evidence

- Contract tests cover valid, malformed, unauthorized, stale, and oversized requests.
- API errors do not reveal secrets or unrelated repository data.
- A transport can evolve without changing graph identity or evidence semantics.
- MCP read tools cannot modify code or authoritative architecture.

## Decision gate

Before implementation, define protocol versions, token lifecycle, Host/Origin checks, browser pairing, cloud workspace authorization, and whether MCP belongs in a later release.

See [implementation plan](../IMPLEMENTATION_PLAN.md), [MCP agent context pipeline](../pipelines/mcp-agent-context.md), and [security and privacy](../SECURITY_PRIVACY.md).
