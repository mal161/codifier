# Testing and Validation

## Status

**Approved quality direction.** The discussion approves a multi-layered testing strategy with golden repositories central to analyzer quality. Exact tooling is open.

## Quality objectives

- Verify parser coverage, graph consistency, identity, source locations, and incremental updates.
- Verify that errors and unsupported constructs remain visible.
- Verify intended/actual separation and provenance invariants.
- Verify privacy, repository boundaries, and tenant isolation if shared services are introduced.
- Verify accessibility for maps, canvases, and workflows.
- Verify changes against realistic repository sizes and supported languages.

## Test layers

1. **Unit:** path policy, parser adapters, source ranges, identity matching, relationship validation, and response validation.
2. **Golden repositories:** expected graph records, diagnostics, coverage, and locators for representative source constructs.
3. **Integration:** repository inventory through IR and graph update, incremental versus clean analysis, and source navigation.
4. **Contract:** API, plugin, provider, and MCP request/response validation when those surfaces exist.
5. **Security/privacy:** no repository execution, path traversal and symlink handling, secret redaction, consent, and tenant boundary tests if applicable.
6. **Accessibility:** automated checks plus keyboard and screen-reader review.
7. **Performance:** measure representative repositories against thresholds chosen before release.

## Release-blocking invariants

- Graph edges never point to missing entities.
- Source ranges resolve to the expected revision or are explicitly stale.
- Unrelated entity identity is retained across incremental edits when evidence supports it.
- Failed or canceled analysis cannot silently commit an inconsistent graph.
- AI inference never becomes an observed fact without review.

## Acceptance evidence

Maintain a documented test matrix by language, construct, graph relationship, and source-location behavior. A release must have reproducible results for the supported matrix; passing a small synthetic example alone is insufficient.

See [decision register D-010](../DECISION_REGISTER.md), [analysis pipeline](../ANALYSIS_PIPELINE.md), and [development setup](../DEVELOPMENT_SETUP.md).
