#!/usr/bin/env node
// Launches the Codifier local agent (throwaway SQLite DB) and the local-web
// Vite dev server, seeds a graph with two revisions from a golden fixture,
// drives the web explorer in a real browser, and stops every process it
// started. Agent tooling, not product code.
//
// Usage (from the repository root):
//   PLAYWRIGHT_CORE_DIR=<dir with node_modules/playwright-core> \
//     node .claude/skills/run-codifier/driver.mjs [--out <dir>] [--agent-port 4198]
//       [--flow all|history|exceptions] [--keep]
//
// Env:
//   PLAYWRIGHT_CORE_DIR  required unless playwright-core resolves from here
//   BROWSER_CHANNEL      default "msedge" on Windows, "chromium" elsewhere
//   HEADED=1             show the browser window

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
const flow = flag("--flow", "all");
if (
  ![
    "all",
    "history",
    "exceptions",
    "dependencies",
    "a11y",
    "screenreader",
  ].includes(flow)
) {
  throw new Error(
    `--flow must be all, history, exceptions, or a11y (got ${flow}).`,
  );
}
const agentPort = Number(flag("--agent-port", "4198"));
const out = resolve(
  flag("--out", mkdtempSync(join(tmpdir(), "codifier-run-"))),
);
mkdirSync(out, { recursive: true });
const isWindows = process.platform === "win32";
const agentUrl = `http://127.0.0.1:${agentPort}`;
// --web-port lets the driver run beside a developer's own dev server on 5173.
const webPort = Number(flag("--web-port", "5173"));
const webUrl = `http://127.0.0.1:${webPort}`;
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

