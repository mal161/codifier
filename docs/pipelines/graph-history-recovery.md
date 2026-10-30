# Graph History and Recovery Pipeline

## Status

**Approved direction; persistence implementation is open.**

## Flow

```text
Validated graph change
    -> append versioned change event
    -> produce/associate snapshot and source revision
    -> verify graph consistency
    -> back up durable metadata
    -> periodically test restore/export
    -> process authorized retention/deletion requests
```

## Requirements

- Keep prior graph state recoverable according to an explicit retention policy.
- Treat restore as a new event or revision rather than erasing history.
- Associate Git revisions when available, while allowing uncommitted repository state.
- Include evidence/provenance and source-locator freshness in snapshots.
- Make export format, deletion scope, and backup expiry behavior explicit.
- Do not claim a recovery point/time objective until tested.

## Acceptance evidence

- Restore tests recover a graph whose invariants pass.
- Snapshot comparison identifies additions, changes, removals, and stale references.
- Export can be validated independently of the storage engine.
- Authorized deletion follows the documented policy across active and retained copies.

See [Data Retention, Backup, and Recovery](../engines/data-retention-recovery.md), [canonical graph](../CANONICAL_GRAPH.md), and [decision register D-006/D-012](../DECISION_REGISTER.md).
