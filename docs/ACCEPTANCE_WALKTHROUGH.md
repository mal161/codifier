# Acceptance walkthrough — React + Express shop

Phase 6 evidence that the local MVP works end to end on a separate, representative project, using the real local agent and real analyzed files. Nothing is pre-seeded or mocked.

## Setup

Requirements: Node 24, pnpm, Git, and `pnpm install --frozen-lockfile` at the repository root.

```bash
pnpm acceptance
```

Options: `-- --out <dir>` for the report directory, `-- --port <n>` if port 4196 is taken. The run takes about 30 seconds, prints each check, ends with `PASS: 41/41 checks` or `FAIL`, and writes `walkthrough-report.json` with every assertion and its observed value.

## What the run does

1. Copies [`fixtures/acceptance/react-express-shop`](../fixtures/acceptance/react-express-shop) to a temporary directory and makes it its own Git repository with one commit. The shop is a React + TypeScript client, an Express + TypeScript server, and a shared contracts package reached through a `@shared/*` path alias; its README states the intended architecture and one deliberate drift.
2. Starts the local agent on a throwaway database, bound to 127.0.0.1, with [`offline-guard.cjs`](../fixtures/acceptance/offline-guard.cjs) preloaded. The guard refuses and logs any connection or DNS lookup beyond loopback; a canary first proves it blocks `example.com`.
3. Drives the agent's HTTP API the way the clients do: durable analysis jobs, graph reads, source freshness, intended components, mappings, intended dependencies, and rule evaluation.
4. Uses the web client's own navigation modules (`source-lookup.ts`, `vscode.ts`) for source-to-architecture lookup and editor links.

Graphical clients are covered separately: the web explorer by `run-codifier` browser flows, and the VS Code extension by its Extension Host suite (ADR 0019).

## Assertions and captured outcome

Captured on 2026-11-02, Windows 11 x64, Node 24.14.1: **41/41 passed**, repeated in three consecutive runs.

| Step | Assertion | Observed |
|---|---|---|
| Offline guard canary | Guard refuses a non-loopback request and logs it | `blocked connection to example.com` |
| Register | The shop is its own Git repository with one commit | 40-character commit |
| Register | Agent listens on loopback only, with the offline guard loaded | `http://127.0.0.1:4196` |
| Clean analysis | Durable analysis job completes and persists | `completed` |
| Clean analysis | All 18 TypeScript/TSX source files are analyzed | 24 discovered, 18 supported and analyzed, 6 unsupported (JSON/Markdown) |
| Clean analysis | No failed or skipped files | 0 / 0 |
| Clean analysis | Reconciliation reports an initial analysis | `initial` |
| Clean analysis | Git context records the shop's commit on a clean tree | commit matches, `clean` |
| Explore | Every source file is a graph entity | 18 |
| Explore | Declared functions and components are symbols at their files | `createApp`, `healthCheck`, `requireUser`, `clearCart`, `addToCart`, `listProducts`, `formatPrice`, `App`, `ProductsPage`, `ProductCard`, `useCart` |
| Explore | Express routes are detected with method and path | `createApp.GET /health`, `GET /`, `GET /:id` (products), `GET /`, `POST /items`, `DELETE /` (cart) |
| Explore | `DELETE /` routes to its `clearCart` handler | `ROUTES_TO` edge present |
| Explore | Client imports through the `@shared/*` alias resolve | `ProductCard.tsx` → `shared/src/types.ts` |
| Explore | Server layering imports are recorded | routes → services → repositories |
| Explore | The drifting import is observed | `routes/cart.ts` → `db/cartRepository.ts` |
| Source → architecture | A location inside `clearCart` resolves to the `clearCart` symbol | `server/src/routes/cart.ts:22` → `clearCart` and its file |
| Architecture → source | Freshness reports the `createApp` location current | `current` |
| Architecture → source | The recorded range covers exactly the `createApp` declaration | starts `export function createApp() {`, ends `}` |
| Architecture → source | Editor link targets the same line and 1-based column, without the token | `vscode://file/<repo>/server/src/app.ts:6:1` |
| Intent | Every source file is mapped to exactly one intended component | 18 mappings, 6 components |
| Intent | Seven intended dependencies are recorded with developer evidence | 7 |
| Drift | Exactly one finding: the unplanned dependency | `unplanned-observed-dependency` |
| Drift | It names HTTP API depending on Persistence | message names both components |
| Drift | Its first source location is the `cartRepository` import | `server/src/routes/cart.ts:3` |
| Edit | The route now goes through the service layer | import removed |
| Edit | Saved locations in the edited file are stale before re-analysis | file and symbol `stale` |
| Edit | Locations in untouched files stay current | `current` |
| Incremental update | Re-analysis completes and persists | `completed` |
| Incremental update | Exactly the two edited files are reported as changed | `routes/cart.ts`, `services/cartService.ts` |
| Incremental update | Only the edited files are re-parsed | 2 parsed, 16 reused |
| Incremental update | Git context now reports uncommitted changes | `dirty`, same commit |
| Stable identity | Every observed entity present before and after keeps its UUID | 74 compared, 0 changed |
| Stable identity | The only new entity is the service's `clearCart` function | 1 added, 0 removed |
| Stable identity | Intended components, mappings, and dependencies survive re-analysis | all present |
| Stable identity | The edit added exactly one revision | +1 |
| Drift resolved | No findings remain after the fix | none |
| Drift resolved | The edited file's location is current again | `current` |
| No-op refresh | An unchanged tree reports no changes and parses nothing | `unchanged`, 0 parsed, 18 reused |
| No-op refresh | A no-op refresh adds no revision | +0 |
| Offline use | The agent attempted no network access beyond loopback | no attempts logged |
| Offline use | The token never appears in the agent log | absent |

## Found while authoring

The first run reported a second unplanned dependency, Persistence → Shared contracts: the repositories import the shared domain types, and the intended architecture had omitted that dependency. Codifier was right; the intent was corrected in the walkthrough and the shop's README. Route names nested inside a function are qualified by it (`createApp.GET /health`), matching how other nested declarations are named.

## Limits

- One fixture of 18 source files; not a performance or scale test.
- Verified locally on Windows. CI runs the walkthrough on Linux, macOS, and Windows on every push to `main` ([ADR 0020](decisions/0020-continuous-integration.md)); see the Actions tab for current results.
- The offline guard covers the agent process. Browser and VS Code clients only talk to the loopback agent, but their own network behavior is not guarded here.
- The walkthrough declares intended dependencies through the agent API. The web explorer offers the same action in its Intended architecture panel ("depends on" list with Add and Remove), verified by the `run-codifier` dependencies flow.
