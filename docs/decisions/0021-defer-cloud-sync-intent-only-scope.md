# 0021: Defer cloud synchronization; if built, sync intent only and reject stale edits

- Status: accepted
- Date: 2026-11-02
- Decided by: the repository owner, answering the Phase 7 preconditions.

## Context

Phase 7 of the remaining-features plan is conditional: it may start only after two data questions are answered and recorded — which graph data may synchronize, and how concurrent intended-architecture edits are resolved — and Phase 8 counts it only if cloud sync is selected as release scope. Repository guidance asks to keep the first release narrow until a first-user workflow validates the core. Cloud identity, hosting, and vendor (O-012, TECH_STACK cloud candidate) are undecided. The local MVP (Phases 0–6) works fully offline, with acceptance evidence on Linux, macOS, and Windows in CI.

## Decision

1. **Scope: cloud synchronization is deferred out of the first release.** No cloud service, PostgreSQL schema, outbox, or account model is built now. Phase 7 is out of release scope, so Phase 8's exit gate does not depend on it. The local agent remains the only data store and works offline.
2. **Data scope, when sync is built: intent only.** Only developer-authored intent may leave the machine: intended components, code-to-component mappings, intended dependencies, and rule exceptions. The observed graph — file paths, symbol names, imports, evidence, source ranges, hashes — and revision history stay local; each machine re-derives the observed graph by analysis. Source file contents never sync. Mappings necessarily reference observed entities; a future sync design must define how those references are expressed without uploading the observed graph (for example repository-relative path plus entity kind and name) and must say so in its own ADR.
3. **Conflict policy, when sync is built: reject stale edits; resolve manually.** Every synced intent item carries a version. An edit based on an older version than the server's is refused, not merged, and is presented as a conflict showing both versions; the developer chooses which to keep or records a new edit. Nothing is overwritten silently, and both versions remain auditable.

## Alternatives considered

- Build minimal sync now: rejected for the first release; no validated multi-machine workflow requires it yet, and identity and hosting are undecided.
- Design only (write the event contract now): not chosen; decisions 2 and 3 fix the policy, and the contract is better designed against a concrete first-user need.
- Sync the observed graph or history: exposes code structure and paths and grows storage; analysis already reproduces the observed graph locally.
- Automatic merge of independent edits, or cloud-authoritative review: more logic or an extra review workflow; can be revisited if manual resolution proves too frequent.

## Consequences

- The first release makes no claims about cloud sync, multi-user collaboration, tenant isolation, or remote storage.
- Phase 8 proceeds on Phases 0–6.
- If sync is later selected, implementation starts from these two policies; workspace identity, authorization, retention, export, deletion, and the entity-reference format still need their own decisions before code.
