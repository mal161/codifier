#!/usr/bin/env node
/* global require, process, console, setTimeout, clearTimeout, __dirname, fetch, Buffer */
/* eslint-disable @typescript-eslint/no-require-imports */
// Runs suite.cjs inside a real VS Code Extension Host against a real local
// agent, in an isolated profile, then checks no file it produced contains the
// agent token. Uses the VS Code already installed on this machine; no test
// framework or VS Code download is added to the repository.
//
//   node test/host/run.cjs [--extension-path <dir>] [--vscode <Code executable>]
//
// --extension-path runs against an unpacked/installed VSIX instead of the
// source folder. VSCODE_EXECUTABLE overrides executable discovery.
const { spawn, spawnSync } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const extensionRoot = path.resolve(__dirname, "..", "..");
const repoRoot = path.resolve(extensionRoot, "..", "..");
const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const isWindows = process.platform === "win32";
const children = [];

function findVsCode() {
  const explicit = flag("--vscode") ?? process.env.VSCODE_EXECUTABLE;
  if (explicit) return explicit;
  if (isWindows) {
    const candidates = [
      path.join(
        process.env.LOCALAPPDATA ?? "",
        "Programs",
        "Microsoft VS Code",
        "Code.exe",
      ),
      path.join(
        process.env.ProgramFiles ?? "",
        "Microsoft VS Code",
        "Code.exe",
      ),
    ];
    const found = candidates.find((candidate) => fs.existsSync(candidate));
    if (found) return found;
  }
  throw new Error(
    "VS Code executable not found. Pass --vscode <path> or set VSCODE_EXECUTABLE.",
  );
}

function stopAll() {
  for (const child of children.splice(0)) {
    if (child.exitCode !== null) continue;
    if (isWindows)
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    else {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // already exited
      }
    }
  }
}
process.on("exit", stopAll);

