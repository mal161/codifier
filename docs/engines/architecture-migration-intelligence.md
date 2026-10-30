# Architecture Migration Intelligence

## Status

**Approved direction; future capability.** The discussion explicitly separates migration planning from migration execution and requires approval for consequential changes.

## Purpose

Help developers plan and track safe transitions between architectural states, including framework or database changes, provider replacements, and gradual decomposition.

## Responsibilities

- Discover the current graph elements and dependencies implicated by a proposed migration.
- Generate an ordered, dependency-aware set of phases and tasks.
- Identify compatibility concerns, breaking changes, tests, rules, and validation evidence.
- Track progress and remaining work against an approved plan.
- Support incremental coexistence of old and new designs.
- Document rollback and recovery options.
- Optionally provide AI-assisted plans or change proposals subject to the AI and code-generation policies.

## Plan lifecycle

```text
Migration goal
    -> affected graph/evidence retrieval
    -> reviewable phased plan
    -> developer approval
    -> tracked implementation tasks
    -> tests/rules/compatibility validation
    -> completion or approved rollback
```

## Guardrails

- Planning does not execute changes.
- Generated changes are proposals; apply only after explicit approval.
- Destructive operations require a separate confirmation and recovery plan.
- Mark gaps where graph coverage or test evidence is insufficient.
- Keep planned, in-progress, completed, and rolled-back state distinct.

## Acceptance evidence

- A plan lists evidence-backed affected elements and dependency order.
- Every phase has completion criteria and validation tasks.
- No migration action runs solely because a plan was generated.
- Status and rollback state remain auditable.

See [migration pipeline](../pipelines/architecture-migration.md), [simulation](architecture-simulation.md), and [AI integration](../AI_INTEGRATION.md).
