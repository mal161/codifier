# 0012: Initial VS Code extension client

- Status: accepted
- Date: 2026-10-31

## Context

The VS Code client needs repository graph lookup and exact navigation while preserving the local agent as the only repository scanner and graph owner. The user supplies the agent token when connecting. The first slice should avoid an extra runtime framework or another source parser.

## Decision

- Implement a small VS Code Extension API client in `apps/vscode-extension` using built-in commands, workspace APIs, SecretStorage, and Node's fetch support.
- Restrict agent URLs to HTTP loopback hosts. Store the token only in VS Code SecretStorage; put no credentials in settings, URLs, output, or logs.
- Bind the analyzed repository ID to the selected workspace path and reject graph lookups from a different workspace until it is analyzed.
- Reuse the local agent's existing analysis-job, graph, and source-freshness endpoints. Validate the bounded response shapes consumed by the extension and never scan repository files in the extension.
- Require a current source-freshness response before opening a graph locator at its exact recorded range.
- Defer supported-version claims and VSIX release until manual Extension Host and packaging checks have been completed.

## Alternatives considered

- Add a separate VS Code analyzer: rejected because it would duplicate repository access, graph identity, and evidence generation.
- Persist the token in ordinary extension settings: rejected because settings are not secret storage.
- Add a webview and duplicate the local-web application: deferred because commands and Quick Picks support the initial lookup/navigation workflow with less code and no bundled web runtime.
- Add runtime dependencies or a bundler before the host/package spike: deferred until packaging demonstrates that the current built-in API approach is insufficient.

## Consequences

- The user must connect explicitly and analyze a workspace before graph navigation.
- The initial UI uses commands and Quick Picks; it does not provide a persistent graph tree or editor decorations.
- The manifest declares an API floor for compatibility intent, but tested supported versions remain unclaimed until host verification.
