# Architecture Intelligence

## Status

**Approved direction; implementation scope is staged.** The product discussion describes the canonical architecture graph as the shared foundation. Architecture views, modeling, drift detection, and code generation remain staged capabilities rather than one MVP commitment.

## Purpose

Connect intended architecture, observed implementation, source locations, dependencies, decisions, and evidence in a navigable model. The product should answer “what is this component?”, “where is it implemented?”, “what depends on it?”, and “what evidence supports this relationship?”

## Responsibilities

- Maintain one canonical graph with separate actual and intended states.
- Connect architecture components to code entities, source ranges, tests, requirements, APIs, data, and infrastructure when evidence and scope support it.
- Render graph-backed maps and structured alternatives without maintaining separate truth per visualization.
- Support bidirectional architecture-to-code and code-to-architecture navigation.
- Expose graph queries to UI, analysis, AI retrieval, and future integrations through explicit contracts.
- Preserve provenance, review state, identity, revision context, and graph history.

## Core flow

```text
Repository analysis / authored design / import
    -> validated graph facts with provenance
    -> canonical graph
    -> query, map, source navigation, comparison
    -> reviewed changes to intended architecture
```

## Invariants

- Actual observations are not overwritten by intended design.
- Deviations are reviewable findings, not automatically defects.
- Inferred or imported architecture is not silently treated as developer-approved intent.
- Every source mapping is revision-aware and can be marked stale.
- Diagrams are views over graph data, not the authoritative store.

## Boundaries and dependencies

Depends on the [canonical graph](../CANONICAL_GRAPH.md), [codebase intelligence](codebase-intelligence.md), and [architecture interoperability](architecture-interoperability.md). It does not own parser logic, model-provider requests, billing, or diagram-specific persistence.

The user-directed persistence targets are SQLite/Drizzle locally and PostgreSQL/Drizzle for cloud synchronization; exact schemas, migrations, and hosting remain open decisions.

## Delivery order

1. Actual structural map, source locations, dependencies, and structured navigation.
2. Incremental identity and version/history support.
3. Basic intended/actual comparison and evidence-backed architecture rules in the MVP.
4. Developer-authored architecture canvas and notation interoperability.
5. Simulation, migration, and agent workflows after separate decisions.

## Acceptance evidence

- Selecting a source-backed architecture element opens the exact source range for its recorded revision.
- The same element can be discovered from its source symbol.
- A graph view and its accessible list/table return consistent data.
- Inferred, stale, imported, and developer-approved claims remain distinguishable.
- Graph updates preserve valid unrelated identities and expose unresolved changes.

## Related guides

[Canonical graph](../CANONICAL_GRAPH.md) · [Architecture interoperability](architecture-interoperability.md) · [Architecture drift pipeline](../pipelines/architecture-drift.md)
