# Architecture Simulation Engine

## Status

**Approved direction; future capability.** The discussion explicitly requires isolated graph branches or temporary revisions so simulations cannot alter approved architecture.

## Purpose

Let developers compare hypothetical architecture changes and inspect likely impacts before changing the approved intended or actual graph.

## Candidate operations

- Add, remove, modify, or reposition components in an isolated branch.
- Change dependencies or selected technology/resource relationships.
- Compare current and proposed graphs.
- Identify affected components, APIs, data stores, tests, and infrastructure where graph evidence permits.
- Evaluate configured quality measures such as coupling, cohesion, complexity, and rule compliance.
- Ask for AI-assisted proposals only through a separately approved AI data flow.

## Simulation boundary

Every simulation operates on an immutable base revision plus isolated proposed edits. It must not publish changes to canonical approved state automatically. A user may discard the branch or explicitly promote selected reviewed changes through a separate workflow.

## Result classification

- **Measured:** computed deterministically from the model with method and inputs disclosed.
- **Evidence-based finding:** supported by repository or graph evidence.
- **AI prediction:** explicitly speculative and separately labeled.
- **Unknown:** model lacks enough information.

Do not present predicted effects as verified outcomes.

## Acceptance evidence

- Creating/canceling a simulation leaves approved graph snapshots unchanged.
- Comparison reports added, removed, and modified nodes/edges.
- Each impact result shows why it was included.
- Measured values and AI predictions are visibly distinct.

See [simulation pipeline](../pipelines/architecture-simulation.md), [canonical graph](../CANONICAL_GRAPH.md), and [ADR 0004](../decisions/0004-incremental-identity-and-history.md).
