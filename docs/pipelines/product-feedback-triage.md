# Product Feedback Triage Pipeline

## Status

**Approved product direction; future capability.**

## Flow

```text
User submits feedback
    -> explain and obtain consent for included diagnostics
    -> validate and categorize
    -> triage/research
    -> connect to issue, requirement, or initiative
    -> product decision and roadmap update
    -> communicate status/release notes
```

## Requirements

- Feedback does not change architecture truth or requirements automatically.
- Diagnostic collection is opt-in, inspectable where feasible, and source-safe by default.
- Categorization and analytics are aids to human product decisions.
- Preserve links to the original report and subsequent issue/requirement/release records.
- Community votes are signals, not automatic prioritization.

## Acceptance evidence

- A user can submit with no source attachment.
- Diagnostic payload tests verify excluded source and secret content.
- Every roadmap change has a human-owned decision and traceable rationale.
- Feedback is kept separate from customer repository graph data.

See [Product Feedback and Evolution](../engines/product-feedback-evolution.md) and [security and privacy](../SECURITY_PRIVACY.md).
