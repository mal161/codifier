# Implementation plan

This plan reflects the user's direction for a local-first MVP with a required standalone companion agent. Cloud synchronization is conditional on the data-sharing and conflict decisions recorded in [the remaining MVP phases](REMAINING_FEATURES_PHASES.md#phase-7--conditional-cloud-synchronization).

The original discussion describes many named engines and end-to-end workflows. Their boundaries, approval status, and acceptance guidance are catalogued in [engine specifications](engines/README.md) and [pipeline specifications](pipelines/README.md). These are not a commitment to implement every subsystem or deploy each as a separate service.

## Delivery strategy

Build a shared, offline-capable local product around one agent used by the CLI, VS Code extension, and local web client. Preserve graph correctness, provenance, source-location accuracy, and incremental identity at each step. The MVP sequence below is authoritative; post-MVP capabilities remain separately gated.

## Current implementation status

The workspace, graph/domain contracts, SQLite persistence, authenticated local agent/CLI, and initial TypeScript/JavaScript analysis are implemented. The analyzer inventories bounded repository inputs, extracts named nested declarations, resolves relative imports, nearest-project inherited `tsconfig.json` path aliases, and local workspace package exports, and records conservative same-file JSX, HTTP-route, and re-export relationships. It reports relative imports of inventoried unsupported assets as unsupported rather than as unresolved source imports. It persists only complete supported-file passes. Re-analysis preserves identities for unchanged paths/symbols and uniquely matched unchanged files moved within the repository; ambiguous symbol matches are diagnosed instead of silently merged. Project-wide type/call resolution remains future work.

The first local-web explorer is implemented: it analyzes or loads local graphs, provides searchable evidence-backed browsing, reports analysis-job progress, supports cancellation without replacing the last saved graph, and opens source-backed entities in VS Code through the registered `vscode://file/` handler. Its initial React Flow visualization shows a bounded direct-relationship neighborhood around the selected file or symbol, with the searchable Browse list retained as a structured alternative. Users can also enter a repository-relative path and line/column to find graph entities covering a source location, author intended components, map observed files or symbols to them, inspect read-only Git commit/branch/working-tree context, browse local architecture templates, and review graph-rule findings linked to evidence. An initial VS Code extension now connects to the same agent, analyzes workspace folders, looks up graph items for the active file, and opens selected graph entities after freshness validation. Extension Host verification and VSIX packaging remain pending. Whole-repository layouts, a file watcher for incremental analysis, broader drift review, and formal accessibility review remain future milestones. Browser token pairing remains intentionally session-memory-only.

Phase 4 now adds explicit mapping removal, point-in-time file-hash freshness checks before enabling VS Code links, and rule-set v1.1.0 comparisons between intended component dependencies and actual import edges between mapped entities. Broader drift checks, durable exception records, automatic stale-location lifecycle, and formal accessibility review remain open.

The first real-workspace validation pass against Codifier's React/Vite frontend and Fastify backend confirmed project-specific alias resolution and exposed relative CSS imports as unsupported assets, not unresolved source modules. The analyzer now reports those imports with their source range. Continue validating against representative repositories and use observed diagnostics to select bounded analyzer improvements. Gather feedback on the new relationship map and current browsing flow before expanding visualization further or adding cloud sync.

The first syntax adapter currently uses the TypeScript compiler's AST for the TypeScript/JavaScript slice. This is an implementation starting point, not a decision to replace the broader Tree-sitter direction in the stack proposal; evaluate Tree-sitter packaging separately before broadening language support. When the local web client reaches the visualization milestone below, follow the visual direction recorded in [user flows](USER_FLOWS.md#local-web-visual-direction): Wispr Flow is a high-level typography/style reference only, while Codifier's product content and branding remain original.

## MVP execution order

