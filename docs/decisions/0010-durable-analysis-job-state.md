# 0010: Persist analysis job state and fail interrupted jobs on restart

- Status: accepted
- Date: 2026-10-31

## Context

The local agent accepted jobs asynchronously, but its in-memory job map disappeared on process exit. Clients could not distinguish an interrupted analysis from a lost job, even though graph writes were transactional.

## Decision

Persist each analysis job's validated status/progress/result and bounded request parameters in a local SQLite `analysis_jobs` table. Persist at job creation, phase changes, terminal outcomes, cancellation, and at most every 250 ms during same-phase progress updates. When analysis commits a graph, write the completed job result in the same SQLite transaction as the graph snapshot and revision. Retain up to 50 job records and delete pruned records from SQLite.

When a new agent process finds a queued, running, or cancelling job, mark it failed with an explicit retry message. Do not resume an analyzer mid-file. A user retry starts a fresh full analysis using the last committed graph as its identity/reconciliation baseline; no partial graph is published. Persisted job inputs contain the local repository path and policy options, not source file contents.

## Alternatives considered

- Keep job state in memory and require clients to infer interruption.
- Resume directly from parser progress checkpoints, which would require durable analyzer-stage checkpoints and cache invalidation semantics.
- Automatically rerun jobs at startup without user visibility or concurrency controls.

## Consequences

- Job status and outcomes remain queryable after agent restart; interrupted work is explicit and retryable.
- Restart repeats analysis from the beginning rather than resuming a checkpoint.
- Job result/request storage is local-only and covered by the local database lifecycle; export and retention policy beyond the current 50-record bound remain open.
