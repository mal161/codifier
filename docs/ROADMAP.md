# Initial roadmap

This roadmap separates a focused learning release from the larger product vision. It is a planning baseline, not a promise of dates.

See the [implementation plan](IMPLEMENTATION_PLAN.md) for phase work, deliverables, and exit gates.
See [product requirements](PRODUCT_REQUIREMENTS.md) for MVP requirements and explicit scope boundaries.

## MVP: Local agent, analysis, and synchronization

Follow the ordered milestones in [the implementation plan](IMPLEMENTATION_PLAN.md#revised-mvp-execution-order):

- Establish pnpm/Turborepo workspace and canonical graph/domain contracts.
- Persist local state in SQLite and optionally synchronize approved graph metadata/events to cloud PostgreSQL.
- Implement the standalone authenticated local agent and shared CLI, VS Code, and local web clients.
- Analyze TypeScript/JavaScript with evidence-backed identity, relationships, and exact bidirectional source links.
- Add incremental analysis/sync, React Flow visualization, intended/actual comparison, Git integration, and basic architecture rules.
- Keep analysis offline-capable and source files local by default; validate local API/browser security.

The initial analyzer target prioritizes React and Express conventions. Python/Django/Flask are later.

## Later: Evidence-grounded explanations

- Add an optional AI explanation flow over retrieved, bounded source context.
- Include source references and uncertainty in each explanation.
- Keep suggestions and inferred architecture separate from observed facts.
- Let developers review, accept, reject, or edit inferences.

## Later possibilities

Advanced AI orchestration, runtime tracing, multi-agent execution, broad collaboration, MCP write access, plugins, enterprise deployment, billing, compliance, customization, and knowledge sharing should follow demonstrated demand and separate decisions. Intended/actual comparison, Git context, and basic architecture rules are part of the user-directed MVP, not deferred features.
