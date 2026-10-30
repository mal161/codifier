# MCP Agent Context Pipeline

## Status

**Future integration; tool schemas are proposed, not finalized.** MCP is an interface to architecture intelligence, not the whole product. Start with read-oriented tools.

## Request flow

```text
External agent request
    -> authenticate/authorize repository scope
    -> validate tool arguments
    -> bounded graph/source query
    -> attach provenance and source locators
    -> redact and enforce result limits
    -> return structured response and diagnostics
```

## Candidate read tools

The discussion proposes tools such as `get_architecture`, `get_component`, `get_component_source`, `get_dependencies`, `get_dependents`, `find_feature`, `get_source_range`, `get_affected_components`, `get_implementation_plan`, and `validate_architecture`. These names and schemas are illustrative until a versioned API/MCP ADR is accepted.

## Requirements

- Scope each request to an authorized repository/workspace.
- Validate external inputs and bound result count, depth, and source size.
- Return evidence, provenance, source revision, freshness, and uncertainty with claims.
- Use consistent errors for invalid input, missing data, stale source, and denied access.
- Do not allow an unreviewed inference to become architecture truth.
- Keep write-capable or code-modification tools out of the initial integration.

## Acceptance evidence

- Malformed requests fail with actionable, non-sensitive errors.
- Cross-repository access is denied and covered by tests when shared workspaces exist.
- Read responses are bounded and citations resolve.
- MCP unavailability does not impair the local UI/analyzer.

See [architecture overview](../ARCHITECTURE.md), [security and privacy](../SECURITY_PRIVACY.md), and [implementation plan phase 7](../IMPLEMENTATION_PLAN.md).
