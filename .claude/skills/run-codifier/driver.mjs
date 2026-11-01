#!/usr/bin/env node
// Launches the Codifier local agent (throwaway SQLite DB) and the local-web
// Vite dev server, seeds a graph with two revisions from a golden fixture,
// drives the web explorer in a real browser, and stops every process it
// started. Agent tooling, not product code.
//
// Usage (from the repository root):
//   PLAYWRIGHT_CORE_DIR=<dir with node_modules/playwright-core> \
//     node .claude/skills/run-codifier/driver.mjs [--out <dir>] [--agent-port 4198] [--keep]
//
// Env:
//   PLAYWRIGHT_CORE_DIR  required unless playwright-core resolves from here
//   BROWSER_CHANNEL      default "msedge" on Windows, "chromium" elsewhere
//   HEADED=1             show the browser window

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const keep = args.includes("--keep");
const agentPort = Number(flag("--agent-port", "4198"));
const out = resolve(
  flag("--out", mkdtempSync(join(tmpdir(), "codifier-run-"))),
);
mkdirSync(out, { recursive: true });
const isWindows = process.platform === "win32";
const agentUrl = `http://127.0.0.1:${agentPort}`;
const webUrl = "http://127.0.0.1:5173";
const token = randomBytes(32).toString("base64url");
const fixture = join(
  repoRoot,
  "fixtures/golden-repositories/react-express-workspace",
);
const children = [];
const log = (message) => console.log(`- ${message}`);

function loadPlaywright() {
  const bases = [process.env.PLAYWRIGHT_CORE_DIR, repoRoot].filter(Boolean);
  for (const base of bases) {
    try {
      return createRequire(join(resolve(base), "noop.js"))("playwright-core");
    } catch {
      // try the next base
    }
  }
  throw new Error(
    "playwright-core not found. Install it outside the repo (see SKILL.md) and set PLAYWRIGHT_CORE_DIR.",
  );
}