async function startAgent(tempRoot, token, port) {
  const logPath = path.join(tempRoot, "agent.log");
  const log = fs.openSync(logPath, "w");
  const child = spawn(
    `pnpm --filter @codifier/local-agent start -- serve --database "${path.join(tempRoot, "graph.sqlite")}" --port ${port}`,
    {
      cwd: repoRoot,
      shell: true,
      detached: !isWindows,
      env: { ...process.env, CODIFIER_AGENT_TOKEN: token },
      stdio: ["ignore", log, log],
    },
  );
  children.push(child);
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const output = fs.readFileSync(logPath, "utf8");
    if (output.includes("Server listening")) return logPath;
    if (output.includes("EADDRINUSE") || child.exitCode !== null) {
      throw new Error(`Agent failed to start:\n${output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for the agent.");
}

/** Files under root whose bytes contain the token as UTF-8 or UTF-16LE. */
function filesContaining(root, token) {
  const needles = [Buffer.from(token, "utf8"), Buffer.from(token, "utf16le")];
  const hits = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(entryPath);
      else if (entry.isFile()) {
        let bytes;
        try {
          bytes = fs.readFileSync(entryPath);
        } catch {
          continue; // locked by a still-closing process
        }
        if (needles.some((needle) => bytes.includes(needle)))
          hits.push(entryPath);
      }
    }
  };
  walk(root);
  return hits;
}

async function main() {
  const code = findVsCode();
  const extensionPath = path.resolve(flag("--extension-path") ?? extensionRoot);
  // Windows temp paths can be 8.3 short names (ALEXMW~1); VS Code reports
  // workspace folders by their long path, so resolve the real path first.
  const tempRoot = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "codifier-host-")),
  );
  const token = randomBytes(32).toString("base64url");
  const port = Number(process.env.CODIFIER_HOST_TEST_PORT ?? 4197);
  const agentUrl = `http://127.0.0.1:${port}`;

  try {
    await fetch(agentUrl);
    throw new Error(
      `Port ${port} is in use; set CODIFIER_HOST_TEST_PORT to a free port.`,
    );
  } catch (error) {
    if (String(error.message).startsWith("Port")) throw error;
  }

  const workspaceA = path.join(tempRoot, "workspace-a");
  const workspaceB = path.join(tempRoot, "workspace-b");
  fs.cpSync(
    path.join(
      repoRoot,
      "fixtures",
      "golden-repositories",
      "react-express-workspace",
    ),
    workspaceA,
    {
      recursive: true,
    },
  );
  fs.mkdirSync(workspaceB);
  const workspaceFile = path.join(tempRoot, "host-test.code-workspace");
  fs.writeFileSync(
    workspaceFile,
    JSON.stringify({ folders: [{ path: workspaceA }, { path: workspaceB }] }),
  );

  console.log(`VS Code: ${code}`);
  console.log(`Extension: ${extensionPath}`);
  const agentLog = await startAgent(tempRoot, token, port);
  console.log(`Agent: ${agentUrl}`);

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VSCODE_IPC_HOOK_CLI;
  Object.assign(env, {
    CODIFIER_HOST_TEST_TOKEN: token,
    CODIFIER_HOST_TEST_AGENT_URL: agentUrl,
    // Port 9 (discard) is reliably closed on loopback.
    CODIFIER_HOST_TEST_DEAD_AGENT_URL: "http://127.0.0.1:9",
    CODIFIER_HOST_TEST_WORKSPACE_A: workspaceA,
    CODIFIER_HOST_TEST_WORKSPACE_B: workspaceB,
  });
  // Each extension gets its own `vscode` API object, so the suite must load
  // from inside the extension under test for its UI stubs to apply. For an
  // installed VSIX, place a temporary copy there and remove it afterwards.
  let suitePath = path.join(__dirname, "suite.cjs");
  let temporarySuite = null;
  if (extensionPath !== extensionRoot) {
    temporarySuite = path.join(extensionPath, "codifier-host-suite.cjs");
    fs.copyFileSync(suitePath, temporarySuite);
    suitePath = temporarySuite;
  }
  const host = spawn(
    code,
    [
      workspaceFile,
      `--extensionDevelopmentPath=${extensionPath}`,
      `--extensionTestsPath=${suitePath}`,
      `--user-data-dir=${path.join(tempRoot, "user-data")}`,
      `--extensions-dir=${path.join(tempRoot, "extensions")}`,
      "--disable-extensions",
      "--disable-workspace-trust",
      "--skip-welcome",
      "--skip-release-notes",
      "--new-window",
      // CI needs e.g. --password-store=basic on Linux without a keyring.
      ...(process.env.CODIFIER_HOST_TEST_VSCODE_ARGS ?? "")
        .split(/\s+/)
        .filter(Boolean),
    ],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  children.push(host);
  let hostOutput = "";
  for (const stream of [host.stdout, host.stderr]) {
    stream.on("data", (chunk) => {
      hostOutput += chunk;
      const text = String(chunk);
      for (const line of text.split(/\r?\n/)) {
        if (/^\s*✓|HOST SUITE|Extension codifier|Error|assert/i.test(line))
          console.log(line);
      }
    });
  }
  // A real (unstubbed) dialog would wait forever; never hang the run.
  const timeout = setTimeout(() => {
    console.log("  ✗ Extension Host did not finish within 180 s; stopping it");
    stopAll();
  }, 180_000);
  const exitCode = await new Promise((resolve) => host.on("exit", resolve));
  clearTimeout(timeout);
  if (temporarySuite) fs.rmSync(temporarySuite, { force: true });
  fs.writeFileSync(path.join(tempRoot, "host.log"), hostOutput);
  stopAll();
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Prove the scanner detects a plaintext token before trusting a clean scan.
  const canary = path.join(tempRoot, "canary.txt");
  fs.writeFileSync(canary, `prefix ${token} suffix`);
  if (!filesContaining(tempRoot, token).includes(canary)) {
    throw new Error("Token scanner failed its canary check.");
  }
  fs.rmSync(canary);

  // The token may exist only in VS Code SecretStorage, which encrypts it.
  const leaks = filesContaining(tempRoot, token).filter(
    (file) => path.basename(file) !== "host.log", // our own capture of env-free output
  );
  console.log(
    leaks.length === 0
      ? "  ✓ token absent from the VS Code profile, workspace, and agent log (plaintext and UTF-16)"
      : `  ✗ token found in: ${leaks.join(", ")}`,
  );
  const hostLogLeak = hostOutput.includes(token);
  console.log(
    hostLogLeak
      ? "  ✗ token found in Extension Host output"
      : "  ✓ token absent from Extension Host output",
  );
  console.log(`Artifacts: ${tempRoot} (agent log: ${path.basename(agentLog)})`);

  const passed =
    exitCode === 0 &&
    hostOutput.includes("HOST SUITE PASSED") &&
    leaks.length === 0 &&
    !hostLogLeak;
  if (!passed) {
    // CI has no access to the temporary directory; show the log tails.
    const tail = (file) =>
      fs.existsSync(file)
        ? fs.readFileSync(file, "utf8").split(/\r?\n/).slice(-60).join("\n")
        : "(missing)";
    console.log("--- Extension Host output (last 60 lines) ---");
    console.log(tail(path.join(tempRoot, "host.log")));
    console.log("--- Agent log (last 60 lines) ---");
    console.log(tail(agentLog));
  }
  console.log(passed ? "PASS" : `FAIL (VS Code exit code ${exitCode})`);
  process.exitCode = passed ? 0 : 1;
}

main().catch((error) => {
  console.error(`FAIL - ${error.message}`);
  process.exitCode = 1;
  stopAll();
});
