# Canonical architecture graph

## Purpose and status

The canonical graph is the shared representation between repository analysis, architecture views, source navigation, history, and optional AI features. It is a product-level model, not a selected database schema or graph-database requirement. Resolve persistence and serialization choices through an ADR before implementation.

The graph has one canonical identity space and distinct **actual** and **intended** architecture states. A difference between them is evidence for review, not automatically a defect.

## Modeling principles

1. Represent claims as typed entities and relationships, not only diagram coordinates or generated prose.
2. Preserve provenance and evidence at the claim level.
3. Keep actual observations, developer-authored intent, imported material, and AI inference distinct.
4. Keep source locations revision-aware and able to become stale.
5. Prefer stable identity with conservative reconciliation; never treat a matching fingerprint as proof of identity.
6. Permit useful partial graphs when files are unsupported or analysis is incomplete.
7. Keep schema, storage, and transport independent from the canonical semantics.

## Entity categories

The product discussion proposes these broad categories. The first analyzer should implement only entity kinds required by the accepted MVP workflow.

| Category | Candidate kinds | Initial-use guidance |
|---|---|---|
| System and architecture | System, Domain, Service, Component, Module | Developer-authored or reviewed architecture; do not infer authoritative intent silently. |
| Code | Package, File, Class, Interface, Function, Variable | Derive supported kinds from parsers and semantic adapters; expose language coverage. |
| API and data | API, Endpoint, Request, Response, Database, Table, Column, Entity | Add only where supported evidence and a concrete workflow justify them. |
| Infrastructure | Deployment, Container, Resource | Future scope unless directly needed for the first validated workflow. |
| Quality and planning | Requirement, Test Suite, Test Case, Migration | Future scope; link to evidence when introduced. |

These are logical categories; they do not imply separate databases, services, or tables.

## Common entity contract

An implementation-neutral entity should provide:

| Field | Meaning |
|---|---|
| `id` | Permanent UUID within the graph's identity model. |
| `kind` | Versioned type identifier such as `file` or `function`. |
| `name` | Display name. |
| `qualified_name` | Optional language- or domain-specific stable context. |
| `state` | `actual` or `intended`; avoid conflating the two. |
| `origin` | `source_analysis`, `developer`, `imported`, `runtime`, `test`, or `ai_inference`. |
| `metadata` | Type-specific validated data; not a place for unbounded raw source. |
| `locators` | Zero or more revision-aware source or external references. |
| `evidence_refs` | References to the evidence supporting this entity or claim. |
| `created_at`, `updated_at` | Timestamps if persistence is selected. |

The field names are illustrative and do not settle a wire format or schema. A confidence score is optional only if its meaning is defined and calibrated; evidence and uncertainty labels are more important than a number.

## Relationship contract

A relationship is a typed, directed claim between two graph entities. It should include:

- Stable relationship identity or a deterministic deduplication key.
- `type`, `source_id`, and `target_id`.
- State and origin, consistent with the entity model.
- One or more evidence references.
- Optional validity/revision information and a lifecycle status such as current, stale, rejected, or superseded.

Candidate relationship types include `CONTAINS`, `IMPORTS`, `DEPENDS_ON`, `CALLS`, `IMPLEMENTS`, `EXPOSES`, `READS`, `WRITES`, `TESTS`, and `MAPS_TO`. Only emit a type when an analyzer or reviewed authoring flow has evidence for it. Never convert a guessed call path into a source-observed fact.

## Evidence and provenance

Evidence explains why an entity or relationship exists. Candidate evidence kinds:

- **Source analysis:** parser or semantic tool result, with file/revision and source range.
- **Compiler/type tooling:** tool identity and relevant result, where available.
- **Test:** test identity, revision, and the behavior exercised; a test does not prove behavior it does not cover.
- **Runtime:** observed event and execution context, only when runtime collection is later designed.
- **Developer:** explicit confirmation or authored decision.
- **Import:** source document or notation and import revision.
- **AI inference:** model/provider metadata as permitted, bounded input references, and a review state.

For AI-derived claims, retain review outcomes. Rejected suggestions must not reappear as accepted facts without new evidence.

## Source locator

A source locator should contain:

- Repository-relative path, normalized for the host platform.
- 1-based start/end lines and 0-based UTF-16 columns, with the end position exclusive. The TypeScript adapter derives these coordinates from parser offsets; editor URI adapters convert columns to the convention required by their target.
- A source revision or content fingerprint sufficient to detect whether the location may have moved.
- Optional symbol identity/fingerprint for navigation and reconciliation.
- A freshness state, or enough information to calculate whether it is stale.

Line numbers are coordinates in a particular source revision, not permanent identity. If the file changes and a location cannot be reconciled confidently, mark it stale and require re-analysis rather than navigating to a misleading range.

## Identity and reconciliation

- Assign each graph entity a UUID; preserve it across updates when continuity is supported by evidence.
- Use symbol fingerprints, qualified names, surrounding structure, and repository history as reconciliation signals, not as permanent IDs.
- If two candidates are plausible, do not silently merge. Surface ambiguity, retain history, or create a new identity according to the chosen reconciliation policy.
- A rename or move should preserve identity only when evidence supports the match.
- Tests must cover insertion/deletion around symbols, renames, moves, duplicate names, and ambiguous matches.

## Graph invariants

1. Every edge endpoint refers to an existing entity in the same graph scope.
2. Every source-backed entity or edge has evidence that resolves to its recorded revision or is explicitly marked stale.
3. Actual and intended state are never merged by visualization or persistence shortcuts. An intended `MAPS_TO` relationship may explicitly connect an intended source to an actual target.
4. An inference is never presented as a confirmed source fact.
5. Partial analysis retains diagnostics and does not erase unrelated valid entities.
6. Deleting or replacing graph content preserves the configured history and audit semantics.
7. Query results respect repository/workspace authorization if shared storage is introduced.

## Update and history model

The accepted direction is incremental analysis plus versioned graph snapshots and change events. The graph should support:

- A current view that includes uncommitted changes when available.
- Revision association with Git when available, without requiring Git as a precondition.
- A change summary showing added, changed, removed, stale, and unresolved claims.
- Snapshot comparison and restoration as a new event rather than erasure of history.
- Identity continuity for unaffected entities.

The local SQLite store records append-only validated graph snapshots with UUID revision IDs, a per-repository sequence, parent revision, Git/source revision, canonical hash, timestamp, ID-based change summary, and a current-revision pointer. Snapshot metadata and normalized current graph rows are committed in one transaction. Authenticated agent routes list revisions and retrieve an earlier snapshot. Retention, backup/export, restore interface, and job recovery remain open. Cloud PostgreSQL schema and sync protocol remain unimplemented and undecided.

## Storage technology direction and schema

The local store uses SQLite/Drizzle with normalized current-state tables and serialized historical snapshots, as recorded in [ADR 0009](decisions/0009-local-graph-revision-storage.md). Optional cloud PostgreSQL/Drizzle remains conditional and has no accepted sync schema. Do not introduce a graph database merely because the product is graph-shaped.

## Related implementation guides

- [Analysis pipeline](ANALYSIS_PIPELINE.md)
- [Security and privacy](SECURITY_PRIVACY.md)
- [Product requirements](PRODUCT_REQUIREMENTS.md)
- [Architecture overview](ARCHITECTURE.md)
