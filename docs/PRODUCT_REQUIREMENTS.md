# Product requirements

## Status and authority

This is a product-level implementation guide, not a release commitment. It converts the project idea into testable requirements while keeping unsettled choices visible. The [decision register](DECISION_REGISTER.md) is authoritative for whether an item is accepted, proposed, or open. Record material implementation decisions in [architecture decisions](decisions/README.md).

Requirements use **MUST** for a release-blocking requirement, **SHOULD** for a strong default that needs an explicit reason to omit, and **MAY** for an optional capability.

## Product goal

Help a developer regain a reliable mental model of an unfamiliar or AI-expanded codebase by connecting architecture-level concepts to concrete files, symbols, dependencies, and evidence.

The product is a codebase understanding and traceability tool. It is not initially an autonomous code generator, a compliance certifier, or a replacement for source control and developer review.

## Primary user and job

**Primary user:** a developer maintaining, reviewing, or inheriting a repository whose structure is not yet familiar.

**Job:** when I need to understand an area of a repository, help me identify its components and relationships, inspect the evidence behind the map, and navigate to the exact implementation without reading every file or trusting unsupported AI claims.

## User-directed first-release architecture

The MVP MUST include a standalone local Node.js/TypeScript agent as the single owner of repository access, analysis, graph operations, and SQLite persistence. The CLI, VS Code extension, and local React web application are clients of the same agent. Analysis and browsing remain usable offline. Cloud synchronization is optional and remains outside the release gate until data scope and conflict handling are decided; if selected, it sends only the explicitly approved graph metadata/events contract, not complete source files by default.

