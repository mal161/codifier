# Engine and subsystem specifications

These pages translate the engines and major product subsystems from the original product discussion into implementation guides. “Engine” is a logical capability boundary, not a requirement for a separate service, process, package, or database.

## Status key

- **Approved direction**: the discussion contains a clear approval; this is not automatically MVP scope.
- **Proposed**: described as a recommendation, but no unambiguous approval was recorded.
- **Open / incomplete**: the source discussion ends before a decision or its approval is ambiguous.
- **Existing guide**: implementation details are primarily in an existing document, linked below.

## Core product capabilities

| Specification | Scope | Status |
|---|---|---|
| [Architecture Intelligence](architecture-intelligence.md) | Canonical architecture model, actual/intended views, traceability, and map/canvas boundaries | Approved direction |
| [Codebase Intelligence](codebase-intelligence.md) | Repository discovery, static analysis, symbols, dependencies, and architecture reconstruction | Approved direction; MVP |
| [Developer Knowledge Intelligence](developer-knowledge-intelligence.md) | Help a developer understand code and answer codebase questions | Product concept; details distributed across existing guides |
| [AI Context](ai-context.md) | Retrieve bounded, evidence-backed context for model requests | Proposed capability; AI provider/data boundary open |
| [AI Provider Orchestration](ai-provider-orchestration.md) | Route validated requests to configured hosted or local model adapters | Provider strategy open |
| [API Contracts and Integration Boundaries](api-contracts.md) | Authenticated local REST/WebSocket contracts; later cloud and MCP interfaces | Local agent API required; MCP later |
| [Architecture Interoperability](architecture-interoperability.md) | Import/export architecture notations and render multiple views | Proposed / future |
| [Architecture Decision Intelligence](architecture-decision-intelligence.md) | Versioned ADRs linked to graph elements and change planning | Approved direction |
| [Interactive Architecture Map](architecture-map.md) | Browse the graph and navigate to exact source locations | MVP UX |
| [Editable Architecture Canvas](architecture-canvas.md) | Author intended architecture and constraints | Proposed / future |
| [IDE Integration](ide-integration.md) | VS Code client for browsing, refresh, and source navigation through the local agent | MVP client; additional IDEs later |
| [Local Companion Agent](local-companion-agent.md) | Shared local owner for analysis, graph, storage, local API, CLI, and synchronization | Required MVP architecture; framework details subject to validation |
| [Plugin Extensibility](plugin-extensibility.md) | Versioned extension points for technical capabilities | Approved direction; contract open |

## Planning and quality capabilities

| Specification | Scope | Status |
|---|---|---|
| [Architecture Simulation](architecture-simulation.md) | Isolated what-if graph branches and alternative comparison | Approved direction; future |
| [Architecture Migration Intelligence](architecture-migration-intelligence.md) | Phased, dependency-aware migration planning and controlled execution | Approved direction; future |
| [Technical Debt Intelligence](technical-debt-intelligence.md) | Evidence-backed debt discovery, prioritization, and remediation | Proposed / approval unclear |
| [Architecture Benchmarking](architecture-benchmarking.md) | Evidence-based comparisons with standards and reference architectures | Approval trail ambiguous; reconfirm before implementation |
| [Architecture Knowledge and Learning](architecture-knowledge-learning.md) | Verified knowledge, walkthroughs, learning paths, and freshness | Approved direction; future |

## Platform capabilities

| Specification | Scope | Status |
|---|---|---|
| [Observability and Diagnostics](observability-diagnostics.md) | OpenTelemetry-compatible logs, metrics, traces, and diagnostics | Approved direction |
| [Testing and Validation](testing-validation.md) | Golden repositories, graph invariants, integration and quality gates | Approved quality direction |
| [Data Retention, Backup, and Recovery](data-retention-recovery.md) | Durable graph history, export, deletion, backup, and restore | Approved direction; targets open |
| [Multi-Deployment](multi-deployment.md) | Local-agent MVP, optional cloud sync, and future portable deployment modes | Approved direction; broad hosted modes are future |
| [Commercial Intelligence and Entitlements](commercial-entitlements.md) | Usage, licensing, entitlements, and replaceable billing adapters | Approved direction; not MVP |
| [Platform Customization](platform-customization.md) | Validated organization-specific schema, rules, workflows, and views | Approved direction; future |
| [Accessibility and Internationalization](accessibility-internationalization.md) | Accessible interactions, WCAG target, localization readiness | Approved direction |
| [Product Feedback and Evolution](product-feedback-evolution.md) | Feedback, requests, roadmap, release notes, and research | Approved direction; future |
| [Data Governance and Compliance](data-governance-compliance.md) | Classification, lineage, retention, privacy analysis, and regulatory evidence | Open / source truncated |

## End-to-end pipelines

| Pipeline | Scope |
|---|---|
| [Architecture-to-code](../pipelines/architecture-to-code.md) | Requirements and design through approved plan, changes, tests, and graph refresh |
| [AI context retrieval](../pipelines/ai-context-retrieval.md) | Question through bounded graph/source retrieval and evidence-grounded response |
| [MCP agent context](../pipelines/mcp-agent-context.md) | External agent query through authorized, bounded, read-oriented context |
| [Architecture drift](../pipelines/architecture-drift.md) | Intended-versus-actual comparison and human-reviewed deviations |
| [Architecture simulation](../pipelines/architecture-simulation.md) | Isolated graph branch, comparison, and measurable versus predicted effects |
| [Architecture migration](../pipelines/architecture-migration.md) | Discovery, sequencing, phased work, validation, and rollback planning |

The [pipeline index](../pipelines/README.md) also covers architecture import, analysis validation, graph recovery, deployment/release, and feedback triage.

Repository parsing and graph update are specified in the [analysis pipeline](../ANALYSIS_PIPELINE.md); common graph semantics are in the [canonical graph](../CANONICAL_GRAPH.md). The [implementation plan](../IMPLEMENTATION_PLAN.md) and [decision register](../DECISION_REGISTER.md) govern sequencing and approval status.

## Rules for implementing these specifications

1. Do not interpret a subsystem page as approval to implement it in the first release.
2. Resolve open scope, data, security, ownership, and technology decisions before adding services or dependencies.
3. Keep the canonical graph and its evidence semantics authoritative; engines are consumers/producers through explicit contracts.
4. Require developer review before inferred architecture, AI suggestions, or generated changes become authoritative.
5. Keep customer feedback, commercial data, and compliance claims separate from observed repository facts.
6. Add tests for graph invariants, evidence accuracy, source locations, authorization boundaries, accessibility, and incremental updates as applicable.
