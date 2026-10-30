# IDE Integration

## Status

**MVP client surface.** The VS Code extension is one client of the standalone local agent; it does not own repository analysis or graph persistence. Additional IDEs are later capabilities.

## Purpose

Expose repository mapping and source navigation where developers work without coupling the analyzer or graph model to one editor.

## Candidate capabilities

- Analyze the currently opened repository.
- Browse architecture, codebase map, dependencies, features, and later drift/impact views.
- Navigate from architecture entities to exact file and source range.
- Identify the architecture context of a selected source symbol or range.
- Refresh analysis after edits and show progress/diagnostics.
- Invoke optional AI context and future MCP integration only through approved boundaries.

## Boundary

The IDE extension is a client surface. Repository inventory, analysis, graph semantics, SQLite persistence, and synchronization are owned by the agent and exposed through authenticated, versioned interfaces. The extension owns editor integration and presentation only.

## Requirements

- Do not make the editor unresponsive on large repositories.
- Respect workspace trust and repository safety boundaries.
- Avoid transmitting source without the approved AI consent flow.
- Provide accessible keyboard navigation and actionable errors.
- Keep extension state separate from authoritative graph data; the local agent owns durable graph state.

## Decision gate

Validate supported editor/runtime, packaging, lifecycle management, and secure local-client pairing before creating the extension scaffold.

See [development setup](../DEVELOPMENT_SETUP.md), [user flows](../USER_FLOWS.md), and [analysis pipeline](../ANALYSIS_PIPELINE.md).
