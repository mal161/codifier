---
name: run-codifier
description: Run, start, and drive Codifier - the local agent plus the local-web explorer - and take screenshots of the web UI. Use when asked to run Codifier, start the agent or web explorer, check a web UI change in a browser, screenshot the explorer, smoke-test the agent API, or run the workspace checks.
---

Codifier is a local agent (Fastify + SQLite, `apps/local-agent`) plus a React/Vite explorer (`apps/local-web`) that talks to it. Drive both with `.claude/skills/run-codifier/driver.mjs`: it starts the agent on a throwaway database and the Vite dev server, seeds a graph from a golden fixture, drives the explorer in a real browser through Playwright, saves screenshots, and stops everything it started.

All paths are relative to the repository root. Verified on Windows 11 (Git Bash, Node 24, pnpm 12) with the system Microsoft Edge. Linux has not been verified; there, set `BROWSER_CHANNEL=chromium` and install a Playwright Chromium.

## Prerequisites

Node `>=24 <25` and pnpm (see root `package.json`). Playwright is **not** a project dependency, so install `playwright-core` outside the repository, once:

```bash
mkdir -p "$TEMP/codifier-pw" && cd "$TEMP/codifier-pw" && npm init -y >/dev/null && npm i playwright-core@1.49.1 --no-audit --no-fund
```

On Windows it drives the preinstalled Edge (`channel: "msedge"`), so no browser download is needed.

## Setup

```bash
pnpm install --frozen-lockfile
```

No build step: the agent runs through `tsx`, and the web app through Vite.

## Run (agent path)

```bash
PLAYWRIGHT_CORE_DIR="$TEMP/codifier-pw" node .claude/skills/run-codifier/driver.mjs --out "$TEMP/codifier-run"
```

It prints one line per step and ends with `PASS - screenshots in <dir>` (exit 0) or `FAIL - <reason>` (exit 1, plus `error.png`). The steps:

1. Starts the agent on `127.0.0.1:4198`, with `CODIFIER_AGENT_ALLOWED_ORIGINS=http://127.0.0.1:5173` and a random token, then starts Vite on `127.0.0.1:5173`.
2. Seeds the graph through the API: `POST /v1/analyze` on `fixtures/golden-repositories/react-express-workspace`, then adds one intended component, giving 2 revisions.
3. In the browser it connects, loads the saved graph, opens **Graph revisions**, restores revision 1 with the confirm step, and exports the history.
4. Writes `1-loaded.png`, `2-confirm.png`, `3-restored.png` and the exported `codifier-history-<uuid>.json` to `--out`.
5. Fails if the page logs any console error.

| option / env | effect |
|---|---|
| `--out <dir>` | artifact directory (default: a new temp dir) |
| `--agent-port <n>` | agent port (default 4198; avoids a developer agent on 4141) |
| `--keep` | after PASS, leave both servers running and print the token and repository UUID; Ctrl+C stops them |
| `HEADED=1` | show the browser window |
| `BROWSER_CHANNEL` | Playwright channel; default `msedge` on Windows, else `chromium` |

To check a different UI change, copy `driveHistoryFlow` and swap in the new steps. Keep the launch, seed and stop functions as they are. Look at the screenshots; a PASS only proves the asserted text appeared.

To smoke-test the agent API without a browser, start it by hand and use the CLI (it reads `CODIFIER_AGENT_URL` and `CODIFIER_AGENT_TOKEN`):

