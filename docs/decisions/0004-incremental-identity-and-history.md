# 0004: Preserve graph identity and versioned history across analysis

- Status: accepted
- Decision date: Not stated in the source discussion

## Context

Repository analysis must update as code changes while preserving useful links, review history, and architecture context. Rebuilding the graph as an unrelated snapshot on every edit would break identity and obscure what changed.

## Decision

Assign graph entities permanent UUIDs. Use symbol fingerprints and evidence-based reconciliation as signals for continuity, never as entity IDs. Synchronize analysis incrementally and preserve versioned graph snapshots with change events. Associate snapshots with Git revisions when available while supporting uncommitted changes. A restoration is a new change; it does not erase prior history.

When identity matching is ambiguous, do not silently merge entities. Surface the ambiguity or create a new identity according to the eventual reconciliation policy.

## Alternatives considered

- Rebuild all graph entities with new identifiers on every analysis.
- Treat symbol fingerprints or source line numbers as permanent identifiers.
- Rewrite history when a prior snapshot is restored.

The source discussion did not document a full comparison of these alternatives.

## Consequences

- Incremental re-analysis, identity reconciliation, snapshot comparison, and source-location freshness need dedicated tests.
- Storage and retention technology remain open; this decision does not require PostgreSQL, SQLite, or a graph database.
- Recovery, export, and deletion must respect the selected history and retention policy.
- See the [canonical graph specification](../CANONICAL_GRAPH.md), [analysis pipeline](../ANALYSIS_PIPELINE.md), and [decision register D-003/D-004/D-006](../DECISION_REGISTER.md).
