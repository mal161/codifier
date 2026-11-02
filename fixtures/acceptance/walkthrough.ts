/**
 * Phase 6 acceptance walkthrough: a reviewer-repeatable run of the local MVP
 * against the separate React + Express shop in ./react-express-shop.
 *
 *   pnpm acceptance [-- --out <dir>] [-- --port 4196]
 *
 * The shop is copied to a temporary Git repository, a real local agent is
 * started with an offline guard, and every step talks to that agent over
 * HTTP. Nothing is pre-seeded: the graph comes only from analyzing the files,
 * and intent is declared through the same API the clients use. Source
 * navigation reuses the web client's navigation modules. Each check is
 * recorded with its observed value in walkthrough-report.json.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  GraphEntity,
  GraphSnapshot,
  SourceLocator,
} from "@codifier/domain";
import { lookupEntitiesAtSourceLocation } from "../../apps/local-web/src/navigation/source-lookup.js";
import { createVscodeUri } from "../../apps/local-web/src/navigation/vscode.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1]!;
};
const isWindows = process.platform === "win32";
const port = Number(flag("--port", "4196"));
const agentUrl = `http://127.0.0.1:${port}`;
const token = randomBytes(32).toString("base64url");
const work = realpathSync.native(
  mkdtempSync(join(tmpdir(), "codifier-acceptance-")),
);
const out = resolve(flag("--out", join(work, "report")));
mkdirSync(out, { recursive: true });
const shop = join(work, "shop");
const guardLog = join(work, "offline-guard.log");
const agentLog = join(work, "agent.log");
const children: ChildProcess[] = [];
// NODE_OPTIONS treats backslashes inside quotes as escapes; use forward slashes.
const guardOption = `--require "${join(here, "offline-guard.cjs").split("\\").join("/")}"`;

interface Check {
  step: string;
  assertion: string;
  observed: unknown;
  pass: boolean;
}
const checks: Check[] = [];
let currentStep = "";

function step(name: string): void {
  currentStep = name;
  console.log(`\n## ${name}`);
}

function check(assertion: string, pass: boolean, observed?: unknown): void {
  checks.push({ step: currentStep, assertion, observed, pass });
  const shown =
    observed === undefined
      ? ""
      : ` (${JSON.stringify(observed).slice(0, 140)})`;
  console.log(`  ${pass ? "✓" : "✗"} ${assertion}${shown}`);
}

const sameSet = (left: string[], right: string[]) =>
  left.length === right.length &&
  [...left].sort().join("\n") === [...right].sort().join("\n");

function stopAll(): void {
  for (const child of children.splice(0)) {
    if (child.exitCode !== null) continue;
    if (isWindows)
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    else child.kill("SIGTERM");
  }
}
process.on("exit", stopAll);

async function api<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(`${agentUrl}${path}`, {
    method: init.method ?? "GET",
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body === undefined
        ? {}
        : { "content-type": "application/json" }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(
      `${init.method ?? "GET"} ${path} -> ${response.status}: ${text}`,
    );
  return (text ? JSON.parse(text) : null) as T;
}

function git(...gitArgs: string[]): string {
  const result = spawnSync("git", gitArgs, { cwd: shop, encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(`git ${gitArgs.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

/** 1-based line of the first line in a shop file containing `text`. */
function lineOf(relativePath: string, text: string): number {
  const lines = readFileSync(
    join(shop, ...relativePath.split("/")),
    "utf8",
  ).split("\n");
  const index = lines.findIndex((line) => line.includes(text));
  if (index === -1) throw new Error(`"${text}" not found in ${relativePath}`);
  return index + 1;
}

/** Text a locator covers: 1-based lines, 0-based columns, exclusive end. */
function textAt(locator: SourceLocator): string {
  const lines = readFileSync(
    join(shop, ...locator.repositoryRelativePath.split("/")),
    "utf8",
  ).split("\n");
  const { start, end } = locator.range;
  if (start.line === end.line)
    return lines[start.line - 1]!.slice(start.column, end.column);
  return [
    lines[start.line - 1]!.slice(start.column),
    ...lines.slice(start.line, end.line - 1),
    lines[end.line - 1]!.slice(0, end.column),
  ].join("\n");
}

