# 0015: Export graph history as a verified JSON document

- Status: accepted
- Date: 2026-11-01

## Context

Phase 2 requires export/recovery behavior for graph revisions. ADR 0009 kept history inside the local SQLite database only, and ADR 0014 added restore without a way to take history out of the agent.

## Decision

`GraphStore.exportGraphHistory` returns a `codifier.graph-history` document, `formatVersion: 1`, containing the repository ID, the current revision pointer, an export timestamp, and every revision record in sequence order with its snapshot. It reads in one SQLite transaction and re-verifies each snapshot's repository, content hash, and graph invariants; if any revision fails, the export is refused with `StorageCorruptionError` rather than producing a partial file.

The export contains graph metadata, evidence, and source locators only. It excludes source file contents and analysis job records, because job requests hold local repository paths and job retention is still open.

Clients obtain it through authenticated `GET /v1/repositories/<repository-uuid>/history/export`, the CLI command `graph history <repository-uuid>` (stdout, redirect to save), or the web explorer's Export button, which validates the format before saving the file locally.

## Alternatives considered

- Copy the SQLite database file. This exposes job records and every other repository in the database.
- Export only the current snapshot. `graph get` already does this; it loses revision lineage.
- Stream revisions without verification. A corrupted row would then be indistinguishable from real history.

## Consequences

- History can be inspected or archived outside the agent without granting database access.
- Importing an export into a new database is not implemented; recovery currently means inspecting the file or restoring revisions that are still in the database. Import needs its own identity and conflict rules.
- Large histories are serialized in memory; measure before relying on this for long-lived repositories.
