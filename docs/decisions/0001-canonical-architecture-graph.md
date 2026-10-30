# 0001: Use a canonical architecture graph

- Status: accepted
- Decision date: Not stated in the source discussion

## Context

Codifier needs to connect architecture concepts, analyzed code, source locations, evidence, and later integrations. Separate representations for each feature risk contradictory identities and make it difficult to navigate between design and implementation.

## Decision

Use one canonical graph as the shared product model. Represent **actual** implementation and **intended** architecture as distinct states in that model. A difference between them is a reviewable observation, not automatically a defect. Manual, imported, or AI-assisted architecture content must retain its origin and review status.

This is a product-level model decision. It does not select a graph database, storage schema, serialization, or MVP persistence mechanism.

## Alternatives considered

- Separate architecture and code models with feature-specific mappings.
- Treat generated diagrams as the primary model.
- Select a graph database solely because the product uses graph terminology.

The source discussion did not document a full comparison of these alternatives.

## Consequences

- Repository analysis, architecture views, source navigation, and future AI context should use stable graph interfaces.
- Actual facts and intended design must never be silently merged.
- Graph schema and persistence remain open until the first workflow and deployment needs are selected.
- See the [canonical graph specification](../CANONICAL_GRAPH.md) and [decision register D-001/D-002](../DECISION_REGISTER.md).
