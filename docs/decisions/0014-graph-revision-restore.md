# 0014: Restore a graph revision by committing it as a new revision

- Status: accepted
- Date: 2026-11-01

## Context

Decision D-006 and ADR 0004 require restoring an earlier graph state by a new change, without erasing history. ADR 0009 stored append-only snapshots but provided no restore path, and the Phase 2 exit gate also needs evidence that injected write failures and job retries keep revision ordering and graph validity.

## Decision

`GraphStore.restoreGraphRevision` loads the requested revision, re-verifies its repository, content hash, and graph invariants, and commits that snapshot through the same transaction as any other graph write. The result is a new revision with the next sequence, the current revision as parent, an ID-based change summary against the current graph, and a `restored_from_revision_id` reference (migration `0005_graph_revision_restore`). Restoring a snapshot identical to the current graph adds no revision and reports `unchanged`. A revision that fails verification is refused with `StorageCorruptionError` and nothing is written.

The local agent exposes this as authenticated `POST /v1/repositories/<repository-uuid>/revisions/<revision-uuid>/restore`. It returns `{ status, revision, graph }`, emits `graph.updated` only when a revision was created, and returns `409 analysis_already_running` while an analysis job for that repository is active, because the job would otherwise commit on a stale baseline.

## Alternatives considered

- Move the current pointer back to the old revision. This rewrites what "current" meant and loses the audit trail of the restore.
- Delete revisions after the restored one. This violates D-006.
- Allow restore during analysis and let the later commit win. This silently discards the restore.

## Consequences

- History stays append-only and auditable; a restore is distinguishable from an analysis commit.
- A restored graph keeps the old entity UUIDs, so later analysis reconciles against it like any other baseline.
- Storage tests cover restore ordering across reopen, no-op restore, foreign/unknown revision IDs, tampered history, a mid-transaction constraint failure that rolls back the revision and current graph, and duplicate job retries.
- Not yet implemented: restore controls in the web or VS Code clients, history export, and retention/pruning policy.
