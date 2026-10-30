# Architecture Migration Pipeline

## Status

**Approved direction; future capability.** Migration planning and execution are separate; consequential execution requires developer approval.

## Flow

```text
Migration goal and target state
    -> discover affected graph and evidence
    -> analyze dependencies and compatibility
    -> draft ordered phases and validation gates
    -> developer review/approval of plan
    -> track separately approved implementation work
    -> validate each phase
    -> complete or follow approved rollback plan
```

## Plan contents

- Current and target architecture references.
- Affected components, files, APIs, data, tests, and infrastructure.
- Dependency-aware sequence and transitional coexistence strategy.
- Breaking changes and unresolved compatibility assumptions.
- Phase-specific completion and validation criteria.
- Rollback options, limitations, and data-recovery considerations.

## Guardrails

- Generating a plan never executes a migration.
- Each phase reports actual test/validation outcomes.
- Do not claim reversibility if data or interfaces cannot be restored.
- AI-generated tasks or code remain proposals until reviewed.

## Acceptance evidence

- Plan ordering is explainable using graph dependencies.
- Missing evidence is reported before execution.
- No destructive change occurs without explicit approval.
- Progress, validation, and rollback state are auditable.

See [Architecture Migration Intelligence](../engines/architecture-migration-intelligence.md), [simulation pipeline](architecture-simulation.md), and [AI integration](../AI_INTEGRATION.md).