function loadAxeSource() {
  const bases = [process.env.PLAYWRIGHT_CORE_DIR, repoRoot].filter(Boolean);
  for (const base of bases) {
    try {
      const require = createRequire(join(resolve(base), "noop.js"));
      return readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
    } catch {
      // try the next base
    }
  }
  throw new Error(
    "axe-core not found. Install it next to playwright-core (see SKILL.md).",
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
      `Something already answers on ${webUrl} (Vite uses strictPort). Pass --web-port <free port> or stop it.`,
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

  const web = start(
    "web",
    `pnpm --filter @codifier/local-web exec vite --host 127.0.0.1 --strictPort --port ${webPort}`,
  );
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
      // Instant scrolling makes focus-position checks deterministic.
      ...(flow === "a11y" ? { reducedMotion: "reduce" } : {}),
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
      const a11y = flow === "a11y" ? createA11yAudit(page) : null;
      if (a11y) await a11y.state("explorer-disconnected");
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

      // Exceptions first: restoring revision 1 below removes the seeded
      // intended component, and with it the finding this flow reviews.
      if (a11y) {
        await driveA11yFlow(page, a11y);
        return;
      }
      if (flow === "exceptions" || flow === "all") {
        await driveExceptionFlow(page, shot);
      }
      if (flow === "exceptions") return;
      await page.getByRole("button", { name: "Explore" }).click();
      if (flow === "dependencies" || flow === "all") {
        await driveDependencyFlow(page, shot);
      }
      if (flow === "dependencies") return;

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

/**
 * Automated WCAG 2.2 A/AA checks per UI state: axe-core rules plus scripted
 * checks axe cannot fully cover (keyboard focus order and visibility, focus
 * obscured by fixed content, 24px target size, 320px reflow).
 */
function createA11yAudit(page) {
  const axeSource = loadAxeSource();
  const report = { axeVersion: null, tags: [], states: [] };
  const tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
  report.tags = tags;

  async function axe() {
    if (!(await page.evaluate(() => "axe" in window))) {
      await page.addScriptTag({ content: axeSource });
    }
    return page.evaluate(async (runTags) => {
      const result = await window.axe.run(document, {
        runOnly: { type: "tag", values: runTags },
        resultTypes: ["violations", "incomplete"],
      });
      // 2.5.3 Label in Name is only covered by an experimental axe rule.
      const labelInName = await window.axe.run(document, {
        runOnly: { type: "rule", values: ["label-content-name-mismatch"] },
        resultTypes: ["violations", "incomplete"],
      });
      result.violations.push(...labelInName.violations);
      result.incomplete.push(...labelInName.incomplete);
      const summarize = (items) =>
        items.map((item) => ({
          id: item.id,
          impact: item.impact,
          help: item.help,
          tags: item.tags.filter((tag) => tag.startsWith("wcag")),
          count: item.nodes.length,
          nodes: item.nodes.slice(0, 8).map((node) => ({
            target: node.target.join(" "),
            summary: node.failureSummary,
          })),
        }));
      return {
        version: window.axe.version,
        violations: summarize(result.violations),
        incomplete: summarize(result.incomplete),
      };
    }, tags);
  }

  // 2.5.8 Target Size (Minimum): 24x24 CSS px unless inline in text.
  const smallTargets = () =>
    page.evaluate(() => {
      const selector =
        'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])';
      return [...document.querySelectorAll(selector)]
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          if (rect.width === 0 || style.visibility === "hidden") return false;
          const inlineInText =
            element.tagName === "A" && element.closest("p, li") !== null;
          return !inlineInText && (rect.width < 24 || rect.height < 24);
        })
        .slice(0, 20)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            element: `${element.tagName.toLowerCase()} "${(element.getAttribute("aria-label") ?? element.textContent ?? "").trim().slice(0, 40)}"`,
            size: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
          };
        });
    });

  // 2.1.1 / 2.4.3 / 2.4.7 / 2.4.11: walk Tab order, record each stop.
  async function keyboardWalk(maxStops = 120) {
    await page.evaluate(() => {
      // blur() keeps the browser's sequential-focus start point where the
      // last click happened; focusing an anchor at the top resets it.
      window.scrollTo(0, 0);
      const anchor = document.createElement("div");
      anchor.tabIndex = -1;
      anchor.id = "a11y-walk-start";
      document.body.prepend(anchor);
      anchor.focus();
      anchor.addEventListener("blur", () => anchor.remove(), { once: true });
    });
    const stops = [];
    const seen = new Set();
    for (let step = 0; step < maxStops; step += 1) {
      await page.keyboard.press("Tab");
      const stop = await page.evaluate(() => {
        const element = document.activeElement;
        if (!element || element === document.body) return null;
        const style = getComputedStyle(element);
        // Browsers scroll a newly focused element into view; headless pages
        // can skip that after a full-page capture, so emulate it before
        // probing what covers the element.
        const before = element.getBoundingClientRect();
        if (before.bottom <= 0 || before.top >= innerHeight) {
          element.scrollIntoView({ block: "nearest" });
        }
        const rect = element.getBoundingClientRect();
        const hasIndicator =
          (style.outlineStyle !== "none" &&
            parseFloat(style.outlineWidth) > 0) ||
          style.boxShadow !== "none";
        const x = Math.min(
          Math.max(rect.left + rect.width / 2, 0),
          innerWidth - 1,
        );
        const y = Math.min(
          Math.max(rect.top + rect.height / 2, 0),
          innerHeight - 1,
        );
        const topElement = document.elementFromPoint(x, y);
        const obscured =
          topElement !== null &&
          topElement !== element &&
          !element.contains(topElement) &&
          !topElement.contains(element);
        const path = [];
        for (
          let node = element;
          node && node !== document.body;
          node = node.parentElement
        ) {
          path.unshift(
            `${node.tagName}:${[...(node.parentElement?.children ?? [])].indexOf(node)}`,
          );
        }
        return {
          key: path.join("/"),
          element: `${element.tagName.toLowerCase()} "${(element.getAttribute("aria-label") ?? element.textContent ?? element.getAttribute("placeholder") ?? element.id ?? "").trim().slice(0, 40)}"`,
          hasIndicator,
          obscuredBy: obscured
            ? `${topElement.tagName.toLowerCase()} "${(topElement.textContent ?? "").trim().slice(0, 40)}" [rect ${Math.round(rect.top)}..${Math.round(rect.bottom)} of ${innerHeight}, scrollY ${Math.round(scrollY)}]`
            : null,
        };
      });
      if (!stop) break;
      // Composite native controls (date inputs) take several Tab presses
      // while focus stays on one element; only a revisit means we wrapped.
      if (stops.at(-1)?.key === stop.key) continue;
      if (seen.has(stop.key)) break;
      seen.add(stop.key);
      stops.push(stop);
    }
    return {
      stops: stops.length,
      order: stops.map((stop) => stop.element),
      withoutIndicator: stops
        .filter((stop) => !stop.hasIndicator)
        .map((stop) => stop.element),
      obscured: stops
        .filter((stop) => stop.obscuredBy)
        .map((stop) => `${stop.element} under ${stop.obscuredBy}`),
    };
  }

  // 1.4.10 Reflow: no horizontal scrolling at 320 CSS px.
  // 1.4.12 Text Spacing: apply the WCAG overrides and report text that is
  // clipped only after them (already-truncated names are not new loss).
  async function textSpacing() {
    const measure = () =>
      page.evaluate(() => {
        const clipped = new Map();
        for (const element of document.querySelectorAll("body *")) {
          if (!element.textContent?.trim() || element.children.length > 0)
            continue;
          const style = getComputedStyle(element);
          const hidesX = ["hidden", "clip"].includes(style.overflowX);
          const hidesY = ["hidden", "clip"].includes(style.overflowY);
          const x = hidesX && element.scrollWidth > element.clientWidth + 1;
          const y = hidesY && element.scrollHeight > element.clientHeight + 1;
          if (x || y) {
            const path = [];
            for (
              let node = element;
              node && node !== document.body;
              node = node.parentElement
            ) {
              path.unshift(
                `${node.tagName}:${[...(node.parentElement?.children ?? [])].indexOf(node)}`,
              );
            }
            clipped.set(
              path.join("/"),
              `${element.tagName.toLowerCase()} "${element.textContent.trim().slice(0, 40)}"${x ? " (width)" : ""}${y ? " (height)" : ""}`,
            );
          }
        }
        return [...clipped];
      });
    const before = new Map(await measure());
    const style = await page.addStyleTag({
      content:
        "* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }",
    });
    await page.waitForTimeout(100);
    const after = await measure();
    await style.evaluate((node) => node.remove());
    return {
      alreadyTruncated: before.size,
      newlyClipped: after
        .filter(([key]) => !before.has(key))
        .map(([, label]) => label),
    };
  }

  async function reflow(name) {
    const original = page.viewportSize();
    await page.setViewportSize({ width: 320, height: 800 });
    await page.waitForTimeout(150);
    const result = await page.evaluate(() => {
      const overflow = document.documentElement.scrollWidth - innerWidth;
      const offenders =
        overflow > 0
          ? [...document.querySelectorAll("body *")]
              .filter(
                (element) =>
                  element.getBoundingClientRect().right > innerWidth + 1,
              )
              .filter(
                (element) =>
                  ![...element.children].some(
                    (child) =>
                      child.getBoundingClientRect().right > innerWidth + 1,
                  ),
              )
              .slice(0, 8)
              .map(
                (element) =>
                  `${element.tagName.toLowerCase()}.${String(element.className).split(" ").slice(0, 2).join(".")}`,
              )
          : [];
      return { horizontalOverflowPx: Math.max(0, overflow), offenders };
    });
    // 2.4.11 at phone width, where fixed content covers more of the page.
    const walk = await keyboardWalk();
    await page.screenshot({
      path: join(out, `a11y-${name}-320px.png`),
      fullPage: true,
    });
    await page.setViewportSize(original);
    return { ...result, obscuredFocus: walk.obscured, tabStops: walk.stops };
  }

  return {
    report,
    async state(name, { walk = true, reflowCheck = false } = {}) {
      const axeResult = await axe();
      report.axeVersion = axeResult.version;
      const entry = {
        name,
        violations: axeResult.violations,
        incomplete: axeResult.incomplete,
        smallTargets: await smallTargets(),
        keyboard: walk ? await keyboardWalk() : null,
        reflow: reflowCheck ? await reflow(name) : null,
        textSpacing: await textSpacing(),
      };
      report.states.push(entry);
      await page.screenshot({
        path: join(out, `a11y-${name}.png`),
        fullPage: true,
      });
      log(
        `a11y ${name}: ${entry.violations.length} axe violation types, ${entry.smallTargets.length} small targets` +
          (entry.keyboard
            ? `, ${entry.keyboard.stops} tab stops (${entry.keyboard.withoutIndicator.length} without focus indicator, ${entry.keyboard.obscured.length} obscured)`
            : "") +
          (entry.reflow
            ? `, reflow overflow ${entry.reflow.horizontalOverflowPx}px, ${entry.reflow.obscuredFocus.length} focus stops obscured at 320px`
            : ""),
      );
    },
  };
}

