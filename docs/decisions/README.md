# Architecture decisions

Use short, numbered records for decisions that constrain implementation. Each record should state context, the decision, alternatives, consequences, and status. A proposal in the source idea is not settled until a decision is recorded here.

See the [project decision register](../DECISION_REGISTER.md) for decisions and proposals extracted from the supplied project brief. This folder is for focused ADRs as implementation choices are made.

## Current decisions

The user has selected a local-first MVP architecture centered on a standalone companion agent and has specified the target stack and work order. Exact package versions, native drivers, cloud provider/identity, synchronization policy, and some security protocol details remain open. See the [decision register](../DECISION_REGISTER.md).

The approved product-level directions are recorded in these ADRs:

- [0001: Canonical architecture graph](0001-canonical-architecture-graph.md)
- [0002: Evidence and provenance](0002-evidence-and-provenance.md)
- [0003: Static-first analysis pipeline](0003-static-first-analysis-pipeline.md)
- [0004: Incremental identity and history](0004-incremental-identity-and-history.md)

They are also summarized in the [decision register](../DECISION_REGISTER.md) and specified in the [canonical graph](../CANONICAL_GRAPH.md) and [analysis pipeline](../ANALYSIS_PIPELINE.md). They do not decide the application stack or persistence technology. Add focused ADRs as further implementation choices are made.

The [end-to-end stack analysis](../TECH_STACK.md) reflects the user-directed architecture, while identifying implementation details that still need validation.

The earlier VS Code-hosted stack recommendation is retained as [0005: Initial VS Code-first stack proposal](0005-proposed-application-stack.md) and marked **superseded**.

The current accepted architecture is [0006: Local companion agent and user-directed MVP stack](0006-local-companion-agent.md). It does not settle exact versions, cloud provider, account model, or sync retention/conflict policy.

[0007: Local architecture-template catalog](0007-local-architecture-template-catalog.md) records the bounded local marketplace choice; it does not authorize remote listings, executable plugins, accounts, or payments.

[0008: Evidence-backed architecture rules](0008-evidence-backed-architecture-rules.md) records the current built-in graph checks and their review-only semantics.

[0009: Local graph revision storage](0009-local-graph-revision-storage.md) records the SQLite snapshot-history implementation and its current limits.

[0010: Durable analysis-job state](0010-durable-analysis-job-state.md) records how queued/running work is surfaced after an agent restart.

[0011: Source freshness and intent drift](0011-source-freshness-and-intent-drift.md) records point-in-time source validation, mapped dependency comparisons, and reversible mapping removal.

[0012: Initial VS Code extension client](0012-vscode-extension-client.md) records the agent-only extension boundary, loopback authentication, SecretStorage, and source navigation flow.

[0013: Symlinks outside the analysis scope](0013-symlinks-out-of-analysis-scope.md) records that symlinks are not followed, are reported, and do not block persistence.

[0014: Graph revision restore](0014-graph-revision-restore.md) records that restoring history commits a new, verified revision and never rewrites earlier ones.

[0015: Graph history export](0015-graph-history-export.md) records the verified JSON export format and what it excludes.

[0016: In-memory parse cache](0016-in-memory-parse-cache.md) records reuse of unchanged syntax trees with whole-inventory re-resolution, and why parse results are not persisted.

[0017: Auditable rule exceptions](0017-auditable-rule-exceptions.md) records append-only, self-attested exception decisions keyed by stable finding identity and kept outside the graph.

[0018: Rule set 1.2.0](0018-rule-set-1-2-drift-conflicts-and-locations.md) records intent conflict checks, source locations on every finding, and the linear-time evaluation.

[0019: VS Code Extension Host verification](0019-vscode-extension-host-verification.md) records the installed-VS-Code host test harness, VSIX verification, and the verified environment.

## Open decisions

1. What narrow first user workflow and measurable success targets define a useful MVP?
2. Which TypeScript/JavaScript constructs and React/Express conventions are supported initially?
3. What repository inventory rules apply to ignore files, generated/vendor content, symlinks, and oversized files?
4. What snapshot retention, backup/export, and full recovery policy is appropriate beyond the initial SQLite revision/job history?
5. What sync event schema, workspace identity, conflict, retention, export, and deletion rules apply?
6. What token lifecycle and browser pairing/Host/Origin rules protect local REST/WebSockets?
7. Is an AI provider part of the first release? If so, what data may be sent and under what opt-in?
8. What cloud provider/identity and supported OS/runtime versions are chosen?

## Decision record template

Copy this template into a new file named `NNNN-short-title.md`:

```markdown
# NNNN: Decision title

- Status: proposed | accepted | superseded
- Date: YYYY-MM-DD

## Context

## Decision

## Alternatives considered

## Consequences
```
