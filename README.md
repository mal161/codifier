# Codifier

Codifier is an early-stage developer tool for understanding and navigating large codebases, including codebases produced with AI coding tools. It aims to connect architecture, implementation, dependencies, and evidence so developers can regain a reliable mental model of a system.

The repository now has an initial pnpm/Turborepo workspace, graph-domain/contracts packages, SQLite persistence, an authenticated local agent/CLI, and the first local web codebase explorer. Its TypeScript/JavaScript analyzer inventories bounded inputs, resolves relative imports, inherited TS path aliases, and local workspace package exports, and emits evidence-backed file/declaration graph facts with conservative identity reconciliation. It also records nested declarations and bounded, syntax-backed JSX, HTTP-route, and re-export relationships. The web client can analyze a local repository, load a saved graph, search files/symbols, explore a selected item's bounded relationship neighborhood in an interactive map or structured list, inspect evidence and source locations, and open recorded locations in VS Code. The VS Code extension and cloud synchronization are not implemented yet. See the accepted [agent/stack ADR](docs/decisions/0006-local-companion-agent.md) and [project structure](docs/PROJECT_STRUCTURE.md).

## Project documents

- [Product brief](docs/PRODUCT_BRIEF.md): problem, users, product principles, and initial scope.
- [Product requirements](docs/PRODUCT_REQUIREMENTS.md): candidate MVP behavior, acceptance evidence, quality requirements, and scope boundaries.
- [User flows](docs/USER_FLOWS.md): MVP navigation workflows and later interaction flows.
- [Architecture overview](docs/ARCHITECTURE.md): proposed system boundaries and architecture principles.
- [Project structure](docs/PROJECT_STRUCTURE.md): target monorepo layout, package ownership, dependency direction, and scaffold order.
- [End-to-end stack](docs/TECH_STACK.md): user-directed MVP stack, architecture boundaries, remaining validation, and later rollout.
- [Canonical graph](docs/CANONICAL_GRAPH.md): graph entities, relationships, evidence, identity, and invariants.
- [Analysis pipeline](docs/ANALYSIS_PIPELINE.md): repository-to-graph stages, incremental analysis, and diagnostics.
- [Security and privacy](docs/SECURITY_PRIVACY.md): local-first data boundaries and future shared-service constraints.
- [AI integration](docs/AI_INTEGRATION.md): optional provider boundary, evidence-grounded responses, and review controls.
- [Engine specifications](docs/engines/README.md): scope, status, boundaries, and acceptance evidence for each described engine/subsystem.
- [Pipeline specifications](docs/pipelines/README.md): repository analysis, AI context, MCP, drift, simulation, migration, validation, and recovery workflows.
- [Development setup](docs/DEVELOPMENT_SETUP.md): install, workspace checks, local agent usage, and remaining platform/security decisions.
- [Roadmap](docs/ROADMAP.md): staged delivery plan and items deliberately deferred.
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md): phased delivery, dependencies, and acceptance gates.
- [Decision register](docs/DECISION_REGISTER.md): accepted decisions, proposals, and open questions from the project brief.
- [Architecture decisions](docs/decisions/README.md): record of settled decisions and open questions.
- [Agent and contributor guidance](AGENTS.md): repository-wide working conventions.

## Current status

The first parser-backed analysis slice, initial project-aware import/identity support, React Flow relationship-neighborhood view, and read-only local web explorer with VS Code source links are implemented. Whole-repository graph layouts, broader TypeScript semantic analysis, incremental analysis, and the VS Code extension remain future milestones. See the [implementation plan](docs/IMPLEMENTATION_PLAN.md), [architecture decisions](docs/decisions/README.md), and [product requirements](docs/PRODUCT_REQUIREMENTS.md) for what remains open and deliberately deferred.

## Local agent quick start

Install the pinned dependencies with `pnpm install --frozen-lockfile`. In PowerShell, create a high-entropy token and start the agent:

```powershell
$env:CODIFIER_AGENT_TOKEN = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
pnpm --filter @codifier/local-agent start -- serve
```

The agent binds only to `127.0.0.1:4141` and creates its SQLite database in the current user's application-data directory by default. In a second terminal, set `CODIFIER_AGENT_TOKEN` to the same value and run `pnpm --filter @codifier/local-agent start -- health`. See [development setup](docs/DEVELOPMENT_SETUP.md) for graph import/export commands and workspace checks.

To analyze a local repository through the running agent, run `pnpm --filter @codifier/local-agent start -- analyze <repository-path>`. The command prints a repository UUID; pass that UUID as the second argument on later analyses to update the same graph.

To run the local web explorer, start the agent with the web origin explicitly allowed, then start Vite in another PowerShell terminal:

```powershell
$env:CODIFIER_AGENT_TOKEN = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$env:CODIFIER_AGENT_ALLOWED_ORIGINS = "http://127.0.0.1:5173"
pnpm --filter @codifier/local-agent start -- serve
```

In a second terminal:

```powershell
pnpm --filter @codifier/local-web dev
```

Open `http://127.0.0.1:5173`, paste the same token into the page, connect, then enter a local repository path and analyze it. The token stays in page memory only. Analysis reports progress and can be cancelled without replacing the last saved graph. Use the optional repository UUID to refresh or load a previously saved graph. See [development setup](docs/DEVELOPMENT_SETUP.md) for more detail.