async function driveA11yFlow(page, a11y) {
  await a11y.state("explorer-loaded", { reflowCheck: true });

  const panel = page.getByRole("region", { name: "Revision history" });
  await panel.getByRole("button", { name: "Show revision history" }).click();
  await panel.getByText("Revision 1", { exact: true }).waitFor();
  await a11y.state("explorer-history", { walk: false });

  await page.getByRole("button", { name: "Relationship map" }).click();
  await page.waitForTimeout(500);
  await a11y.state("explorer-relationship-map", { walk: false });
  await page.getByRole("button", { name: "Browse list" }).click();

  await page.getByRole("button", { name: "Rules" }).click();
  const finding = page
    .locator("li")
    .filter({ hasText: "Intended component has no mapped code" });
  await finding.waitFor();
  await finding.getByRole("button", { name: "Record exception" }).click();
  await a11y.state("rules-exception-form", { reflowCheck: true });

  await page.getByRole("button", { name: "Marketplace" }).click();
  await page.waitForTimeout(500);
  await a11y.state("marketplace", { reflowCheck: true });

  const file = join(out, "a11y-report.json");
  writeFileSync(file, `${JSON.stringify(a11y.report, null, 2)}\n`);
  log(`a11y report written to ${file}`);
}

async function driveDependencyFlow(page, shot) {
  await page.fill("#intended-component-name", "Driver persistence");
  await page.getByRole("button", { name: "Create intended component" }).click();
  await page.getByText(/^Intended component created/).waitFor();
  await page.getByRole("button", { name: /^Driver component/ }).click();
  await page.getByText("Driver component depends on").waitFor();
  await page.getByText(/^No intended dependencies yet/).waitFor();

  await page
    .getByLabel("Add dependency on")
    .selectOption({ label: "Driver persistence" });
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page
    .getByText('"Driver component" now depends on "Driver persistence".')
    .waitFor();
  const remove = page.getByRole("button", {
    name: "Remove dependency on Driver persistence",
  });
  await remove.waitFor();
  log("declared an intended dependency from the explorer");
  await shot("7-dependency-added");

  await remove.click();
  await page
    .getByText(/^Removed the dependency from "Driver component"/)
    .waitFor();
  await page.getByText(/^No intended dependencies yet/).waitFor();
  log("removed the intended dependency");
}

