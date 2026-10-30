# Product pipelines

These documents describe end-to-end flows in the product idea. They are logical workflows, not a commitment to background workers, separate services, or a particular orchestration framework.

## Core development pipelines

- [Repository analysis and graph update](../ANALYSIS_PIPELINE.md) — inventory, parsing, semantic resolution, IR, reconciliation, and diagnostics.
- [Architecture import and review](architecture-import.md) — import external design without silently treating it as approved intent.
- [AI context retrieval](ai-context-retrieval.md) — bounded evidence retrieval, consent, provider request, and citation validation.
- [Architecture-to-code](architecture-to-code.md) — design through approved plan and reviewable code changes.
- [MCP agent context](mcp-agent-context.md) — authorized, bounded, read-oriented context for external agents.

## Change and quality pipelines

- [Architecture drift](architecture-drift.md) — compare intended and actual graph states.
- [Architecture simulation](architecture-simulation.md) — isolated what-if branch and impact comparison.
- [Architecture migration](architecture-migration.md) — phased migration planning, validation, and rollback.
- [Analysis validation](analysis-validation.md) — golden fixture and quality gate workflow.
- [Graph history and recovery](graph-history-recovery.md) — snapshots, event history, backup, restore, export, and deletion.
- [Deployment and release](deployment-release.md) — build, validate, deploy, observe, and recover when infrastructure is introduced.

## Product and operations pipelines

- [Product feedback triage](product-feedback-triage.md) — consent-aware feedback through review and roadmap traceability.

Sequence implementation according to the [roadmap](../ROADMAP.md) and [implementation plan](../IMPLEMENTATION_PLAN.md). Status and open decisions are tracked in the [decision register](../DECISION_REGISTER.md).
