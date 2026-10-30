# Architecture Decision Intelligence

## Status

**Approved direction; future capability.** ADRs are intended to be first-class, versioned architecture knowledge. Repository Markdown remains authoritative for formal decisions.

## Purpose

Make architecture decisions discoverable in context, connect them to affected graph entities, and help maintainers identify potentially relevant or conflicting decisions during a change.

## Responsibilities

- Index repository-first ADRs without replacing their authoritative Markdown.
- Represent decision identity, status, scope, lifecycle, links, and source document.
- Connect decisions to components, domains, dependencies, requirements, features, and rules where an explicit mapping exists.
- Retrieve relevant decisions for browsing, impact analysis, and optional AI planning.
- Flag possible contradictions as reviewable candidates with supporting evidence.
- Track supersession and freshness without deleting historical decisions.

## Decision lifecycle

```text
Markdown authored
    -> parsed/indexed with source provenance
    -> links reviewed or corrected
    -> decision becomes queryable in graph
    -> later decision supersedes or conflicts
    -> maintainers review relationship
```

## Constraints

- Graph metadata must not become the sole authority for formal decisions.
- Automated contradiction detection is a suggestion, not a verdict.
- Do not alter ADR files or decision status without developer action.
- Preserve repository path, revision, and decision lifecycle state.

## Acceptance evidence

- A decision can be found from a linked component and vice versa.
- Re-indexing preserves identity and records file/revision changes.
- Suspected contradictions include both decision references and remain unconfirmed until review.

See [decision register](../DECISION_REGISTER.md), [architecture decisions](../decisions/README.md), and [canonical graph](../CANONICAL_GRAPH.md).
