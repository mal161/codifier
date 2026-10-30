# Implementation plan

This plan reflects the user's latest direction for a local-first MVP with a required standalone companion agent and minimal authenticated cloud synchronization. Exact technology versions, cloud provider, account model, and unresolved policies remain subject to decisions and validation.

The original discussion describes many named engines and end-to-end workflows. Their boundaries, approval status, and acceptance guidance are catalogued in [engine specifications](engines/README.md) and [pipeline specifications](pipelines/README.md). These are not a commitment to implement every subsystem or deploy each as a separate service.

## Delivery strategy

Build a shared, offline-capable local product around one agent used by the CLI, VS Code extension, and local web client. Preserve graph correctness, provenance, source-location accuracy, and incremental identity at each step. The MVP sequence below is authoritative; post-MVP capabilities remain separately gated.

## Current implementation status

The workspace, graph/domain contracts, SQLite persistence, authenticated local agent/CLI, and initial TypeScript/JavaScript analysis are implemented. The analyzer inventories bounded repository inputs, extracts named nested declarations, resolves relative imports, inherited `tsconfig.json` path aliases, and local workspace package exports, and records conservative same-file JSX, HTTP-route, and re-export relationships. It persists only complete supported-file passes. Re-analysis preserves identities for unchanged paths/symbols and uniquely matched unchanged files moved within the repository; ambiguous symbol matches are diagnosed instead of silently merged. Project-wide type/call resolution remains future work.

The first local-web explorer is implemented: it analyzes or loads local graphs, provides searchable evidence-backed browsing, reports analysis-job progress, supports cancellation without replacing the last saved graph, and opens source-backed entities in VS Code through the registered `vscode://file/` handler. Browser token pairing remains intentionally session-memory-only. Source-to-graph navigation, incremental/watch analysis, and the VS Code extension remain future milestones.

The next analyzer increment should validate project-aware resolution against representative real-world repositories and improve unsupported edge cases based on observed diagnostics. Gather feedback on the current browsing flow before expanding visualization or adding cloud sync.

The first syntax adapter currently uses the TypeScript compiler's AST for the TypeScript/JavaScript slice. This is an implementation starting point, not a decision to replace the broader Tree-sitter direction in the stack proposal; evaluate Tree-sitter packaging separately before broadening language support. When the local web client reaches the visualization milestone below, follow the visual direction recorded in [user flows](USER_FLOWS.md#local-web-visual-direction): Wispr Flow is a high-level typography/style reference only, while Codifier's product content and branding remain original.

## Revised MVP execution order

Implement in this order; defer UI polish and advanced capabilities until correctness gates pass:

1. **Monorepo foundation:** pnpm workspaces, Turborepo, strict TypeScript, shared checks, and minimal package boundaries.
2. **Graph/domain contracts:** canonical graph entities and relationships, source locators, evidence/provenance, intended/actual state, and validated contracts.
3. **Dual persistence:** SQLite for offline local state and PostgreSQL for cloud graph state, both through Drizzle; define migrations and backend-specific tests.
4. **Local agent and CLI:** standalone Node.js/TypeScript process, Commander.js CLI, Fastify REST/WebSockets, loopback-only binding, and token-authenticated client protocol.
5. **TypeScript/JavaScript analysis:** Tree-sitter syntax plus TypeScript Compiler API semantics; prioritize React and Express conventions. Python/Django/Flask are later.
6. **Identity and relationships:** stable UUID identity, conservative symbol reconciliation, containment, imports/dependencies, and unresolved relationship handling.
7. **Evidence and provenance:** source ranges, analyzer/tool provenance, repository/revision scope, visible diagnostics, and evidence strength.
8. **Incremental analysis and sync:** file watching, affected-area reanalysis, durable local outbox, offline retries, idempotent cloud ingestion, and explicit conflict/error state.
9. **Graph visualization:** local React/Vite client with React Flow plus an accessible keyboard-operable tree/list alternative.
10. **Bidirectional source links:** graph-to-source and source-to-graph navigation with exact, revision-aware locations.
11. **Intended/actual comparison:** separate developer-authored intent from observed implementation; surface discrepancies with evidence.
12. **Git integration:** associate analysis with commits and working-tree state without requiring a clean checkout.
13. **Basic architecture rules:** evaluate explicit rules against graph facts, report evidence-backed findings, and avoid compliance claims.

The shared-agent boundary and local API security requirements are specified in [the local companion agent guide](engines/local-companion-agent.md). AI orchestration, runtime analysis, multi-agent execution, enterprise governance, and plugin marketplace remain deferred.

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
