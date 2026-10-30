# Interactive Architecture Map

## Status

**MVP user experience.** The local React/Vite client uses React Flow against the shared local agent; the VS Code client also supports exact source navigation. An accessible structured alternative is required.

## Purpose

Let developers explore graph entities and relationships visually while retaining a structured, accessible alternative.

## User capabilities

- Search and select components, files, symbols, and supported architecture nodes.
- Expand/collapse groups and filter by entity type or relationship.
- Inspect dependencies and dependents.
- See associated files, exact source ranges, evidence, and freshness.
- Navigate to a source range and return to the same graph context.
- Refresh after code changes and inspect what changed.

## Interaction constraints

- The map is a view over the canonical graph; layout is not architecture truth.
- Do not imply that a visual grouping is confirmed if it is inferred.
- Use labels and non-color state cues for origin, uncertainty, stale mappings, and errors.
- Provide keyboard navigation and a structured tree/list/table alternative.
- Avoid blocking the editor during large-repository analysis; progress and cancellation are explicit.

## Acceptance evidence

- Fixture nodes show correct names, relationships, and source ranges.
- Selecting a source location opens the expected file and range.
- Search, keyboard navigation, and structured view expose the same graph data.
- Refresh preserves focus where possible and reports stale or changed locations.

See [architecture intelligence](architecture-intelligence.md), [user flows](../USER_FLOWS.md), and [product requirements](../PRODUCT_REQUIREMENTS.md).