function start(name, command, extraEnv) {
  const child = spawn(command, {
    cwd: repoRoot,
    env: { ...process.env, ...extraEnv },
    shell: true,
    detached: !isWindows,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const record = { name, child, output: () => output };
  children.push(record);
  return record;
}

function stopAll() {
  for (const { child } of children.splice(0)) {
    if (child.exitCode !== null) continue;
    // pnpm -> tsx/vite -> node: kill the whole tree, not just the wrapper.
    if (isWindows) {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } else {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // already gone
      }
    }
  }
}

async function waitFor(description, check, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function isServing(url) {
  try {
    await fetch(url);
    return true;
  } catch {
    return false;
  }
}

async function api(path, init = {}) {
  const response = await fetch(`${agentUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${path} -> ${response.status}: ${body}`);
  return body ? JSON.parse(body) : null;
}

async function launchServers() {
  if (await isServing(agentUrl)) {
    throw new Error(
      `Something already answers on ${agentUrl}. Stop it or pass --agent-port <free port>.`,
    );
  }
  if (await isServing(webUrl)) {
    throw new Error(
      `Something already answers on ${webUrl} (Vite uses strictPort). Stop it first.`,
    );
  }
  const database = join(
    mkdtempSync(join(tmpdir(), "codifier-db-")),
    "graph.sqlite",
  );
  const agent = start(
    "agent",
    `pnpm --filter @codifier/local-agent start -- serve --database "${database}" --port ${agentPort}`,
    { CODIFIER_AGENT_TOKEN: token, CODIFIER_AGENT_ALLOWED_ORIGINS: webUrl },
  );
  await waitFor("the agent to listen", () => {
    if (/EADDRINUSE/.test(agent.output())) {
      throw new Error(`Agent port ${agentPort} is in use:\n${agent.output()}`);
    }
    if (agent.child.exitCode !== null)
      throw new Error(`Agent exited:\n${agent.output()}`);
    return /Server listening at/.test(agent.output());
  });
  log(`agent listening at ${agentUrl} (database ${database})`);

  const web = start("web", "pnpm --filter @codifier/local-web dev");
  await waitFor("Vite to serve", async () => {
    if (web.child.exitCode !== null)
      throw new Error(`Vite exited:\n${web.output()}`);
    return isServing(webUrl);
  });
  log(`vite serving ${webUrl}`);
}

async function seedGraph() {
  const analysis = await api("/v1/analyze", {
    method: "POST",
    body: JSON.stringify({ rootPath: fixture }),
  });
  await api(`/v1/repositories/${analysis.repositoryId}/intended-components`, {
    method: "POST",
    body: JSON.stringify({ name: "Driver component" }),
  });
  const { revisions } = await api(
    `/v1/repositories/${analysis.repositoryId}/revisions`,
  );
  log(
    `seeded repository ${analysis.repositoryId} with ${revisions.length} revisions`,
  );
  return analysis.repositoryId;
}

async function driveHistoryFlow(repositoryId) {
  const { chromium } = loadPlaywright();
  const channel =
    process.env.BROWSER_CHANNEL ?? (isWindows ? "msedge" : "chromium");
  const browser = await chromium.launch({
    ...(channel === "chromium" ? {} : { channel }),
    headless: process.env.HEADED !== "1",
  });
  const consoleErrors = [];
  try {
    const context = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    page.on(
      "console",
      (m) => m.type() === "error" && consoleErrors.push(m.text()),
    );
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
    const shot = (name) =>
      page.screenshot({ path: join(out, `${name}.png`), fullPage: true });

    try {
      await page.goto(webUrl);
      // The page defaults to :4141; point it at this run's agent.
      await page.fill("#agent-url", agentUrl);
      await page.fill("#agent-token", token);
      await page.getByRole("button", { name: "Connect to agent" }).click();
      await page.getByText("Connected to the local agent.").waitFor();
      await page.fill("#repository-id", repositoryId);
      await page.getByRole("button", { name: "Load saved" }).click();
      await page
        .getByText("Saved graph loaded from the local agent.")
        .waitFor();
      log("connected and loaded the saved graph");
      await shot("1-loaded");

      const panel = page.getByRole("region", { name: "Revision history" });
      await panel
        .getByRole("button", { name: "Show revision history" })
        .click();
      await panel.getByText("Revision 1", { exact: true }).waitFor();
      const before = await panel.locator("li").count();
      log(`history lists ${before} revisions`);

      const revisionOne = panel
        .locator("li")
        .filter({ has: page.getByText("Revision 1", { exact: true }) });
      await revisionOne
        .getByRole("button", { name: "Restore this revision" })
        .click();
      await revisionOne
        .getByRole("button", { name: /Confirm restore/ })
        .waitFor();
      await panel.screenshot({ path: join(out, "2-confirm.png") });
      await revisionOne
        .getByRole("button", { name: /Confirm restore/ })
        .click();
      await page.getByText(/Restored revision 1 as new revision/).waitFor();
      await panel.getByText(`Revision ${before + 1}`).waitFor();
      log(`restored revision 1 as revision ${before + 1}`);
      await shot("3-restored");

      const [download] = await Promise.all([
        page.waitForEvent("download"),
        panel.getByRole("button", { name: "Export" }).click(),
      ]);
      const file = join(out, download.suggestedFilename());
      await download.saveAs(file);
      const exported = JSON.parse(readFileSync(file, "utf8"));
      if (
        exported.format !== "codifier.graph-history" ||
        exported.revisions.length !== before + 1
      ) {
        throw new Error(
          `Unexpected export: ${exported.format}, ${exported.revisions.length} revisions`,
        );
      }
      log(`exported ${exported.revisions.length} revisions to ${file}`);
      // The blob download leaves Playwright waiting on a navigation that never
      // commits; a real navigation settles it before the browser closes.
      await page.goto("about:blank");
    } catch (error) {
      await shot("error").catch(() => {});
      throw error;
    }
  } finally {
    log(
      `browser console errors: ${consoleErrors.length ? consoleErrors.join(" | ") : "none"}`,
    );
    // Closing right after a blob download can race Playwright's page
    // teardown (TargetClosedError); it is harmless here.
    await browser.close().catch(() => {});
  }
  if (consoleErrors.length) throw new Error("The page logged console errors.");
}

process.on("SIGINT", () => {
  stopAll();
  process.exit(130);
});
// Never leave the agent or Vite running, even if something below crashes.
process.on("exit", stopAll);
// playwright-core can reject an internal promise with TargetClosedError while
// the browser closes after a download. Ignore only that; surface the rest.
process.on("unhandledRejection", (reason) => {
  if (reason?.name === "TargetClosedError") return;
  console.error("FAIL - unhandled rejection:", reason);
  process.exitCode = 1;
});

try {
  await launchServers();
  const repositoryId = await seedGraph();
  await driveHistoryFlow(repositoryId);
  log(`PASS - screenshots in ${out}`);
  if (keep) {
    log(
      `--keep: servers left running. Token: ${token}  Repository: ${repositoryId}`,
    );
    log("Press Ctrl+C to stop them.");
    await new Promise(() => {});
  }
} catch (error) {
  console.error(`FAIL - ${error.message}`);
  console.error(`artifacts in ${out}`);
  process.exitCode = 1;
} finally {
  if (!keep || process.exitCode) stopAll();
}