Use the worktree-verified phases in [Remaining MVP implementation phases](REMAINING_FEATURES_PHASES.md) as the authoritative sequence for outstanding implementation. In summary: reconcile baseline and policy contracts; add durable revisions and restart-safe jobs; implement incremental analysis; close traceability, drift review, and accessibility; build the VS Code extension; then complete the representative React/Express walkthrough. Cloud synchronization is conditional on explicit data-sharing and conflict decisions.

The following foundations are already present and should be preserved:

1. **Monorepo and shared contracts:** pnpm/Turborepo workspace, strict TypeScript, domain graph, and API contracts.
2. **Local persistence and agent:** SQLite, standalone authenticated local agent, CLI, REST/WebSockets, loopback-only binding.
3. **Bounded analysis:** TypeScript compiler AST adapter for TS/JS, conservative UUID reconciliation, evidence, ranges, and explicit coverage limits.
4. **Local web explorer:** React/Vite, bounded React Flow neighborhood, structured browsing, source lookup, intended component mapping, Git context, local templates, and deterministic architecture rules.

Follow the detailed phase plan for remaining work and acceptance evidence. A Tree-sitter migration is not assumed: evaluate only against measured gaps and record any material parser decision in an ADR.

The shared-agent boundary and local API security requirements are specified in [the local companion agent guide](engines/local-companion-agent.md). AI orchestration, runtime analysis, multi-agent execution, enterprise governance, hosted marketplaces, and executable plugins remain deferred. The narrow bundled architecture-template catalog is recorded in [ADR 0007](decisions/0007-local-architecture-template-catalog.md); built-in evidence-backed checks and their limitations are recorded in [ADR 0008](decisions/0008-evidence-backed-architecture-rules.md).

See [project structure](PROJECT_STRUCTURE.md) for the target directory tree, package responsibilities, dependency direction, test organization, and incremental scaffold order.

### MVP quality gates

- Every graph fact has correct provenance; source-backed locations resolve in fixtures and become visibly stale when invalidated.
- Malformed files produce actionable diagnostics without discarding valid partial results.
- Analysis and local graph browsing work with networking disabled.
- Local REST/WebSocket tests reject invalid tokens, Host/Origin, out-of-root paths, oversized requests, and unauthorized browser connections.
- Sync resumes after disconnection with no lost local changes or duplicate cloud effects; complete source files are not sent by default.
- Graph identity remains stable for unchanged entities; ambiguous reconciliation is surfaced instead of silently merging.
- Intended and actual states remain distinct, and rules cite evidence.
- The React Flow view has an accessible structured alternative and supports exact source navigation.

See [product requirements](PRODUCT_REQUIREMENTS.md) for requirement IDs and acceptance evidence, [user flows](USER_FLOWS.md) for interaction behavior, [analysis pipeline](ANALYSIS_PIPELINE.md) for analyzer boundaries, and [canonical graph](CANONICAL_GRAPH.md) for graph invariants.

## Phase 4 - Evidence-grounded AI intelligence

**Purpose:** answer codebase questions using bounded, traceable context.

### Work

- Decide provider model: bring-your-own-key, local model, or both; define credential storage and opt-in before implementation.
- Retrieve relevant graph facts and source excerpts for questions such as “how does this feature work?” and “what depends on this symbol?”.
- Generate explanations with source references and explicit uncertainty; constrain answers to retrieved evidence.
- Mark AI-suggested components and relationships as inferred. Add accept, reject, and edit review flows; preserve rejected inference history.
- Add feature traces across supported layers and impact analysis with an explanation of why each item was included.
- Redact secrets from prompts/logs and provide a clear indication of what repository context leaves the machine.

### Exit gate

Explanations cite retrievable source evidence, distinguish observed behavior from inference, fail safely when context is insufficient, and honor the configured data boundary. The mapping workflow remains useful with AI disabled.

## Phase 5 - Architecture interoperability and authoring

**Purpose:** connect implementation maps to developer-authored system design.

### Work