The user-prioritized sequence is recorded in [the implementation plan](IMPLEMENTATION_PLAN.md#mvp-execution-order) and its [remaining-feature phases](REMAINING_FEATURES_PHASES.md). TypeScript/JavaScript is the first analysis target, with React and Express conventions prioritized. Python/Django/Flask follow later. Exact language coverage and quantitative performance targets still require fixture-based validation.

## MVP functional requirements

| ID    | Requirement                                                                                                                                                               | Acceptance evidence                                                                                                                                                                                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-01 | The product MUST analyze a developer-selected local repository without executing its code.                                                                                | Integration test confirms no analyzed process is launched; a fixture repository produces an inventory.                                                                                                                                                               |
| FR-02 | The analyzer MUST apply documented inclusion/exclusion, file-size, and symlink rules.                                                                                     | Fixtures exercise excluded directories, oversized files, and symlinks according to the policy selected in an ADR.                                                                                                                                                    |
| FR-03 | The analyzer MUST report supported-file coverage, unsupported files, and parse/analysis errors.                                                                           | A mixed fixture reports each category while retaining successful results from valid files.                                                                                                                                                                           |
| FR-04 | For supported languages, the analyzer MUST extract the agreed structural elements and directly observable relationships.                                                  | Golden fixtures assert expected symbols, containment, imports/dependencies, and source ranges.                                                                                                                                                                       |
| FR-05 | Every source-backed graph item MUST retain a locator to its repository-relative file and source range, plus enough revision context to detect stale locations.            | Golden tests verify start/end positions and stale-location behavior after edits.                                                                                                                                                                                     |
| FR-06 | The user MUST be able to browse and search repository structure.                                                                                                          | UI tests cover locating a known fixture symbol by name and browsing its parent/children.                                                                                                                                                                             |
| FR-07 | The user MUST be able to inspect dependencies and dependents for supported graph relationships.                                                                           | Fixture tests verify both directions and visibly distinguish unresolved relationships.                                                                                                                                                                               |
| FR-08 | Selecting a source-backed item MUST open the corresponding file and range in the selected editor.                                                                         | Integration test verifies the exact target file and selection range.                                                                                                                                                                                                 |
| FR-09 | A visual map MUST have an equivalent structured, keyboard-operable representation.                                                                                        | Accessibility tests and manual review cover keyboard navigation and screen-reader labels.                                                                                                                                                                            |
| FR-10 | Re-analysis MUST show actionable progress and errors, return useful partial results, and update changed areas without unnecessarily reprocessing the whole repository.    | Incremental fixture tests assert affected entities change, unrelated identity remains stable, and failures are visible.                                                                                                                                              |
| FR-11 | Observed facts, developer-authored intent, imported content, and AI inferences MUST remain distinguishable.                                                               | Graph and UI tests assert origin and evidence are retained and displayed consistently.                                                                                                                                                                               |
| FR-12 | The local agent MUST be the sole owner of repository scanning, analysis jobs, graph mutation, and local persistence for the CLI, VS Code, and local web clients.          | Client integration tests verify one shared analysis result and reject client-side competing indexes or graph writes.                                                                                                                                                 |
| FR-13 | Structural analysis, graph queries, source navigation, and local persistence MUST work without network connectivity.                                                      | Integration tests disable networking and verify analysis completes and data remains available locally.                                                                                                                                                               |
| FR-14 | Every local REST request and WebSocket connection MUST be authenticated; the agent MUST bind to loopback by default and validate Host/Origin for browser access.          | Security tests reject missing/invalid tokens, unexpected origins/hosts, unauthorized WebSocket handshakes, and non-loopback binds.                                                                                                                                   |
| FR-15 | **Conditional:** if cloud synchronization is selected for MVP, it MUST use a durable local outbox and idempotent ingestion and transmit only the explicitly approved graph metadata/events contract. | Offline/online integration tests verify retry without data loss or duplicate effects and assert source file contents are not uploaded.                                                                                                                               |
| FR-16 | The graph MUST support distinct intended and actual states, Git revision and working-tree context, and basic architecture rule evaluation.                                | Fixtures verify state separation, commit association, clean/dirty working-tree reporting without requiring a clean checkout, and deterministic rule findings for dependency cycles, overlapping intent mappings, and unmapped intent with graph/evidence references. |
| FR-17 | The local web app MUST offer a bundled catalog of data-only architecture templates that install as imported intended components without changing source files.            | Agent and client tests verify catalog validation, authenticated installation, imported provenance, graph preservation, and idempotent repeat installs.                                                                                                               |

FR-11 is a foundational graph invariant even if the first UI only displays actual source structure.

## Quality requirements

- **Correctness:** source ranges and relationships must be verified against golden repositories; unsupported behavior must not be presented as resolved.
- **Transparency:** show analyzer coverage, evidence, source revision, stale locations, and limitations.
- **Privacy:** source analysis remains local-first; cloud sync is disabled until explicitly configured and its data contract is approved. Remote AI processing requires a separate deliberate user-controlled flow. See [security and privacy](SECURITY_PRIVACY.md).
- **Reliability:** malformed or unsupported files must not prevent useful results from other files; cancellation and errors must be explicit.
- **Accessibility:** support keyboard and screen-reader workflows and a non-graph alternative. The approved product direction is WCAG 2.2 AA; scope and audit timing need a delivery plan.
- **Maintainability:** keep repository access, parsing, semantic resolution, graph storage, UI, and optional AI behind explicit interfaces.
- **Performance:** measure representative repositories and define limits before release. Numeric size, latency, and memory targets are open.

## Explicitly out of MVP scope

- Autonomous code generation or automatic repository edits.
- Runtime instrumentation or executing repository code during indexing.
- Broad multi-user collaboration, tenant administration, or enterprise deployment. Optional single-workspace graph sync is conditional on the decisions and gate in [the remaining-feature phases](REMAINING_FEATURES_PHASES.md#phase-7--conditional-cloud-synchronization).
- Billing, entitlements, organization customization, compliance assessments, and regulatory claims.
- MCP or write-capable integrations for coding agents.
- AI as a prerequisite for structural browsing.

These are not rejected forever. They need validated demand, their own scope, and architecture/security decisions before implementation.

## Later product capabilities

The wider vision includes AI-grounded explanations and feature traces; architecture authoring and notation import; intended-versus-actual drift; architecture-aware implementation plans and agent context; runtime evidence; history and migration planning; knowledge sharing; benchmarking; feedback and roadmap workflows; and deployment/customization options.

The [roadmap](ROADMAP.md) and [implementation plan](IMPLEMENTATION_PLAN.md) stage these capabilities. Listing a capability here does not make it an approved release requirement.

## Decisions required before cloud synchronization and release

Resolve and record:

1. First user task and success measure.
2. Exact TypeScript/JavaScript structural and semantic coverage, including React/Express conventions.
3. Repository ignore, size, symlink, generated-file, and secret-handling policy.
4. Cloud PostgreSQL schema/migrations; sync identity, authorization, data scope, conflict workflow, and retention. Local SQLite and graph/job history are implemented; backup and retention still need policy.
5. Local-agent token lifecycle and browser pairing/Origin/Host policy.
6. Whether AI explanation is included in the MVP; if yes, define provider, opt-in, context, and credential policy first.
7. Representative repositories and measurable accuracy, latency, and resource targets.

See the [development setup](DEVELOPMENT_SETUP.md) for the sequence and the [implementation plan](IMPLEMENTATION_PLAN.md) for phase gates.
