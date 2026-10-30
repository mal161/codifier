# 0003: Use static-first analysis with a versioned intermediate representation

- Status: accepted
- Decision date: Not stated in the source discussion

## Context

Codifier must build useful codebase structure without executing repositories or depending on runtime instrumentation. Multiple language parsers need to feed a shared graph without coupling language-specific details to graph storage or the UI.

## Decision

Use static analysis as the initial source of implementation facts. Use Tree-sitter for syntax analysis, language-specific semantic adapters for deeper resolution, and a versioned common intermediate representation (IR) before graph ingestion. Runtime instrumentation is a later capability and must be treated as a separate evidence source.

This decision selects an analysis approach; it does not select the application's programming language, first supported source languages, parser bindings, or runtime framework.

## Alternatives considered

- Runtime-first tracing as the primary analysis mechanism.
- Directly coupling each parser to graph persistence.
- Treating syntax parsing alone as complete semantic resolution.

The source discussion did not document a full comparison of these alternatives.

## Consequences

- Unsupported and unresolved relationships must remain visible as such.
- Parser output, semantic resolution, graph ingestion, and UI need explicit boundaries.
- Repository analysis must not execute source code.
- Language support must be claimed only when fixtures and source-location tests establish its coverage.
- See the [analysis pipeline](../ANALYSIS_PIPELINE.md), [architecture overview](../ARCHITECTURE.md), and [decision register D-007/D-009](../DECISION_REGISTER.md).
