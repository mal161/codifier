# 0009: Store local graph revisions as append-only SQLite snapshots

- Status: accepted
- Date: 2026-10-31

## Context

ADR 0004 requires versioned graph snapshots and permanent entity identity. The first SQLite store only replaced normalized current-state rows, so a restart preserved the latest graph but prior states were lost. Incremental analysis depends on durable history and must not expose partially written snapshots.

## Decision

Keep the normalized SQLite tables as the current-graph read model and add an append-only `graph_revisions` table. Each committed graph change stores a validated snapshot, a UUID revision ID, a per-repository monotonic sequence, the parent revision ID, the source/Git revision when available, a canonical SHA-256 content hash, a timestamp, and an ID-based summary of added, changed, and removed entities, relationships, and evidence. The repository row points to the current graph revision.

Write the history row, current pointer, repository metadata, and normalized current graph in one SQLite transaction. A semantic no-op does not add a revision. A legacy database receives its current snapshot as a baseline revision on its first changed write. History snapshots contain graph metadata, evidence, and source locators; they do not copy source file contents.

## Alternatives considered

- Keep only the current normalized graph and rely on Git history.
- Rebuild every historic query by replaying per-entity events.
- Store snapshots as separate files outside the SQLite transaction.

## Consequences

- Current graph queries retain their existing normalized read path; history retrieval is available through `GraphStore`.
- Snapshot writes remain atomic, and earlier snapshots survive process/database reopen.
- This first increment does not implement job recovery, history export/restore UI, retention/deletion policy, or cloud synchronization. Those remain separate work.
- Snapshot growth and long-term retention need measurement and a future explicit policy before pruning is introduced.
