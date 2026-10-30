# Codebase Intelligence

## Status

**Approved direction; MVP foundation.** The discussion approves static-first analysis, progressive structural/semantic/architectural analysis, Tree-sitter syntax analysis, language-specific semantic adapters, and a common IR. The user-directed first target is TypeScript/JavaScript, prioritizing React and Express; exact construct/framework coverage remains to be validated.

## Purpose

Turn a developer-selected repository into a partial, explainable, revision-aware model of files, symbols, dependencies, and candidate architecture groupings.

## Responsibilities

- Discover files, languages, projects/packages, configuration, and likely entry points within an explicit safety boundary.
- Parse supported languages and extract symbols and source ranges.
- Resolve cross-file symbols and relationships only where language tooling supports them.
- Identify direct dependencies and candidate higher-level groupings.
- Report unsupported files, parse errors, coverage, and uncertainty.
- Incrementally update graph facts after repository changes.

## Analysis levels

1. **Structural:** repository/files/packages, declarations, imports/exports, basic dependencies.
2. **Semantic:** cross-file symbol resolution, calls, types, inheritance, framework-specific relationships where supported.
3. **Architectural:** candidate components, boundaries, patterns, data flows, and possible rule violations.

Implement progressively. Architecture groupings remain inferred until reviewed or confirmed. Static, semantic, runtime, test, and AI evidence must not be conflated.

## Inputs and outputs

**Input:** selected local repository, revision/configuration, and the repository policy selected for the release.

**Output:** versioned IR, graph updates, source locators, coverage and diagnostics, plus an actionable analysis summary.

## Safety and quality rules

- Read source; do not execute analyzed code, scripts, builds, or tests during indexing.
- Bound file and parser work and enforce repository/symlink boundaries.
- Preserve useful partial results; errors in one file do not erase other valid analysis.
- Never invent a resolved relationship when static analysis cannot establish it.
- Compare incremental results with clean full analysis in tests.

## Acceptance evidence

- Golden repositories verify symbols, relationships, exact source ranges, and supported coverage.
- Malformed and unsupported files are visible and do not suppress valid results.
- Incremental re-analysis preserves unrelated identities and reports stale mappings.
- Analysis stays local unless a separately approved AI flow is invoked.

## Implementation reference

The detailed stages, IR boundary, incremental behavior, and fixtures are in the [analysis pipeline](../ANALYSIS_PIPELINE.md). Graph contracts are in the [canonical graph](../CANONICAL_GRAPH.md).
