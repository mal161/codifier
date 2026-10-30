# Product brief

## Working description

Codifier helps developers understand, navigate, and safely change large codebases. It builds a navigable model that connects higher-level architecture to concrete files, symbols, dependencies, and supporting evidence. AI can help explain or suggest relationships, while developers retain control over what is accepted as true.

The project name is a working repository name, not a finalized product or brand decision.

## Problem

AI coding tools can add code and dependencies faster than a developer can build a mental model of them. A system may run while its structure, execution paths, ownership boundaries, and change risks remain unclear. Explaining one file at a time does not answer system-level questions such as:

- What happens when a user performs a particular action?
- Which files, symbols, services, and data stores participate in a feature?
- What depends on this module, and what could be affected by changing it?
- Which parts of the implementation differ from the intended architecture?

## Intended users

- Developers inheriting or maintaining unfamiliar repositories.
- Developers using AI coding assistants who need to verify and understand generated changes.
- Teams that need shared, traceable architecture knowledge.

## Product outcomes

1. Give a developer a useful map of a repository and its important relationships.
2. Let a developer follow a feature or behavior from an entry point through relevant implementation and data boundaries.
3. Navigate from architecture elements to precise source locations and back.
4. Explain change impact using dependencies and evidence.
5. Preserve the distinction between intended design, observed implementation, and proposed interpretation.

## Core product principles

- **Evidence before confidence:** show why a relationship is believed to exist and how it was established.
- **Human authority over intent:** developer-confirmed architecture represents intended design; analysis represents what it can observe in code.
- **Explicit uncertainty:** mark inferred, stale, unresolved, or unsupported results.
- **Useful without an LLM:** repository structure, symbols, and directly observed dependencies should remain useful when AI is unavailable.
- **Local-first analysis:** source code should remain in the developer's repository by default; any remote processing must be explicit and configurable.
- **One local agent:** CLI, VS Code, and local web clients share the same standalone agent for repository access, analysis, graph operations, and local persistence.
- **Offline-capable:** local analysis and graph browsing do not require connectivity; synchronization is durable and bounded to approved graph metadata/events.
- **Incremental and explainable:** re-analyze changes efficiently and show what changed and why.
- **Accessible representations:** provide a structured alternative to interactive diagrams.

## User-directed MVP shape

The MVP uses a standalone local Node.js/TypeScript agent shared by a CLI, VS Code extension, and local React web application. The agent analyzes a selected local repository, stores the graph in SQLite, and supports offline browsing. When online, it can synchronize the explicitly approved graph metadata/events to cloud PostgreSQL; complete source files are not uploaded by default.

The initial analyzer target is TypeScript/JavaScript with React and Express conventions. The MVP sequence also includes evidence/provenance, incremental identity and synchronization, React Flow visualization, precise source links, intended/actual comparison, Git context, and basic architecture rules. The first user task and measurable success criteria still need definition.

See [product requirements](PRODUCT_REQUIREMENTS.md) for MVP acceptance evidence and scope boundaries, and [user flows](USER_FLOWS.md) for the navigation and synchronization workflows.

## Scope boundaries

The long-form idea includes advanced architecture authoring, autonomous code generation, runtime tracing, broad collaboration, multi-agent execution, enterprise controls, billing, compliance analysis, and extensibility. These are possible future directions, not initial-release requirements. Basic intended/actual comparison, Git revision context, and architecture rules are in the directed MVP; the MVP does not require AI explanations or advanced Git history.

## Success signals to define

Before committing to a release, define measurable checks such as:

- A new user can locate the implementation of a selected behavior quickly.
- Source links resolve to the correct file and symbol for supported languages.
- Directly observed relationships can be distinguished from AI suggestions.
- Re-analysis after a small edit updates affected results without losing unrelated graph identity.
- Explanations cite the repository evidence they rely on and state uncertainty when evidence is incomplete.
