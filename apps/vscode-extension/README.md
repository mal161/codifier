# Codifier VS Code extension

This extension is a client of the existing authenticated local agent. It does not scan repositories or create a second graph.

## Local development

1. Start the local agent from the repository root with `CODIFIER_AGENT_TOKEN` set, following the repository's `docs/DEVELOPMENT_SETUP.md` instructions.
2. Open the repository root in VS Code and press **F5** to launch **Run Codifier Extension Host** in an Extension Development Host.
3. Run **Codifier: Connect to Local Agent**, keep the loopback URL at `http://127.0.0.1:4141` unless the agent uses another loopback port, then enter the agent token. VS Code stores the token in `SecretStorage`; the extension never writes it to settings, output, or request URLs.
4. Run **Codifier: Analyze Workspace**. The extension uses the agent's durable analysis-job API and binds the returned repository ID to the chosen workspace folder. Each run writes coverage, persistence blockers, and diagnostics to the **Codifier** output channel. If the graph is not saved, the error names the blocking files, and **Show Details** opens the full report. An error that gives no reason usually means the agent process predates the current code; restart it.
5. Use **Codifier: Show Architecture for Current File** for source-to-graph lookup. Use **Codifier: Open Source from Architecture** to choose an observed graph item and open its exact range after checking source freshness.

The extension accepts only HTTP URLs on `localhost`, `127.0.0.1`, or `::1`. A workspace folder must match the folder previously analyzed before graph queries run. Authentication failures, unavailable agent, repository mismatch, stale source, and unresolved freshness are surfaced as user-visible messages. Tokens are sent only in the Authorization header.

## Extension Host tests

`pnpm --filter codifier-vscode test:host` runs the commands inside a real Extension Host of the VS Code installed on this machine, against a real local agent, in an isolated profile (it opens a VS Code window for about 30 seconds). It checks an unavailable agent, a rejected token, connecting, lookup, analysis, exact range opening, stale-source refusal, a mismatched workspace folder, and that the token appears in no message, profile file, workspace file, agent log, or host output. Pass `-- --extension-path <installed extension folder>` to test an installed VSIX, and `--vscode <Code executable>` or `VSCODE_EXECUTABLE` if VS Code is not in the default Windows location. See `docs/decisions/0019-vscode-extension-host-verification.md` in the repository.

## Packaging and supported versions

Build the VSIX from the repository root with `pnpm --filter codifier-vscode exec vsce package --no-dependencies --allow-missing-repository`, and install it with `code --install-extension apps/vscode-extension/codifier-vscode-0.1.0.vsix`.

Verified: VS Code 1.90.0 (the declared `engines.vscode` floor) and 1.144.0 (stable at the time) on Linux, macOS, and Windows, in CI on every push to `main`; locally on Windows 11 x64 with VS Code 1.144.0 from source and from the installed VSIX. Versions between 1.90.0 and 1.144.0 are not individually tested.

The extension has no added runtime package dependencies. Its agent adapter validates the bounded graph, job, and freshness fields it consumes and follows the same REST paths and request shapes as the local web client.
