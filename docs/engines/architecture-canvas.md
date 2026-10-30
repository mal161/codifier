# Editable Architecture Canvas

## Status

**Proposed future capability.** The product discussion describes editable nodes, relationships, constraints, architecture imports, and a later architecture-to-code workflow. It does not choose a UI framework or notation.

## Purpose

Allow developers to author and review intended architecture using graph-backed visual editing.

## Candidate capabilities

- Create, edit, group, move, and remove architecture nodes and relationships.
- Edit responsibilities, descriptions, metadata, dependencies, and constraints.
- Save and reopen architecture states and multiple graph views.
- Import supported notations through the architecture interoperability flow.
- Map designed components to implementation evidence.
- Request a reviewable implementation plan as a later integration.

## Data and interaction rules

- Canvas edits affect intended state, not observed implementation.
- Changes are validated against canonical graph invariants before saving.
- Deletions and edits are reviewable and preserve history as configured.
- The canvas must support keyboard operations and a non-canvas representation.
- Any generated suggestion remains a suggestion until explicitly accepted.

## Acceptance evidence

- A saved design round-trips with node identity and relationships intact.
- Invalid edges or schema data produce actionable validation errors.
- Editing intended state does not alter actual-state evidence.
- Keyboard and structured-view users can perform equivalent core edits.

See [canonical graph](../CANONICAL_GRAPH.md), [architecture interoperability](architecture-interoperability.md), and [architecture-to-code pipeline](../pipelines/architecture-to-code.md).
