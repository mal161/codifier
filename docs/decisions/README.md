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

## Open decisions

1. What narrow first user workflow and measurable success targets define a useful MVP?
2. Which TypeScript/JavaScript constructs and React/Express conventions are supported initially?
3. What repository inventory rules apply to ignore files, generated/vendor content, symlinks, and oversized files?
4. Which SQLite driver and migration/recovery strategy pass cross-platform validation?
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