- Add an editable architecture canvas with developer-created nodes and relationships.
- Import and export one selected architecture notation first (candidate: Mermaid or C4; choose via ADR).
- Expand the MVP intended/actual comparison with imported architecture notation and developer-authored canvas workflows.
- Show imported-design drift with supporting evidence and allow documented intentional exceptions.
- Keep architecture decisions as repository Markdown and link them to graph entities.

### Exit gate

Imported, developer-authored, and analyzer-derived information preserve source/provenance; drift findings can be inspected and corrected without silently changing intended design.

## Phase 6 - Architecture-driven implementation planning

**Purpose:** help developers plan a change against the system model before generating code.

### Work

- Accept a feature/change request and identify affected components, constraints, dependencies, and tests.
- Produce a reviewable implementation plan with references to graph evidence and source.
- Add isolated what-if graph branches for architecture simulations.
- Keep measurable effects separate from AI-predicted effects.
- Require developer approval before making repository changes; validate approved changes against tests and architecture rules.
- Add phased migration planning and rollback considerations.

### Exit gate

Plans are evidence-linked, architecture simulations cannot mutate approved graph state, and no code change is applied without explicit developer review.

## Phase 7 - MCP and architecture-aware agents

**Purpose:** expose trusted architecture context to external coding agents.

### Work

- Reuse the versioned authenticated REST/WebSocket contracts established for the local agent; decide the external MCP contract in a dedicated ADR.
- Expose read-oriented tools first: query components, dependencies, source ranges, feature traces, and impact.
- Validate inputs, enforce repository/workspace authorization, bound results, and return evidence/provenance with all claims.
- Add write or code-modification tools only after explicit approval semantics, audit events, and rollback are designed.
- Test with representative external agents and malformed/untrusted requests.

### Exit gate

An agent can retrieve bounded, evidence-backed context; cannot cross repository boundaries; and cannot modify code or authoritative architecture through an unreviewed inference.

## Phase 8 - Advanced platform capabilities

Prioritize from validated user needs. Candidate capabilities in the brief include architecture history and drift, runtime traces, team collaboration, additional IDEs and languages, technical-debt tracking, benchmarks, knowledge sharing, migration execution, subscription entitlements, customization, enterprise/private deployments, compliance evidence, and feedback/roadmap workflows.

Each capability needs its own scope, architecture decision, privacy/security review, acceptance criteria, and operating model. They are not prerequisites for the codebase mapper MVP.

## Cross-cutting work in every phase

- **Correctness:** golden repositories, parser fixtures, graph invariants, identity continuity, source-range accuracy, and incremental synchronization.
- **Security/privacy:** local-first behavior, no repository execution, secret-safe logging, clear AI data flow, and access control before shared services.
- **Reliability:** cancellation, partial results, recoverable analysis jobs, schema migrations, and actionable errors.
- **Observability:** structured logs, metrics, traces, correlation IDs, health checks, and redaction as system boundaries are introduced.
- **Accessibility:** keyboard and screen-reader support; diagram alternatives as soon as visual graph interaction exists.
- **Documentation:** update setup instructions, ADRs, supported-language matrix, limitations, and release notes with each capability.

## Immediate next actions

1. Define the first user workflow and measurable success targets.
2. Spike Tree-sitter/TypeScript Compiler API and SQLite packaging on supported operating systems.
3. Specify graph schemas, migrations, sync event contract, conflict handling, retention, and cloud authorization.
4. Threat-model local REST/WebSockets, token lifecycle, Host/Origin checks, and browser pairing.
5. Scaffold the minimal pnpm/Turborepo workspace and implement the first vertical slice in the ordered MVP sequence.

## Planning notes

- AI explanation remains optional and separately gated; structural mapping and navigation must work without it. The user-directed MVP explicitly includes the standalone local agent, offline persistence, and minimal graph synchronization.
- The supplied material ends during a compliance proposal. Compliance features are therefore treated as a later proposal, not an approved implementation requirement.
- The architecture and target technologies are recorded in accepted ADR 0006. Exact versions, native drivers, cloud provider, sync policy, target user workflow, and release date remain undecided.
