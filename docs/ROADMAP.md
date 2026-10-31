# Initial roadmap

This roadmap separates a focused learning release from the larger product vision. It is a planning baseline, not a promise of dates.

See the [implementation plan](IMPLEMENTATION_PLAN.md) for phase work, deliverables, and exit gates.
See [product requirements](PRODUCT_REQUIREMENTS.md) for MVP requirements and explicit scope boundaries.

## MVP: Local agent, analysis, and traceability

Follow the verified remaining work and exit gates in [the phase plan](REMAINING_FEATURES_PHASES.md):

- Establish pnpm/Turborepo workspace and canonical graph/domain contracts.
- Persist local state in SQLite. Cloud synchronization is conditional and requires explicit data-sharing and conflict decisions first.
- Implement the standalone authenticated local agent and shared CLI, VS Code, and local web clients.
- Analyze TypeScript/JavaScript with evidence-backed identity, relationships, and exact bidirectional source links.
- Add incremental analysis/sync, React Flow visualization, intended/actual comparison, Git integration, and basic architecture rules.
- Keep analysis offline-capable and source files local by default; validate local API/browser security.

The current foundation, initial Phase 4 slice, and first VS Code extension client are implemented. The extension supports secure agent connection, workspace analysis, architecture lookup for the active file, and freshness-checked source navigation. Selective incremental analysis, broader stale-location state, auditable exceptions, full drift coverage, formal accessibility review, extension-host/VSIX verification, and the separate React/Express walkthrough remain before the local MVP can pass its stated acceptance gates.

The initial analyzer target prioritizes React and Express conventions. Python/Django/Flask are later.

## Later: Evidence-grounded explanations

- Add an optional AI explanation flow over retrieved, bounded source context.
- Include source references and uncertainty in each explanation.
- Keep suggestions and inferred architecture separate from observed facts.
- Let developers review, accept, reject, or edit inferences.

## Later possibilities

Advanced AI orchestration, runtime tracing, multi-agent execution, broad collaboration, MCP write access, hosted marketplaces, executable plugins, enterprise deployment, billing, compliance, customization, and knowledge sharing should follow demonstrated demand and separate decisions. The bundled local catalog of data-only architecture templates is a narrow approved capability; user-authored rule packs await a supported declarative format. Intended/actual comparison, Git context, and basic architecture rules are part of the user-directed MVP, not deferred features.
