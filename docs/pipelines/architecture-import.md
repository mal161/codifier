# Architecture Import and Review Pipeline

## Status

**Proposed future capability.** The discussion proposes architecture notation import, but the first notation and supported subset are undecided.

## Flow

```text
Select input and notation
    -> validate file and resource limits
    -> parse supported constructs
    -> convert to canonical graph candidates
    -> report unsupported/lossy elements
    -> preview provenance and changes
    -> developer review
    -> accept into intended architecture
```

## Requirements

- Treat input files as untrusted data; do not execute embedded scripts or remote links.
- Preserve source document, revision, identifiers, and import provenance.
- Do not overwrite actual implementation observations.
- Show diagnostics for unsupported constructs and lossy conversion.
- Require review before imported nodes become approved intended architecture.
- Support idempotent re-import or clearly explain duplicates/identity conflicts.

## Acceptance evidence

- A supported fixture imports to expected graph elements and relationships.
- Invalid input fails with bounded, actionable diagnostics.
- Re-import behavior preserves identity or surfaces conflicts.
- No imported item becomes authoritative without an explicit user action.

See [architecture interoperability](../engines/architecture-interoperability.md) and [canonical graph](../CANONICAL_GRAPH.md).
