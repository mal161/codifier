# 0022: Import history only into new repositories; keep all history unless a person prunes

- Status: accepted
- Date: 2026-11-02
- Decided by: the repository owner, choosing between import and retention options.

## Context

ADR 0015 added a verified `codifier.graph-history` export but no import, and ADR 0009 left retention open: every change adds a full snapshot revision, so history only grows. Decision D-006 requires restoring without erasing history; D-012 calls for controlled deletion. Entity, evidence, relationship, and revision IDs are unique across the whole local database, so the same repository cannot be imported under a second ID.

## Decision

**Import** (`POST /v1/history/import`, `graph import-history <file>`):

- Imports only into a repository this database does not have. If the repository exists, the import is refused (`409 repository_exists`); local history is never replaced or merged. If any revision or current-graph ID already belongs to another repository, it is refused (`409 identifier_in_use`).
- Every revision is re-verified before anything is written: repository ID, unique IDs, strictly increasing sequence, each parent equal to the previous revision (the first has none), restore links pointing to earlier revisions, graph invariants, and the content hash. The current revision must be the latest. Any failure refuses the whole import (`400 invalid_history`).
- One transaction writes the repository, all revisions with their original IDs, sequences, timestamps, and change summaries, the current graph rows, the current pointer, and any prune audit records carried by the export.
- The route accepts bodies up to 64 MiB; the agent-wide limit stays 1 MiB.

**Retention** (`POST /v1/repositories/<id>/revisions/prune`, `graph prune <id> [--keep-last N] [--older-than-days D]`):

- Nothing is deleted automatically. Pruning happens only when a person asks.
- A prune takes `keepLast`, `olderThanDays`, or both. A revision is removed only if every given criterion selects it, only the oldest revisions are removed, and the current revision is always kept.
- The oldest remaining revision loses its parent link, and restore links to removed revisions are cleared, in the same transaction.
- Each prune that removes revisions appends an audit record (count, oldest kept sequence, criteria, time). History exports include these records and imports carry them over.
- Pruning is refused while an analysis of that repository is running (`409`).

## Alternatives considered

- Import by appending the export's current graph as a new revision of an existing repository: merges two histories implicitly; can be added later as a separate, explicit action.
- Import by replacing local history: destroys local revisions, conflicting with D-006.
- Automatic retention (keep last N, or by age): bounded storage, but history disappears without a person deciding.

## Consequences

- Moving a repository to a new machine or rebuilding a database is now possible from an export without losing history.
- Storage grows until someone prunes; there is no default limit or reminder yet.
- Exports from before pruning existed import unchanged. A pruned export's first revision has no parent; imports accept that.
- Rule exceptions are not part of the export, so they are not imported (ADR 0017).
