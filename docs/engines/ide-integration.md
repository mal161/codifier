# IDE Integration

## Status

**Initial implementation.** `apps/vscode-extension` is a command-based client of the standalone local agent; it does not own repository analysis or graph persistence. A local VSIX has been packaged with `vsce`; Extension Host workflow, installation, and cross-platform verification remain pending. Additional IDEs are later capabilities.

## Purpose

Expose repository mapping and source navigation where developers work without coupling the analyzer or graph model to one editor.

## Implemented capabilities

- Connect to the loopback agent with a token stored in VS Code SecretStorage.
- Analyze the selected workspace through the durable analysis-job API and report progress.
- Look up graph items and intended-component mappings for the active source file.
- Choose an actual graph item and navigate to its exact range after a source-freshness check.

Optional AI context and future MCP integration remain unimplemented and require their own approved boundaries.

## Boundary

The IDE extension is a client surface. Repository inventory, analysis, graph semantics, SQLite persistence, and synchronization are owned by the agent and exposed through authenticated, versioned interfaces. The extension owns editor integration and presentation only.

## Requirements

- Do not make the editor unresponsive on large repositories.
- Respect workspace trust and repository safety boundaries.
- Avoid transmitting source without the approved AI consent flow.
- Provide accessible keyboard navigation and actionable errors.
- Keep extension state separate from authoritative graph data; the local agent owns durable graph state.

## Remaining validation

Run the Extension Development Host workflow on supported operating systems and verify authentication and failure states before claiming a tested editor version range. VSIX creation is available with `pnpm --filter codifier-vscode exec vsce package --no-dependencies --allow-missing-repository`; installation still needs verification.

See [development setup](../DEVELOPMENT_SETUP.md), [user flows](../USER_FLOWS.md), and [analysis pipeline](../ANALYSIS_PIPELINE.md).