type Job = {
  id: string;
  status: string;
  repositoryId: string;
  error?: string;
  result?: {
    persisted: boolean;
    coverage: {
      analyzedFiles: number;
      failedFiles: number;
      skippedFiles: number;
      supportedFiles: number;
    };
    reconciliation?: {
      mode: string;
      addedFiles: string[];
      changedFiles: string[];
      removedFiles: string[];
      parseReuse?: { reusedFiles: number; parsedFiles: number };
    };
  };
};

async function analyze(repositoryId?: string): Promise<Job> {
  const endpoint = repositoryId
    ? `/v1/repositories/${repositoryId}/analysis-jobs`
    : "/v1/analysis-jobs";
  let job = await api<Job>(endpoint, {
    method: "POST",
    body: { rootPath: shop },
  });
  for (
    let attempt = 0;
    attempt < 600 && ["queued", "running", "cancelling"].includes(job.status);
    attempt += 1
  ) {
    await new Promise((done) => setTimeout(done, 100));
    job = await api<Job>(`/v1/analysis-jobs/${job.id}`);
  }
  return job;
}

const graphOf = (repositoryId: string) =>
  api<GraphSnapshot>(`/v1/repositories/${repositoryId}/graph`);
const freshness = (repositoryId: string, entityId: string) =>
  api<{ status: string; message: string }>(
    `/v1/repositories/${repositoryId}/source-freshness`,
    {
      method: "POST",
      body: { rootPath: shop, entityId },
    },
  );
const fileEntity = (graph: GraphSnapshot, path: string) =>
  graph.entities.find(
    (entity) => entity.kind === "file" && entity.name === path,
  );
const symbolIn = (graph: GraphSnapshot, path: string, name: string) =>
  graph.entities.find(
    (entity) =>
      entity.kind === "symbol" &&
      entity.name === name &&
      entity.source?.repositoryRelativePath === path,
  );
const identityKey = (entity: GraphEntity) =>
  `${entity.kind}|${entity.source?.repositoryRelativePath ?? ""}|${entity.name}`;

