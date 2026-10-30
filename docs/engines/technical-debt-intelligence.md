# Technical Debt Intelligence

## Status

**Proposed; approval is unclear in the source discussion.** Do not treat this as an approved subsystem or MVP requirement until scope is reconfirmed.

## Purpose

Collect and organize evidence-backed maintainability and architecture risks so teams can understand, prioritize, and deliberately accept or remediate them.

## Candidate findings

- Excessive coupling or rule violations.
- Duplicate logic or complex modules.
- Outdated or risky dependencies.
- Missing test coverage signals.
- Abandoned or redundant implementations.
- Documentation or decision gaps.

These are detection candidates, not definitions of debt. A detector must disclose its method and limitations.

## Candidate workflow

1. Detect a candidate from static analysis, configured rules, tests, dependency metadata, or reviewed input.
2. Attach exact source/graph evidence and affected components.
3. Classify as confirmed issue, potential risk, or accepted trade-off.
4. Allow an owner to document rationale and review date for retained debt.
5. Prioritize using transparent impact, risk, affected dependencies, and estimated effort.
6. Link remediation to implementation planning or migration workflows.
7. Track trends only when revision and history data are available.

## Guardrails

- Do not call all shortcuts or warnings “debt.”
- Do not rank with opaque scores or imply precision unsupported by evidence.
- AI remediation must be a reviewable proposal.
- Accepted trade-offs remain visible without being re-reported as new defects.

## Decision gate

Reconfirm whether this capability belongs in the product and define its intended user, non-goals, and MVP timing before implementation.

See [decision register O-011](../DECISION_REGISTER.md), [architecture benchmarking](architecture-benchmarking.md), and [architecture migration](architecture-migration-intelligence.md).
