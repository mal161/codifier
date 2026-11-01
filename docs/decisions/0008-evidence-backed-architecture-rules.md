# 0008: Evidence-backed architecture rules

- Status: accepted
- Date: 2026-10-31

## Context

The MVP calls for explicit architecture checks over the canonical graph. Findings must be traceable to observed graph evidence and must not silently turn an inference or design preference into an authoritative defect. The local agent owns graph access and the web client needs actionable, navigable results.

## Decision

- Evaluate a versioned, deterministic built-in rule set against the saved graph in the local agent.
- The checks report actual dependency cycles (`IMPORTS`, `DEPENDS_ON`, and `REEXPORTS`), observed entities mapped to multiple intended components, intended components with no mapped observed code, and mismatch between intended component dependencies and imports observed between explicitly mapped code.
- Findings return their rule ID, review severity, message, related entity and relationship IDs, and supporting evidence IDs. They are derived results, not persisted graph facts.
- The local web client displays evidence and links findings to graph items.
- Findings are review prompts, not compliance claims or automatic edits. Do not execute repository code.
- Defer user-authored rule packs until a declarative format, versioning policy, and rule semantics are separately designed.

## Alternatives considered

- Persist findings as observed graph relationships: rejected because findings are derived and should not be confused with source-analysis facts.
- Claim an architecture violation from an unmapped component or shared mapping: rejected because these states may be intentional and require developer review.
- Run arbitrary code supplied by rule packs: rejected because the initial checks need no executable extension mechanism.

## Consequences

- Rule results can be recalculated from each saved graph without schema migrations.
- Evidence IDs and graph references let developers inspect the input facts behind each finding.
- Rule-set versioning is exposed so results can be interpreted against the checks that produced them.
- Rule set version 1.1.0 adds mapped dependency drift checks. Unmapped endpoints do not produce inferred component dependencies, and findings remain review prompts.
- Rule set version 1.2.0 adds intent conflict checks and source locations on every finding ([ADR 0018](0018-rule-set-1-2-drift-conflicts-and-locations.md)).
- Extending or authoring rules requires explicit semantics, evidence requirements, bounded evaluation, and client presentation.
