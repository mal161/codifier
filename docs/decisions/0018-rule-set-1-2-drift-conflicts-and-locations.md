# 0018: Rule set 1.2.0 — intent conflicts and source locations on every finding

- Status: accepted
- Date: 2026-11-02

## Context

Phase 4 requires drift review that reports conflicting intended and actual facts with evidence and source locations. Rule set 1.1.0 (ADR 0008, ADR 0011) did not detect two owners for nested code, did not detect contradictions inside intended dependencies, reported a reversed dependency as two unrelated findings, and returned no source locations, so findings about code pointed only at IDs. Its drift rule also copied arrays on every append and filtered all mappings inside loops, which grows super-linearly on large mapped graphs.

## Decision

- Bump the rule set to `1.2.0` because finding output changes shape.
- Add `conflicting-nested-mapping` (warning): an observed entity whose nearest mapped container through `CONTAINS` is mapped to a disjoint set of intended components. Walking stops at the first mapped ancestor and tolerates malformed containment cycles.
- Add `intended-dependency-cycle` (warning): a cycle among intended component `DEPENDS_ON` relationships, using the same deterministic strongly-connected-component search as observed cycles.
- When an unplanned observed dependency runs opposite to a recorded intended dependency, say so in its message. Rule IDs and entity sets of existing rules are unchanged, so exception `findingKey`s (ADR 0017) keep matching.
- Every finding carries `sourceLocations` (at most 10, de-duplicated) and `sourceLocationCount` (all distinct locations). Evidence of observed relationships comes first (for example the exact import statement), then ranges of observed entities. Intent-only findings have none, and the web client says so explicitly instead of showing nothing.
- Build all lookups once per evaluation; select the first locations with a bounded sorted insert instead of sorting every location.

## Alternatives considered

- Replace the unrealized/unplanned pair with a single "reversed dependency" finding. This would change keys that recorded exceptions depend on.
- Report all observed code without a component mapping. This floods repositories that are only partly mapped and is not a conflict.
- Return every source location. Large cycles reference tens of thousands of statements; the count keeps the total visible without the payload.

## Consequences

- On a synthetic graph of 20,000 files, 60,000 imports and 200 components, evaluation went from about 1.2 s (1.1.0) to about 0.7 s; at 60,000 files and 400 components from about 7.2 s to about 2.6 s, with near-linear growth. A test asserts a loose upper bound to catch quadratic regressions. These are local measurements on one Windows machine, not a published benchmark.
- Nested-mapping conflicts depend on `CONTAINS` edges, which the analyzer emits for declarations; ownership expressed only through directories is not checked.
- Clients validating strictly must accept `ruleSetVersion: "1.2.0"` and the two location fields.
