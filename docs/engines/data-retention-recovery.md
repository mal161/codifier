# Data Retention, Backup, and Recovery

## Status

**Approved direction; storage targets selected.** The user-directed MVP uses SQLite/Drizzle for local agent state and PostgreSQL/Drizzle for optional cloud graph synchronization. Schema, retention periods, backup/recovery targets, export format, and deletion behavior remain open.

## Data in scope

Potentially durable data includes graph states, source mappings and identities, evidence/provenance, snapshots and change events, project configuration, approvals, and audit records. Source code remains in the developer repository by default.

## Required capabilities when persistence is introduced

- Back up durable graph data and document recovery procedures.
- Define retention separately for graph history, logs, diagnostics, and temporary analysis artifacts.
- Support export and controlled deletion for the selected scope.
- Protect the local database and pending synchronization outbox; local analysis must remain available when sync is offline.
- Preserve immutable/auditable history according to explicit retention policy.
- Define and test recovery time and recovery point objectives before claiming them.

## Lifecycle flow

```text
Persist selected metadata
    -> apply retention policy
    -> backup and monitor
    -> restore-test
    -> export or delete by authorized request
    -> verify deletion/retained-audit behavior
```

## Guardrails

- Do not enable cloud synchronization until workspace authorization, metadata scope, retention, conflict, export, and deletion rules are defined.
- Backups do not override deletion or retention obligations; define how backup copies expire.
- Clearly distinguish source repository content from derived metadata.
- Test export format and restore, not only backup creation.

See [decision register D-012](../DECISION_REGISTER.md), [development setup](../DEVELOPMENT_SETUP.md), and [security and privacy](../SECURITY_PRIVACY.md).
