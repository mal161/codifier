# Codifier

Codifier helps you understand a codebase as a whole. It reads a TypeScript or JavaScript repository on your machine and builds a map of its files, declarations and dependencies. You can browse that map, jump from any part of it to the exact source lines, sketch the architecture you *intend* the code to have, and review where the real code differs.

Everything runs locally. Your source code is read by a small agent on your own machine and is never sent to an external service.

> **Status: early development.** Analysis supports TypeScript and JavaScript only. Development and testing so far have been on Windows; other platforms are not yet verified. Expect rough edges, and see [Limitations](#limitations).

## How it fits together

```text
             ┌──────────────────────────────┐
  Web        │                              │   reads your repository
  explorer ─▶│      Codifier local agent    │──▶ (TypeScript / JavaScript)
             │  analysis · graph · SQLite   │
  VS Code  ─▶│   127.0.0.1:4141, token auth │──▶ saves the map locally
  extension  │                              │
             └──────────────────────────────┘
  CLI ──────────────────▲
```

The **local agent** does all the work: it analyzes repositories, stores the resulting graph in a local SQLite database, and answers requests. The **web explorer**, the **VS Code extension** and the **CLI** are three ways of using the same agent. They share one graph, so a repository analyzed from VS Code can be explored in the browser, and vice versa.

The agent listens only on your own machine (`127.0.0.1`) and requires a secret token on every request.

## Features

### Repository analysis
- Finds the `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`, `.mjs` and `.cjs` files in a repository and records each file and its declarations (functions, classes, variables and so on).
- Resolves imports between them: relative paths, `tsconfig.json` path aliases (including per-project configs in a monorepo), and packages that live inside the same repository.
- Honors `.gitignore` files and lets you add your own exclusion patterns. Dependency and build folders such as `node_modules` and `dist` are always skipped, and symbolic links are never followed.
- Shows live progress, and can be cancelled.
- **Never overwrites a good map with a partial one.** If a file can't be read or parsed, the previous map is kept and you're told which files blocked the save and why.
- Re-analysis keeps stable identities for unchanged files and symbols, and recognizes files that were moved, so links and mappings survive refactoring.
- Every fact in the map links to its evidence: the file, line range and content hash it came from.

### Web explorer
- **Browse** a searchable list of every file and symbol, or switch to an interactive **map** of the selected item and its direct relationships.
- **Find source in map**: enter `path:line` (for example `src/app.ts:42`) to see which graph items cover that location.
- **Open in VS Code** at the exact recorded lines, after checking that the file hasn't changed since analysis.
- See coverage, diagnostics, the evidence behind each item, the files added, changed or removed since the last analysis, and the repository's Git branch and commit.

### Intended architecture and review
- **Describe the architecture you intend**: create components (such as "API layer" or "Data access") and the dependencies you expect between them.
- **Map real code to components**. Mappings are explicit and reversible, and they survive re-analysis.
- **Start from a template**: a built-in catalogue of common architecture templates that you can add to a saved map as intended components.
- **Review rules** that check the map: import cycles, code mapped to more than one component, components with no code, and observed imports that don't match the dependencies you intended. Findings are review prompts with supporting evidence, not automatic changes.

### VS Code extension
- Analyze the open workspace with progress and cancellation.
- **Show Architecture for Current File**: see where the file you're editing sits in the map.
- **Open Source from Architecture**: pick any item in the map and jump to its exact lines, after a freshness check.
- Your agent token is stored in VS Code's secure storage, never in settings or logs.

### History
- Every successful analysis is saved as a new revision; earlier revisions are kept. You can list, view, and restore them from the web explorer or the agent's API, and export the whole history as JSON (`graph history <repository-uuid>`). Restoring adds a new revision rather than deleting history.

## Requirements

- **Node.js 24** and **pnpm 12** (the exact pnpm version is pinned in `package.json`; `corepack enable` installs it for you).
- **VS Code 1.90 or later**, only if you want the extension.
- A TypeScript or JavaScript repository to analyze.

## Quick start

### 1. Install

```powershell
git clone <this repository>
cd codifier
pnpm install --frozen-lockfile
```

### 2. Start the local agent

The agent needs a random token of at least 32 bytes. Create one and start the agent in a terminal you keep open:

```powershell
# PowerShell
$env:CODIFIER_AGENT_TOKEN = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$env:CODIFIER_AGENT_ALLOWED_ORIGINS = "http://127.0.0.1:5173"   # only needed for the web explorer
pnpm --filter @codifier/local-agent start -- serve
```

```bash
# bash / zsh (not yet verified on macOS or Linux)
export CODIFIER_AGENT_TOKEN="$(openssl rand -base64 32)"
export CODIFIER_AGENT_ALLOWED_ORIGINS="http://127.0.0.1:5173"
pnpm --filter @codifier/local-agent start -- serve
```

Print the token with `echo $env:CODIFIER_AGENT_TOKEN` (PowerShell) or `echo "$CODIFIER_AGENT_TOKEN"` (bash), because each client needs it. Keep it private.

The agent listens on `127.0.0.1:4141` and saves its database in your user application-data folder (`%LOCALAPPDATA%\Codifier\codifier.sqlite` on Windows). Use `serve --port <port>` or `serve --database <path>` to change either.

> **Tip while developing Codifier itself:** the agent only loads its code when it starts. After pulling or editing code, restart it, or run it with `pnpm --filter @codifier/local-agent exec tsx watch src/cli.ts serve` so it reloads automatically.

### 3. Pick a client

Use any of the three below; they all talk to the agent you just started.

## Using the web explorer

1. Start the agent with `CODIFIER_AGENT_ALLOWED_ORIGINS` set, as in step 2.
2. In a second terminal, run `pnpm --filter @codifier/local-web dev`.
3. Open <http://127.0.0.1:5173>, paste the agent token, and click connect. The page keeps the token in memory only, so you'll paste it again after a reload.
4. Enter the full path of a repository on your machine and analyze it. When it finishes, the **Saved repository UUID** field is filled in. Note that ID down: entering it next time loads the saved map, or refreshes it with a new analysis.
5. Explore: search the **Browse** list, open the **map**, use **Find source in map**, and add intended components, templates and mappings. Review the **rules** findings.

## Using the VS Code extension

**Install it**, choosing one of these:
- **As a normal extension:** run `code --install-extension apps/vscode-extension/codifier-vscode-0.1.0.vsix`, then reload VS Code. To build a fresh package after changing the extension, run `pnpm --filter codifier-vscode exec vsce package --no-dependencies --allow-missing-repository` first.
- **For extension development:** open this repository in VS Code and press **F5** (**Run Codifier Extension Host**). Use the new **[Extension Development Host]** window.

**Use it** from the Command Palette (Ctrl+Shift+P):

| Command | What it does |
|---|---|
| **Codifier: Connect to Local Agent** | Asks for the agent token and checks the connection. The agent address comes from the `codifier.agentUrl` setting (default `http://127.0.0.1:4141`) |
| **Codifier: Show Connection Status** | Shows whether the agent is reachable; also opened by clicking **Codifier** in the status bar |
| **Codifier: Analyze Workspace** | Analyzes the open folder and links it to its saved map |
| **Codifier: Show Architecture for Current File** | Shows the graph items for the file you're editing |
| **Codifier: Open Source from Architecture** | Lets you pick a graph item and opens its exact lines |

Each analysis writes a full report (coverage, anything that blocked the save, and all diagnostics) to the **Codifier** output panel. See the [extension guide](apps/vscode-extension/README.md) for details.

## Using the CLI

Run these from the repository root in a terminal where `CODIFIER_AGENT_TOKEN` is set to the agent's token:

| Command | What it does |
|---|---|
| `pnpm --filter @codifier/local-agent start -- health` | Checks that the agent is running |
| `pnpm --filter @codifier/local-agent start -- analyze <repo-path>` | Analyzes a repository and prints its UUID and results |
| `pnpm --filter @codifier/local-agent start -- analyze <repo-path> <uuid>` | Re-analyzes a repository into its existing map |
| `pnpm --filter @codifier/local-agent start -- graph get <uuid>` | Prints the saved map as JSON |
| `pnpm --filter @codifier/local-agent start -- graph put <file.json>` | Validates and replaces a saved map from a JSON file |

Set `CODIFIER_AGENT_URL` if the agent isn't on the default `http://127.0.0.1:4141`. The REST API that clients use is described in [development setup](docs/DEVELOPMENT_SETUP.md).

## Troubleshooting

| Problem | What to do |
|---|---|
| **"Analysis was incomplete; the saved graph was left unchanged"** | Some files couldn't be analyzed, so the previous map was kept. The message names the files and reasons (for example a syntax error, or a file over the 1 MiB limit). In VS Code, click **Show Details**. Fix or exclude those files and analyze again. |
| **The same message, but with no reason given** | The agent is running older code than the client. Restart the agent. |
| **The token is rejected** | The client's token doesn't match the one the running agent was started with. Reconnect with the current token (in VS Code: **Codifier: Connect to Local Agent**). |
| **The web page can't reach the agent** | Start the agent with `CODIFIER_AGENT_ALLOWED_ORIGINS="http://127.0.0.1:5173"`. |
| **"Repository not found"** | No map has been saved for that UUID or folder yet. Analyze it first. |
| **VS Code still behaves like an old version** | Reload the window (**Developer: Reload Window**), or restart the F5 debug session. |

## Limitations

- **TypeScript and JavaScript only.** Analysis is syntax-level plus import resolution; it doesn't yet resolve types or calls across the project.
- **Limits per analysis:** 10,000 files, 1 MiB per file and 100 MiB in total. Larger inputs are reported rather than silently dropped.
- **Re-analysis is full,** not incremental: unchanged files are re-read each time.
- **Single machine.** There is no cloud sync, sharing or multi-user support.
- **Not yet verified:** macOS and Linux, and VS Code versions other than the one used in development.
- AI features described in the planning documents are not implemented.

## Developing Codifier

```powershell
pnpm check          # lint, type-check and tests for every package
pnpm format:check   # formatting
```

The repository is a pnpm/Turborepo workspace:

| Path | Purpose |
|---|---|
| `apps/local-agent` | The agent and CLI (Fastify REST API) |
| `apps/local-web` | The web explorer (React + Vite) |
| `apps/vscode-extension` | The VS Code extension |
| `packages/analysis-core` | Repository inventory and TypeScript/JavaScript analysis |
| `packages/domain` | The graph model and its integrity checks |
| `packages/contracts` | Request and response schemas shared by the agent and clients |
| `packages/storage` | SQLite persistence and revision history |
| `fixtures/` | Sample repositories used in tests |

Read [AGENTS.md](AGENTS.md) before contributing; it sets out the working conventions. [Development setup](docs/DEVELOPMENT_SETUP.md) covers the full agent options, API endpoints and open platform decisions.

## Documentation

**Start here**
- [Product brief](docs/PRODUCT_BRIEF.md): the problem, users and principles.
- [User flows](docs/USER_FLOWS.md): the main workflows.
- [Development setup](docs/DEVELOPMENT_SETUP.md): installation, agent options and the API.
- [VS Code extension guide](apps/vscode-extension/README.md).

**How it works**
- [Architecture overview](docs/ARCHITECTURE.md) and [project structure](docs/PROJECT_STRUCTURE.md).
- [Canonical graph](docs/CANONICAL_GRAPH.md): entities, relationships, evidence and identity.
- [Analysis pipeline](docs/ANALYSIS_PIPELINE.md): how a repository becomes a graph.
- [Security and privacy](docs/SECURITY_PRIVACY.md): local data boundaries.
- [End-to-end stack](docs/TECH_STACK.md).

**Plans and decisions**
- [Product requirements](docs/PRODUCT_REQUIREMENTS.md), [roadmap](docs/ROADMAP.md), [implementation plan](docs/IMPLEMENTATION_PLAN.md) and [remaining MVP phases](docs/REMAINING_FEATURES_PHASES.md).
- [Decision register](docs/DECISION_REGISTER.md) and [architecture decision records](docs/decisions/README.md).
- [AI integration](docs/AI_INTEGRATION.md), [engine specifications](docs/engines/README.md) and [pipeline specifications](docs/pipelines/README.md): planned, mostly not yet implemented.

## License

MIT. See [LICENSE](LICENSE).