async function driveExceptionFlow(page, shot) {
  await page.getByRole("button", { name: "Rules" }).click();
  const finding = page
    .locator("li")
    .filter({ hasText: "Intended component has no mapped code" });
  await finding.waitFor();
  log("rules page lists the unmapped-component finding");

  await finding.getByRole("button", { name: "Record exception" }).click();
  await finding.getByLabel("Your name").fill("Driver reviewer");
  await finding
    .getByLabel("Why is this finding acceptable?")
    .fill("Planned for the next milestone.");
  const nextYear = new Date(Date.now() + 365 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  await finding.getByLabel("Expires (optional)").fill(nextYear);
  await finding.screenshot({ path: join(out, "4-exception-form.png") });
  await finding.getByRole("button", { name: "Save exception" }).click();
  await page.getByText(/^Exception recorded\./).waitFor();
  await finding.getByText(/Accepted exception · Driver reviewer/).waitFor();
  await page.getByText("1 accepted exception", { exact: true }).waitFor();
  log("recorded an exception; the finding stays listed as accepted");
  await shot("5-exception-accepted");

  await finding.getByRole("button", { name: "Revoke exception" }).click();
  await finding
    .getByLabel("Why revoke this exception?")
    .fill("Component was mapped.");
  await finding.getByRole("button", { name: "Revoke exception" }).click();
  await page.getByText(/^Exception revoked\./).waitFor();
  await finding.getByRole("button", { name: "Record exception" }).waitFor();
  await page.getByText("0 accepted exceptions", { exact: true }).waitFor();
  log("revoked the exception; the finding is open for review again");
  await shot("6-exception-revoked");
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
  if (flow === "screenreader") {
    const { runScreenReaderFlow } = await import("./screenreader.mjs");
    const results = await runScreenReaderFlow({
      chromium: loadPlaywright().chromium,
      webUrl,
      agentUrl,
      token,
      repositoryId,
      out,
      log,
    });
    if (results.some((result) => !result.pass)) {
      throw new Error("Some screen-reader announcements were missing.");
    }
  } else {
    await driveHistoryFlow(repositoryId);
  }
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
