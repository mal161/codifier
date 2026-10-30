# Architecture overview

## Status

This document describes the target architecture and boundaries. The workspace, local agent, graph storage, and first bounded TypeScript/JavaScript analysis slice are implemented; the rest of the flow remains planned. It does not settle a deployment topology or cloud schema. Record material choices in `docs/decisions/` before implementing those parts.

## Conceptual flow

```text
VS Code / CLI / Local React Web Client
                 |
         Authenticated loopback API
                 |
       Standalone local companion agent
                 |
Local repository
      |
      v
File inventory and language detection
      |
      v
Parsers and language-specific semantic adapters
      |
      v
Common intermediate representation
      |
      v
Evidence-backed architecture graph <---- Developer-authored intended design
      |                                           |
      +-------------------+-----------------------+
                          v
                 Queries and navigation
                          |
                 Optional AI explanation
                          |
                          v
             Explanation with source evidence
                 |
        Optional graph metadata sync
                 v
        Cloud API / PostgreSQL
```

## Logical components

1. **Repository access and inventory**: select a repository, respect ignore rules and size limits, detect languages, and report unsupported files without silently omitting them.
2. **Local companion agent**: sole owner of repository access, analysis jobs, graph operations, SQLite persistence, and durable sync outbox; shared by the CLI, VS Code extension, and local React web application.
3. **Analysis engine**: perform syntax analysis, then language-specific semantic resolution where supported. Normalize discoveries into a versioned intermediate representation.
4. **Architecture graph**: represent projects, packages, components, files, symbols, relationships, source locations, and evidence. Support intended and actual states so drift can be discussed without conflating design and implementation.
5. **Synchronization and history**: update affected entities after changes; preserve stable entity IDs where reconciliation evidence supports continuity; record revisions and meaningful graph changes; synchronize only approved graph metadata/events.
6. **Query and explanation layer**: retrieve relevant graph facts and source excerpts. AI explanations must be grounded in retrieved evidence and label unsupported claims as uncertain.
7. **User interface and integrations**: provide browsing, search, impact inspection, and accessible diagram/list views through the shared agent.

These are conceptual boundaries. They do not require separate deployable services. See the [local companion agent specification](engines/local-companion-agent.md) for API ownership, offline behavior, synchronization, and security requirements.

For implementation details, see the [analysis pipeline](ANALYSIS_PIPELINE.md), [canonical graph specification](CANONICAL_GRAPH.md), [product requirements](PRODUCT_REQUIREMENTS.md), and [user flows](USER_FLOWS.md).
The subsystem boundaries and end-to-end flows are catalogued in [engine specifications](engines/README.md) and [pipeline specifications](pipelines/README.md).

## Analysis and evidence policy

- Begin with static analysis; do not execute an analyzed repository as part of indexing.
- Use parsers such as Tree-sitter only after language coverage and implementation technology are selected.
- Record provenance for graph facts: source analysis, compiler/type tooling, tests, runtime observation, developer input, imported documentation, or AI inference.
- A claim must not be stronger than its evidence. Tests only establish the behavior they exercise; static analysis cannot resolve every dynamic call.
- Keep AI-inferred relationships marked as inferences until a developer confirms, rejects, or edits them. Retain review outcomes to avoid repeating rejected suggestions.
- Track source revision and location freshness. A line range from an old revision is not automatically valid for the current source.

## Graph and history direction

The product brief supports one canonical graph with separate intended and actual states. Candidate graph elements have stable UUIDs; symbol fingerprints and reconciliation evidence may help preserve identity across refactors, but fingerprints are not IDs. Versioned snapshots and change events may provide history; the schema and storage technology remain open.

## Security and privacy constraints

- Treat repository contents, secrets, and derived architecture metadata as sensitive.
- Keep repository analysis local by default until an explicit data-flow design says otherwise.
- Do not execute repository code during static indexing.
- Redact sensitive values from logs and diagnostics.
- If accounts or shared workspaces are introduced, enforce authorization at every API boundary and verify tenant isolation in storage and queries.
- Make retention, export, and deletion behavior explicit before storing repository-derived data remotely.

The [security and privacy guide](SECURITY_PRIVACY.md) defines the MVP data boundaries and future-service decision gates. The [AI integration guide](AI_INTEGRATION.md) defines optional model-provider constraints; neither implies that remote processing is currently approved.

## Quality attributes

- Correct source-to-symbol navigation for supported languages.
- Partial and incremental analysis with visible errors and coverage.
- Deterministic structural results where possible.
- Clear separation of observed, intended, inferred, and stale information.
- Responsive graph queries on representative repositories.
- Accessible keyboard and screen-reader alternatives to visual graphs.
