# Analysis Validation Pipeline

## Status

**Approved quality direction.** Golden repositories are central to analyzer quality assurance.

## Flow

```text
Select supported-language fixture/repository
    -> run clean analysis with pinned configuration
    -> compare entities, edges, evidence, locators, and diagnostics
    -> apply controlled source change
    -> run incremental analysis
    -> compare incremental result with clean analysis of same revision
    -> review quality and performance gates
```

## Validation dimensions

- Structural extraction and declared language coverage.
- Semantic relationships and unresolved cases.
- Architecture inference labels and review state.
- Source line/column accuracy and revision freshness.
- Stable identity for unchanged entities and conservative ambiguous matching.
- Partial results under parser and tool failures.
- Repository safety, cancellation, and privacy.
- Graph integrity and access isolation where applicable.

## Acceptance evidence

- Expected outputs are version-controlled fixtures, not hand-waved screenshots.
- Differences include actionable diagnostics and are reviewed when expectations change.
- Incremental and clean outputs are semantically equivalent for the tested revision.
- Performance thresholds are defined using representative repositories before release.

See [testing and validation](../engines/testing-validation.md), [analysis pipeline](../ANALYSIS_PIPELINE.md), and [decision register D-010](../DECISION_REGISTER.md).
