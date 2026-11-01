# 0017: Record architecture rule exceptions as append-only review decisions

- Status: accepted
- Date: 2026-11-02

## Context

Decision D-001 says a deviation from intended architecture is not automatically a defect and that intentional exceptions can be documented. The drift pipeline requires that a known exception is not silently erased or repeatedly misclassified, and Phase 4 requires exceptions with author, rationale, scope, and optional expiry/status that do not mutate intended architecture. Rule findings (ADR 0008) are derived on every evaluation and had no stable identity.

## Decision

- A finding's identity is `findingKey`: SHA-256 of its rule ID and its sorted, de-duplicated entity UUIDs. Entity UUIDs are permanent across re-analysis; relationship IDs are excluded because import relationships are re-identified when statements move.
- Exceptions are stored in their own SQLite table (migration `0006_architecture_rule_exceptions`), outside the graph and outside graph revisions. Each records the finding key, rule ID, entity scope at creation, rationale, author, creation time, and an optional future expiry. Records are never edited or deleted; revoking sets revoked-by, reason, and time once. A partial unique index allows at most one unrevoked exception per finding, so an expired exception must be revoked before a new decision is recorded.
- An exception can only be created for a finding the saved graph produces now. Status is derived on read: `active`, `expired` (past expiry, not revoked), or `revoked`.
- The agent's rule evaluation annotates every finding with `findingKey` and its unrevoked exception, if any. Excepted findings are still returned and displayed. Routes: `GET/POST /v1/repositories/<id>/rule-exceptions` and `POST .../rule-exceptions/<exception-id>/revoke`. The list reports whether each exception still matches a current finding.
- The local agent has no user identity. `author` and `revokedBy` are names the developer enters and are self-attested; they are not authenticated.

## Alternatives considered

- Store exceptions as graph entities or relationships. This would mix review decisions into the observed/intended graph, create graph revisions for review actions, and let a revision restore silently undo a decision.
- Hide excepted findings. This erases the deviation from view, which the drift pipeline forbids.
- Key exceptions by relationship IDs or message text. Both change when code moves or wording changes, which would orphan decisions.
- Allow editing a rationale in place. This loses the audit trail; revoke and record anew instead.

## Consequences

- Review decisions survive re-analysis, graph replacement, and revision restore, and remain reviewable after the finding disappears.
- A finding whose entity set changes (for example a cycle that grows) gets a new key and returns to open review; the earlier exception stays listed as no longer matching.
- Author fields are not identity proof. A multi-user or shared deployment needs authenticated reviewers before these records can serve as approvals.
- Exceptions are not included in the graph history export (ADR 0015).