async function main(): Promise<void> {
  step("Offline guard canary");
  const canary = spawnSync(
    process.execPath,
    [
      "-e",
      "fetch('http://example.com').then(()=>process.exit(0),()=>process.exit(3))",
    ],
    {
      env: {
        ...process.env,
        NODE_OPTIONS: guardOption,
        CODIFIER_OFFLINE_GUARD_LOG: join(work, "canary.log"),
      },
      encoding: "utf8",
    },
  );
  const canaryLog = existsSync(join(work, "canary.log"))
    ? readFileSync(join(work, "canary.log"), "utf8")
    : "";
  check(
    "guard refuses a non-loopback request and logs it",
    canary.status === 3 && canaryLog.includes("example.com"),
    canaryLog.trim(),
  );

  step("Register the separate repository");
  cpSync(join(here, "react-express-shop"), shop, { recursive: true });
  git("init", "--quiet");
  git("add", ".");
  git(
    "-c",
    "user.name=Acceptance",
    "-c",
    "user.email=acceptance@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "Initial shop",
  );
  const head = git("rev-parse", "HEAD");
  check(
    "shop is its own Git repository with one commit",
    head.length === 40,
    head,
  );

  writeFileSync(agentLog, "");
  const agent = spawn(
    process.execPath,
    [
      join(
        repoRoot,
        "apps",
        "local-agent",
        "node_modules",
        "tsx",
        "dist",
        "cli.mjs",
      ),
      "src/cli.ts",
      "serve",
      "--database",
      join(work, "graph.sqlite"),
      "--port",
      String(port),
    ],
    {
      cwd: join(repoRoot, "apps", "local-agent"),
      env: {
        ...process.env,
        CODIFIER_AGENT_TOKEN: token,
        NODE_OPTIONS: guardOption,
        CODIFIER_OFFLINE_GUARD_LOG: guardLog,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  children.push(agent);
  agent.stdout!.on("data", (chunk) => appendFileSync(agentLog, chunk));
  agent.stderr!.on("data", (chunk) => appendFileSync(agentLog, chunk));
  for (
    let attempt = 0;
    attempt < 240 &&
    !readFileSync(agentLog, "utf8").includes("Server listening");
    attempt += 1
  ) {
    if (
      agent.exitCode !== null ||
      readFileSync(agentLog, "utf8").includes("EADDRINUSE")
    )
      break;
    await new Promise((done) => setTimeout(done, 250));
  }
  const agentStarted = readFileSync(agentLog, "utf8").includes(
    `Server listening at ${agentUrl}`,
  );
  check(
    "agent listens on loopback only, with the offline guard loaded",
    agentStarted,
    agentUrl,
  );
  if (!agentStarted)
    throw new Error(`Agent did not start:\n${readFileSync(agentLog, "utf8")}`);

  step("Clean analysis");
  const first = await analyze();
  const repositoryId = first.repositoryId;
  check(
    "durable analysis job completes and persists",
    first.status === "completed" && first.result?.persisted === true,
    first.status,
  );
  check(
    "all 18 TypeScript/TSX source files are analyzed",
    first.result?.coverage.analyzedFiles === 18,
    first.result?.coverage,
  );
  check(
    "no failed or skipped files",
    first.result?.coverage.failedFiles === 0 &&
      first.result?.coverage.skippedFiles === 0,
  );
  check(
    "reconciliation reports an initial analysis",
    first.result?.reconciliation?.mode === "initial",
  );
  const graph1 = await graphOf(repositoryId);
  check(
    "Git context records the shop's commit on a clean tree",
    graph1.gitContext?.commit === head &&
      graph1.gitContext?.workingTree === "clean",
    graph1.gitContext,
  );

  step("Explore the graph");
  const files = graph1.entities
    .filter((entity) => entity.kind === "file")
    .map((entity) => entity.name);
  check(
    "every source file is a graph entity",
    files.length === 18,
    files.length,
  );
  const expectedSymbols: Array<[string, string]> = [
    ["server/src/app.ts", "createApp"],
    ["server/src/app.ts", "healthCheck"],
    ["server/src/middleware/auth.ts", "requireUser"],
    ["server/src/routes/cart.ts", "clearCart"],
    ["server/src/services/cartService.ts", "addToCart"],
    ["server/src/services/productService.ts", "listProducts"],
    ["shared/src/types.ts", "formatPrice"],
    ["client/src/App.tsx", "App"],
    ["client/src/pages/ProductsPage.tsx", "ProductsPage"],
    ["client/src/components/ProductCard.tsx", "ProductCard"],
    ["client/src/hooks/useCart.ts", "useCart"],
  ];
  const missingSymbols = expectedSymbols.filter(
    ([path, name]) => !symbolIn(graph1, path, name),
  );
  check(
    "declared functions and components are symbols at their files",
    missingSymbols.length === 0,
    missingSymbols,
  );

  // Routes nested in a function are qualified by it (createApp.GET /health).
  const routes = graph1.entities
    .filter((entity) =>
      /(^|\.)(GET|POST|PUT|PATCH|DELETE) \//.test(entity.name),
    )
    .map((entity) => `${entity.source?.repositoryRelativePath} ${entity.name}`);
  const expectedRoutes = [
    "server/src/app.ts createApp.GET /health",
    "server/src/routes/products.ts GET /",
    "server/src/routes/products.ts GET /:id",
    "server/src/routes/cart.ts GET /",
    "server/src/routes/cart.ts POST /items",
    "server/src/routes/cart.ts DELETE /",
  ];
  check(
    "Express routes are detected with method and path",
    sameSet(routes, expectedRoutes),
    routes,
  );
  const routeToHandler = graph1.relationships.some((relationship) => {
    const source = graph1.entities.find(
      (entity) => entity.id === relationship.sourceEntityId,
    );
    const target = graph1.entities.find(
      (entity) => entity.id === relationship.targetEntityId,
    );
    return (
      relationship.type === "ROUTES_TO" &&
      source?.name === "DELETE /" &&
      target?.name === "clearCart"
    );
  });
  check("DELETE / routes to its clearCart handler", routeToHandler);

  const imports = (from: string, to: string) =>
    graph1.relationships.some(
      (relationship) =>
        relationship.type === "IMPORTS" &&
        relationship.sourceEntityId === fileEntity(graph1, from)?.id &&
        relationship.targetEntityId === fileEntity(graph1, to)?.id,
    );
  check(
    "client imports through the @shared/* path alias resolve",
    imports("client/src/components/ProductCard.tsx", "shared/src/types.ts"),
  );
  check(
    "server layering imports are recorded",
    imports(
      "server/src/routes/products.ts",
      "server/src/services/productService.ts",
    ) &&
      imports(
        "server/src/services/productService.ts",
        "server/src/db/productRepository.ts",
      ),
  );
  check(
    "the drifting import (cart route -> repository) is observed",
    imports("server/src/routes/cart.ts", "server/src/db/cartRepository.ts"),
  );

  step("Navigate source -> architecture");
  const clearLine = lineOf("server/src/routes/cart.ts", "function clearCart");
  const atLine = lookupEntitiesAtSourceLocation(
    graph1,
    `server/src/routes/cart.ts:${clearLine + 1}`,
  ).map((entity) => entity.name);
  check(
    `a location inside clearCart (line ${clearLine + 1}) resolves to the clearCart symbol`,
    atLine.includes("clearCart"),
    atLine,
  );

  step("Navigate architecture -> source");
  const createApp = symbolIn(graph1, "server/src/app.ts", "createApp")!;
  const createAppFresh = await freshness(repositoryId, createApp.id);
  check(
    "freshness check reports the createApp location current",
    createAppFresh.status === "current",
    createAppFresh.status,
  );
  const covered = textAt(createApp.source!);
  check(
    "the recorded range covers exactly the createApp declaration",
    covered.startsWith("export function createApp()") &&
      covered.trimEnd().endsWith("}"),
    covered.split("\n")[0],
  );
  const uri = createVscodeUri(shop, createApp.source!);
  const { line, column } = createApp.source!.range.start;
  check(
    "editor link targets the same line and 1-based column",
    uri !== null &&
      uri.endsWith(`server/src/app.ts:${line}:${column + 1}`) &&
      !uri.includes(token),
    uri,
  );

  step("Declare intended architecture");
  const componentPaths: Record<string, (path: string) => boolean> = {
    "Web UI": (path) =>
      /^client\/src\/(main\.tsx|App\.tsx|pages\/|components\/)/.test(path),
    "Client data access": (path) => /^client\/src\/(api|hooks)\//.test(path),
    "HTTP API": (path) =>
      /^server\/src\/(index\.ts|app\.ts|routes\/|middleware\/)/.test(path),
    "Domain services": (path) => path.startsWith("server/src/services/"),
    Persistence: (path) => path.startsWith("server/src/db/"),
    "Shared contracts": (path) => path.startsWith("shared/src/"),
  };
  const componentIds: Record<string, string> = {};
  let graph: GraphSnapshot = graph1;
  for (const name of Object.keys(componentPaths)) {
    graph = await api<GraphSnapshot>(
      `/v1/repositories/${repositoryId}/intended-components`,
      { method: "POST", body: { name } },
    );
    componentIds[name] = graph.entities.find(
      (entity) => entity.kind === "component" && entity.name === name,
    )!.id;
  }
  let mapped = 0;
  for (const file of graph1.entities.filter(
    (entity) => entity.kind === "file",
  )) {
    const owner = Object.entries(componentPaths).find(([, matches]) =>
      matches(file.name),
    )?.[0];
    if (!owner) continue;
    await api(
      `/v1/repositories/${repositoryId}/intended-components/${componentIds[owner]}/mappings`,
      { method: "POST", body: { entityId: file.id } },
    );
    mapped += 1;
  }
  check(
    "every source file is mapped to exactly one intended component",
    mapped === 18,
    mapped,
  );
  const intendedDependencies: Array<[string, string]> = [
    ["Web UI", "Client data access"],
    ["Web UI", "Shared contracts"],
    ["Client data access", "Shared contracts"],
    ["HTTP API", "Domain services"],
    ["Domain services", "Persistence"],
    ["Domain services", "Shared contracts"],
    ["Persistence", "Shared contracts"],
  ];
  for (const [from, to] of intendedDependencies) {
    graph = await api<GraphSnapshot>(
      `/v1/repositories/${repositoryId}/intended-components/${componentIds[from]}/dependencies`,
      { method: "POST", body: { targetComponentId: componentIds[to] } },
    );
  }
  check(
    "seven intended dependencies are recorded with developer evidence",
    graph.relationships.filter(
      (item) => item.type === "DEPENDS_ON" && item.state === "intended",
    ).length === 7,
  );

  step("Review drift");
  type Finding = {
    ruleId: string;
    message: string;
    findingKey: string;
    entityIds: string[];
    sourceLocations: SourceLocator[];
  };
  const rules1 = await api<{ ruleSetVersion: string; findings: Finding[] }>(
    `/v1/repositories/${repositoryId}/architecture-rules`,
  );
  const summary1 = rules1.findings.map((finding) => finding.ruleId);
  check(
    "exactly one finding: the unplanned dependency",
    sameSet(summary1, ["unplanned-observed-dependency"]),
    summary1,
  );
  const drift = rules1.findings.find(
    (finding) => finding.ruleId === "unplanned-observed-dependency",
  );
  check(
    "it names HTTP API depending on Persistence",
    drift?.message.includes(
      '"HTTP API" depends on mapped code in "Persistence"',
    ) === true,
    drift?.message,
  );
  const importLine = lineOf(
    "server/src/routes/cart.ts",
    "../db/cartRepository",
  );
  const firstLocation = drift?.sourceLocations[0];
  check(
    `its first source location is the cartRepository import (cart.ts line ${importLine})`,
    firstLocation?.repositoryRelativePath === "server/src/routes/cart.ts" &&
      firstLocation.range.start.line === importLine,
    firstLocation &&
      `${firstLocation.repositoryRelativePath}:${firstLocation.range.start.line}`,
  );

  step("Edit the source");
  const cartRoute = join(shop, "server", "src", "routes", "cart.ts");
  const cartService = join(shop, "server", "src", "services", "cartService.ts");
  writeFileSync(
    cartRoute,
    readFileSync(cartRoute, "utf8")
      .replace(
        'import { addToCart, getCart } from "../services/cartService";\nimport { cartRepository } from "../db/cartRepository";',
        'import { addToCart, clearCart as clearUserCart, getCart } from "../services/cartService";',
      )
      .replace(
        "  cartRepository.delete(response.locals.userId);",
        "  clearUserCart(response.locals.userId);",
      ),
  );
  writeFileSync(
    cartService,
    `${readFileSync(cartService, "utf8")}\nexport function clearCart(userId: string): void {\n  cartRepository.delete(userId);\n}\n`,
  );
  check(
    "the route now goes through the service layer",
    !readFileSync(cartRoute, "utf8").includes("cartRepository"),
  );
  const staleFile = await freshness(
    repositoryId,
    fileEntity(graph1, "server/src/routes/cart.ts")!.id,
  );
  const staleSymbol = await freshness(
    repositoryId,
    symbolIn(graph1, "server/src/routes/cart.ts", "clearCart")!.id,
  );
  check(
    "saved locations in the edited file are stale before re-analysis",
    staleFile.status === "stale" && staleSymbol.status === "stale",
    [staleFile.status, staleSymbol.status],
  );
  const untouched = await freshness(repositoryId, createApp.id);
  check(
    "locations in untouched files stay current",
    untouched.status === "current",
  );

  step("Incremental update");
  const revisionsBefore = (
    await api<{ revisions: unknown[] }>(
      `/v1/repositories/${repositoryId}/revisions`,
    )
  ).revisions.length;
  const second = await analyze(repositoryId);
  const reconciliation = second.result?.reconciliation;
  check(
    "re-analysis completes and persists",
    second.status === "completed" && second.result?.persisted === true,
  );
  check(
    "exactly the two edited files are reported as changed",
    sameSet(reconciliation?.changedFiles ?? [], [
      "server/src/routes/cart.ts",
      "server/src/services/cartService.ts",
    ]) &&
      (reconciliation?.addedFiles.length ?? 1) === 0 &&
      (reconciliation?.removedFiles.length ?? 1) === 0,
    reconciliation?.changedFiles,
  );
  check(
    "only the edited files are re-parsed; the other 16 are reused",
    reconciliation?.parseReuse?.parsedFiles === 2 &&
      reconciliation.parseReuse.reusedFiles === 16,
    reconciliation?.parseReuse,
  );
  const graph2 = await graphOf(repositoryId);
  check(
    "Git context now reports uncommitted changes",
    graph2.gitContext?.workingTree === "dirty" &&
      graph2.gitContext.commit === head,
  );

  step("Stable identity");
  // Observed entities only; intent is checked separately below.
  const actual = (snapshot: GraphSnapshot) =>
    snapshot.entities.filter((entity) => entity.state === "actual");
  const before = new Map(
    actual(graph1).map((entity) => [identityKey(entity), entity.id]),
  );
  const after = new Map(
    actual(graph2).map((entity) => [identityKey(entity), entity.id]),
  );
  const changedIds = [...before]
    .filter(([key, id]) => after.has(key) && after.get(key) !== id)
    .map(([key]) => key);
  check(
    "every entity present before and after keeps its UUID (files, symbols, routes)",
    changedIds.length === 0 && before.size > 40,
    {
      compared: [...before.keys()].filter((key) => after.has(key)).length,
      changed: changedIds,
    },
  );
  const removed = [...before.keys()].filter((key) => !after.has(key));
  const added = [...after.keys()].filter((key) => !before.has(key));
  check(
    "the only new entity is the service's clearCart function",
    sameSet(added, ["symbol|server/src/services/cartService.ts|clearCart"]) &&
      removed.length === 0,
    { added, removed },
  );
  const intentKept = Object.values(componentIds).every((id) =>
    graph2.entities.some((entity) => entity.id === id),
  );
  const mappingsKept =
    graph2.relationships.filter((item) => item.type === "MAPS_TO").length ===
    18;
  const dependenciesKept =
    graph2.relationships.filter(
      (item) => item.type === "DEPENDS_ON" && item.state === "intended",
    ).length === 7;
  check(
    "intended components, mappings, and dependencies survive re-analysis",
    intentKept && mappingsKept && dependenciesKept,
  );
  check(
    "the edit added exactly one revision",
    (
      await api<{ revisions: unknown[] }>(
        `/v1/repositories/${repositoryId}/revisions`,
      )
    ).revisions.length ===
      revisionsBefore + 1,
  );

  step("Drift resolved");
  const rules2 = await api<{ findings: Finding[] }>(
    `/v1/repositories/${repositoryId}/architecture-rules`,
  );
  check(
    "no findings remain after the fix",
    rules2.findings.length === 0,
    rules2.findings.map((finding) => finding.ruleId),
  );
  const freshAgain = await freshness(
    repositoryId,
    fileEntity(graph2, "server/src/routes/cart.ts")!.id,
  );
  check(
    "the edited file's location is current again",
    freshAgain.status === "current",
  );

  step("No-op refresh");
  const revisionsBeforeNoop = (
    await api<{ revisions: unknown[] }>(
      `/v1/repositories/${repositoryId}/revisions`,
    )
  ).revisions.length;
  const third = await analyze(repositoryId);
  check(
    "an unchanged tree reports no changes and parses nothing",
    third.result?.reconciliation?.mode === "unchanged" &&
      third.result.reconciliation.parseReuse?.parsedFiles === 0,
    third.result?.reconciliation?.parseReuse,
  );
  check(
    "a no-op refresh adds no revision",
    (
      await api<{ revisions: unknown[] }>(
        `/v1/repositories/${repositoryId}/revisions`,
      )
    ).revisions.length === revisionsBeforeNoop,
  );

  step("Offline use");
  const blocked = existsSync(guardLog)
    ? readFileSync(guardLog, "utf8").trim()
    : "";
  check(
    "the agent attempted no network access beyond loopback during the whole run",
    blocked === "",
    blocked || "no attempts",
  );
  check(
    "the token never appears in the agent log",
    !readFileSync(agentLog, "utf8").includes(token),
  );
}

main()
  .catch((error: unknown) => {
    check(
      "walkthrough ran to completion",
      false,
      error instanceof Error ? error.message : String(error),
    );
  })
  .finally(() => {
    stopAll();
    const failed = checks.filter((item) => !item.pass);
    const report = {
      generatedAt: new Date().toISOString(),
      platform: `${process.platform} ${process.arch}`,
      node: process.version,
      fixture: "fixtures/acceptance/react-express-shop",
      passed: checks.length - failed.length,
      failed: failed.length,
      checks,
    };
    writeFileSync(
      join(out, "walkthrough-report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    console.log(
      `\n${failed.length === 0 ? "PASS" : "FAIL"}: ${report.passed}/${checks.length} checks. Report: ${join(out, "walkthrough-report.json")}`,
    );
    process.exitCode = failed.length === 0 ? 0 : 1;
  });
