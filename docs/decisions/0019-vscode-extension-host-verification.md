# 0019: Verify the VS Code extension in a real Extension Host with the installed VS Code

- Status: accepted
- Date: 2026-11-02

## Context

ADR 0012 deferred supported-version claims and VSIX release until Extension Host and packaging checks were run. Unit tests covered the agent adapter but not activation, command registration, SecretStorage, editor selection, or the packaged files. The usual harness (`@vscode/test-electron`) downloads a VS Code build and adds a dependency, which repository guidance asks to justify first.

## Decision

- `apps/vscode-extension/test/host/run.cjs` launches the VS Code already installed on the machine (`--vscode` or `VSCODE_EXECUTABLE` override) with `--extensionDevelopmentPath` and `--extensionTestsPath`, an isolated `--user-data-dir` and `--extensions-dir`, other extensions disabled, and a two-folder workspace copied from the React/Express fixture. It starts a real local agent on a throwaway database.
- `test/host/suite.cjs` runs inside the host and executes the real commands. Only modal UI (input boxes, quick picks, notifications) is replaced so it can be driven and recorded. It covers an unavailable agent, a rejected token that is not stored, connecting, status, lookup before analysis, durable-job analysis, current-file lookup, exact range opening (editor selection equals the recorded 0-based-column range), stale-source refusal without opening an editor, a mismatched workspace folder, and token absence from every message and quick pick.
- After the run, every file in the profile, workspace copies, and agent log is scanned for the token as UTF-8 and UTF-16LE, after a canary check proves the scanner detects it. Host output is checked too.
- `--extension-path` runs the same suite against an installed VSIX. Because each extension receives its own `vscode` API object, the runner places a temporary copy of the suite inside the installed extension for the run and removes it afterwards; the suite refuses to run from outside the extension under test, and the runner stops a host that exceeds 180 s.
- The suite is run with `pnpm --filter codifier-vscode test:host`. It is not part of `pnpm check` because it needs a VS Code installation and opens a window.

## Alternatives considered

- `@vscode/test-electron`: pins and downloads VS Code versions, useful for a version matrix, but adds a dependency and network access; reconsider when CI or multiple versions are required.
- Mocking the `vscode` module in unit tests: does not exercise activation, SecretStorage, or real editor selections.

## Consequences

- Verified locally on Windows 11 x64 with VS Code 1.144.0, from source and from the VSIX installed with `code --install-extension` into an isolated extensions directory. Since 2026-11-02, CI also runs the suite on Linux, macOS, and Windows against VS Code 1.90.0 (the manifest floor) and current stable, using official builds downloaded by `test/host/download-vscode.cjs`; all six combinations pass. On Linux the run uses a virtual display, the basic secret store (no keyring on the runner), and the build's Chromium sandbox helper configured as setuid root. Versions between 1.90.0 and stable are not individually tested.
- SecretStorage is observed to hold the token encrypted: no plaintext or UTF-16 copy appears in the profile.
- Runs open a visible VS Code window for about 30 seconds.
