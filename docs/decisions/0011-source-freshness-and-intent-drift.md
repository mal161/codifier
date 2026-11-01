# 0011: Source freshness checks and intent drift review

- Status: accepted
- Date: 2026-10-31

## Context

Saved source ranges can outlive the file revision they describe. Opening an unverified range can direct a developer to unrelated code. Architecture mappings and intended component dependencies also need reviewable comparisons against observed imports without turning incomplete mappings into authoritative defect claims.

## Decision

- The local agent validates a selected actual entity by resolving its repository-relative path under a user-provided repository root, refusing a final symlink or an out-of-root real path, and comparing the current bounded file contents with the hash already recorded in file evidence.
- A missing or changed file is stale. Unsafe, oversized, unreadable, or un-fingerprinted locations are unresolved. Freshness validation does not persist or upload source contents.
- The web client requires a successful current result before enabling the VS Code source link. It does not automatically redirect a stale location to a similarly named symbol or a renamed file.
- Built-in drift checks compare intended component `DEPENDS_ON` relationships with actual `IMPORTS`, `REEXPORTS`, or `DEPENDS_ON` edges whose endpoints have explicit `MAPS_TO` links. Unmatched results are evidence-backed review prompts. Missing mappings and partial analysis can limit coverage; findings are not defect or compliance claims.
- Developer mappings remain reversible through an explicit removal action. Removal deletes only the mapping relationship and evidence no longer referenced by any graph item.

## Alternatives considered

- Trusting the stored range until the next analysis: rejected because the file may have changed after graph loading.
- Searching for a replacement symbol or renamed file automatically: rejected because duplicate or similar names do not prove identity.
- Persisting freshness as a mutable graph fact: deferred because the result depends on the current working tree and can be recalculated on request.
- Treating every dependency mismatch as a violation: rejected because mappings and syntax analysis can be incomplete and intent requires developer review.

## Consequences

- Source links require a local authenticated request and user-supplied repository root before opening.
- The freshness result is point-in-time; subsequent file edits require another check.
- Dependency drift review covers only the recorded relation types and explicitly mapped endpoints. Broader conflict checks remain future work; auditable exceptions were added in [ADR 0017](0017-auditable-rule-exceptions.md).
