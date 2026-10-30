# Security and privacy

## Purpose and status

Repository source and derived architecture metadata are sensitive. This document turns the local-first product principle into implementation requirements. It is not a regulatory compliance statement or a complete threat model for a future hosted service.

The governance/compliance engine discussed in the product idea is unfinished and remains an open future proposal. Codifier must not claim that automated architecture checks establish legal compliance.

## MVP trust boundaries

| Boundary | Data | Default rule |
|---|---|---|
| Repository to analyzer | Source files, paths, build/configuration files | Read only; bounded and filtered; never execute repository content. |
| Analyzer to graph | Symbols, relationships, source ranges, diagnostics | Keep local by default; preserve provenance and repository/revision scope. |
| Graph to UI | Names, relationships, code locations, explanations | Show evidence and uncertainty; avoid exposing more source than the user requested. |
| Product to AI provider | Selected source excerpts and graph context, if AI is enabled | No transmission by default; require explicit, informed user action and show the applicable provider/data boundary. |
| Local agent to cloud API | Explicitly approved graph metadata/events, workspace identity, sync state | Offline-first durable outbox; authenticated/authorized, idempotent sync; full source files are not uploaded by default. Define retention, export, and deletion before enabling sync. |
| Local agent API to clients | Repository-derived graph data, commands, progress, and paths | Loopback-only by default; token authentication on REST and WebSockets; validate Host/Origin and repository-root authorization. |

## Baseline requirements

- Repository analysis MUST be read-only and MUST NOT run project scripts, tests, package managers, build hooks, or analyzed binaries.
- Analysis MUST honor the selected repository boundary and reject path traversal. Symlink behavior must be explicit.
- Source code, credentials, personal data, and derived metadata MUST NOT be included in logs, telemetry, crash reports, or diagnostics by default.
- Diagnostics should identify file and location without echoing arbitrary source snippets unless the user explicitly requests them.
- Local-first structural analysis MUST remain useful without a network connection or AI provider.
- Cloud synchronization MUST remain disabled until a user explicitly configures and authorizes a cloud workspace; installing or launching the agent is not consent to upload metadata.
- The standalone local agent MUST be the sole owner of repository access, analysis, graph operations, and local persistence for the CLI, VS Code extension, and local web client.
- The local API MUST bind to `127.0.0.1` by default. Loopback binding is not authentication: require a high-entropy token for every REST request and WebSocket handshake, protect token storage, and never place tokens in URLs or logs.
- Validate `Host` and browser `Origin` against explicit allowlists. Cross-origin browser access is disabled unless explicit pairing and browser private-network safeguards have been designed and tested. Do not rely on permissive CORS.
- Validate all local API paths against an explicitly authorized repository root; reject traversal, unexpected paths, oversized requests, and malformed inputs.
- Local synchronization MUST queue durable changes while offline, use idempotent ingestion, expose pending/failure state, and avoid sending complete source files by default.
- Temporary files and indexes must use controlled locations and documented cleanup behavior.
- Define local/cloud migration, backup, export, deletion, retention, identity, conflict, and recovery behavior before relying on durable persistence or cloud synchronization.

## AI data handling

AI is optional and its provider/deployment boundary is unresolved. Before enabling a provider:

1. Explain which provider receives data and whether requests leave the device.
2. Require an affirmative user-controlled opt-in; do not infer consent from installing or enabling the extension.
3. Send only bounded, retrieved context needed for the current request, never the whole repository by default.
4. Give the user a way to inspect the context that will be sent where feasible.
5. Keep credentials in an operating-system-backed secret store or an equivalent approved secure mechanism; never store keys in workspace files or logs.
6. Define provider retention, training, regional processing, and deletion behavior from verified provider terms before making product claims.
7. Treat source files, comments, documentation, and generated content as untrusted data, not instructions that can override the user's request or product policy.
8. Validate model output and source references; label generated claims as inference until reviewed.

See [AI integration](AI_INTEGRATION.md) for the orchestration boundary.

## Future shared-service requirements

These are design constraints for the requested minimal cloud synchronization path and any later shared service:

- Authenticate every user and authorize every repository/workspace operation at each API boundary.
- Enforce tenant and repository isolation in storage, queries, background jobs, exports, and logs.
- Use least-privilege service credentials and protect secrets through managed secret storage.
- Define encryption, data residency, retention, backup, recovery, export, and deletion policies before storing repository-derived data remotely.
- Audit consequential changes to intended architecture, access controls, or generated code.
- Threat-model importers, parsers, external agents, webhooks, and any write-capable integration before release.
- Authorize every sync operation to a specific user/workspace and repository; do not infer authorization from a local agent token.
- Make cloud ingestion idempotent, version-aware, and resistant to replay or cross-workspace event submission.

## Untrusted repository content

Repositories may contain prompt injection, malicious links, secrets, malformed files, or parser-stressing input. Treat all repository content as data. Parser inputs must be bounded by documented limits; external tools must not execute content; AI context must be constrained and clearly separated from trusted system instructions. Avoid broad exception handling that hides parser or access-control failures.

## Governance and regulatory claims

Future data classification, lineage, retention, residency, access governance, and regulatory evidence features require their own requirements, ownership, rule sources, and versioning. The product may report technical evidence and possible gaps, but must not present an automated result as legal advice or proof of compliance.

## Open decisions before remote processing

- Which graph metadata/events may synchronize, and what workspace identity, conflict, retention, export, and deletion rules apply?
- Which local-agent token lifecycle and explicit browser pairing mechanism will be used?
- Which AI providers and local models, if any, are supported?
- Is a bring-your-own-key flow, a hosted provider proxy, or both appropriate?
- What exact source and metadata may be sent?
- What context preview, consent, redaction, retention, and deletion controls are required?
- What telemetry, if any, is collected, and how is it kept free of source content?

No remote AI integration should be implemented until these questions have an accepted decision record.