```bash
export CODIFIER_AGENT_TOKEN=$(node -e 'console.log(require("crypto").randomBytes(32).toString("base64url"))') CODIFIER_AGENT_URL=http://127.0.0.1:4198
pnpm --filter @codifier/local-agent start -- serve --database "$TEMP/codifier-smoke.sqlite" --port 4198 > "$TEMP/codifier-smoke.log" 2>&1 &
timeout 40 bash -c 'until grep -aq "Server listening" "$TEMP/codifier-smoke.log"; do sleep 1; done'
pnpm --silent --filter @codifier/local-agent start -- health
pnpm --silent --filter @codifier/local-agent start -- analyze "$PWD/fixtures/golden-repositories/react-express-workspace"   # prints "repositoryId"
pnpm --silent --filter @codifier/local-agent start -- graph history <repository-uuid> > "$TEMP/history.json"
# Stop: kill the node server by the pid in its own log (killing the pnpm job alone leaves node running).
taskkill //PID $(grep -ao '"pid":[0-9]*' "$TEMP/codifier-smoke.log" | head -1 | cut -d: -f2) //T //F
```

## Run (human path)

Run the agent with `CODIFIER_AGENT_ALLOWED_ORIGINS=http://127.0.0.1:5173` and `pnpm --filter @codifier/local-agent start -- serve`, then `pnpm --filter @codifier/local-web dev` in a second terminal. Open `http://127.0.0.1:5173` and paste the token. Ctrl+C stops each one. The root `README.md` has the PowerShell variant.

## Test

```bash
pnpm check
```

This runs lint, typecheck and test through Turbo: 21 tasks across 7 packages, all passing. One analysis-core symlink test skips itself when Windows refuses to create symlinks (EPERM). pnpm may print `Could not lock the dependency install ... Access is denied` or `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK` while an agent or Vite process is running. The tasks still succeed.

## Gotchas

- **Port 4141 is often the developer's own agent.** `serve` then fails with `EADDRINUSE`, and the browser talks to their agent and gets CORS or `origin_not_allowed` errors. The driver uses 4198 and types that address into the page's **Agent address** field. The page defaults to `:4141`.
- **Stale agents survive "kills".** Stopping the `pnpm` wrapper leaves the `tsx`/`node` child serving old code. On this machine, `Get-NetTCPConnection` and `netstat` port lookups did not report those processes. Kill by PID tree instead: `taskkill //PID <pid> //T //F`, where the pid comes from the agent's JSON log (`"pid":N`). Or find it by command line with `Get-CimInstance Win32_Process | ? CommandLine -match '<db path or vite>'`. The driver does this for you, including on crash.
- **A stale agent looks like a missing feature:** new routes return `Route POST:... not found` (404). Check the `pid` in the agent log before debugging the code.
- **Restoring a revision identical to the current graph is a no-op.** It shows "Revision N already matches the current graph; nothing changed", not "Restored ...". Pick a revision that differs; the driver restores revision 1 after adding a component.
- **`pnpm start -- <cmd> --opt`** works only from commit `1734b0d` on. Older CLIs read the forwarded `--` as the end of options.
- **Playwright `TargetClosedError` after a blob download.** playwright-core 1.49 leaves an internal navigation promise pending and rejects it on close, which crashes the process before any cleanup. The driver navigates to `about:blank` after the download and ignores only that error.
- **Git context reads "Uncommitted changes"** whenever this repository's working tree is dirty, because the fixture lives inside it. That is expected.

## Troubleshooting

- **`error: too many arguments for 'serve'. Expected 0 arguments but got 4`**: the CLI predates the `--` fix. Update, or drop the `--`.
- **`codifier: listen EADDRINUSE: address already in use 127.0.0.1:<port>`**: another agent holds the port (see Gotchas). Pass `--agent-port`, or stop it by PID tree.
- **Browser console: `blocked by CORS policy ... No 'Access-Control-Allow-Origin' header`**, or a preflight `403 {"error":"origin_not_allowed"}`: the agent was started without `CODIFIER_AGENT_ALLOWED_ORIGINS=http://127.0.0.1:5173`, or a different agent answered.
- **`Something already answers on http://127.0.0.1:5173`** (from the driver): a Vite server is still running; it uses `strictPort`. Stop it by PID tree.
- **`playwright-core not found`**: set `PLAYWRIGHT_CORE_DIR` to the directory where you ran `npm i playwright-core`.
