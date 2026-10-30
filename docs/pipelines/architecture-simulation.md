# Architecture Simulation Pipeline

## Status

**Approved direction; future capability.** Simulation must use isolated branches or temporary graph revisions.

## Flow

```text
Choose immutable base graph revision
    -> create isolated simulation branch
    -> apply hypothetical graph edits
    -> recompute affected dependencies and rules
    -> compare with base
    -> classify measured effects, evidence findings, predictions, and unknowns
    -> export report or discard branch
```

## Requirements

- Simulation changes never mutate approved actual or intended state.
- Every result identifies base revision, proposed edits, and evaluation method.
- Impacts include affected graph entities and evidence.
- Deterministic calculations are separated from AI predictions.
- A simulation cannot automatically launch migration or code changes.

## Acceptance evidence

- Before/after snapshots prove base graph immutability.
- Re-running a deterministic simulation against the same revisions/configuration produces the same result.
- Predictions are visibly labeled and cannot be mistaken for measurements.

See [Architecture Simulation Engine](../engines/architecture-simulation.md) and [canonical graph](../CANONICAL_GRAPH.md).
