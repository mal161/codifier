# Architecture Interoperability

## Status

**Proposed / future capability.** The discussion considers C4, UML, 4+1, ArchiMate, sequence diagrams, DFDs, ERDs, state, component, and deployment diagrams. It does not select an initial notation or parser.

## Purpose

Import, export, and visualize architecture using multiple notations while preserving one canonical graph and traceability to implementation.

## Responsibilities

- Convert a supported notation to/from canonical graph concepts where semantics can be preserved.
- Render different views from the same graph rather than maintaining separate diagrams as separate truth.
- Preserve source notation, import/export provenance, and unsupported constructs.
- Map architecture nodes to code and evidence only through explicit user mapping or supported analysis.
- Report lossy conversions instead of silently dropping meaning.

## Candidate rollout

1. Select one notation based on first-user workflow.
2. Define supported subset and round-trip expectations.
3. Parse/import into a reviewable, provenance-marked graph branch.
4. Render graph-backed views and provide a structured alternative.
5. Add further notations only when a validated workflow requires them.

The source mentions C4, Mermaid, and PlantUML as candidates, not an accepted implementation order.

## Constraints

- A diagram is an interchange or view format, not a second canonical data store.
- Imported content is not developer-approved intent until reviewed.
- Preserve identifiers, relationships, source evidence, and unknown/unsupported concepts.
- Diagram editing must not silently overwrite actual code observations.

## Acceptance evidence

- Imported elements retain origin and source document references.
- Unsupported notation features produce visible diagnostics.
- A supported export/import round trip preserves the documented subset.
- Source links from diagram elements open exact, current locations when mappings exist.

See [canonical graph](../CANONICAL_GRAPH.md), [architecture intelligence](architecture-intelligence.md), and [open decisions](../decisions/README.md).
