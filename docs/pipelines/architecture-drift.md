# Architecture Drift Pipeline

## Status

**Future capability, supported by the approved intended/actual graph direction.**

## Flow

```text
Select intended graph revision
    -> select actual analysis revision
    -> align entities and mappings
    -> compare relationships and constraints
    -> produce evidence-backed candidate deviations
    -> developer review
    -> record intentional exception or approved design change
```

## Candidate findings

- Expected component missing from implementation.
- Observed component has no intended mapping.
- Unexpected or disallowed dependency.
- Required dependency or boundary absent.
- Source mapping stale or no longer resolves.
- Existing implementation appears to bypass an intended abstraction.

## Requirements

- Compare compatible graph revisions and disclose incomplete analysis.
- Explain why each finding was generated and link to source/decision evidence.
- Distinguish detected, semantically resolved, inferred, and unknown relationships.
- Treat deviations as candidates, not automatic violations.
- Allow a developer to document an intentional exception with provenance and review context.
- AI may explain a finding only as a separate, labeled interpretation.

## Acceptance evidence

- A known intentional exception is not silently erased or repeatedly misclassified as confirmed defect.
- Partial language coverage is visible in the comparison.
- Each finding is reproducible from the graph revisions and rule version.
- Review actions do not rewrite actual analysis facts.

See [architecture intelligence](../engines/architecture-intelligence.md), [canonical graph](../CANONICAL_GRAPH.md), and [architecture decision intelligence](../engines/architecture-decision-intelligence.md).
