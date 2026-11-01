/* global require, module, process, fetch, __dirname, console */
/* eslint-disable @typescript-eslint/no-require-imports */
// Runs inside a real VS Code Extension Host (see run.cjs). Commands execute
// against the real local agent; only modal UI (input boxes, quick picks,
// notifications) is replaced so it can be driven and recorded.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");

const token = process.env.CODIFIER_HOST_TEST_TOKEN;
const agentUrl = process.env.CODIFIER_HOST_TEST_AGENT_URL;
const deadAgentUrl = process.env.CODIFIER_HOST_TEST_DEAD_AGENT_URL;
const workspaceA = process.env.CODIFIER_HOST_TEST_WORKSPACE_A;
const workspaceB = process.env.CODIFIER_HOST_TEST_WORKSPACE_B;
const extensionId = "codifier-local.codifier-vscode";
const commands = [
  "codifier.connect",
  "codifier.status",
  "codifier.analyzeWorkspace",
  "codifier.showArchitectureForCurrentFile",
  "codifier.openSourceFromArchitecture",
];

const ui = { inputs: [], picks: [], messages: [], pickRequests: [] };

function installUiStubs() {
  const inputStub = async () => ui.inputs.shift();
  vscode.window.showInputBox = inputStub;
  vscode.window.showQuickPick = async (items, options) => {
    const list = await items;
    ui.pickRequests.push({ placeHolder: options?.placeHolder, items: list });
    const choose = ui.picks.shift();
    if (!choose)
      throw new Error(`Unexpected quick pick: ${options?.placeHolder}`);
    return choose(list);
  };
  for (const [name, level] of [
    ["showInformationMessage", "info"],
    ["showWarningMessage", "warning"],
    ["showErrorMessage", "error"],
  ]) {
    vscode.window[name] = async (message) => {
      ui.messages.push({ level, message });
      return undefined;
    };
  }
  // Fail loudly if the host ever freezes its API objects.
  assert.equal(
    vscode.window.showInputBox,
    inputStub,
    "UI stubs were not installed",
  );
}

// VS Code reports a lower-case drive letter (c:\...); compare like Windows.
const samePath = (left, right) =>
  process.platform === "win32"
    ? path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
    : path.resolve(left) === path.resolve(right);
const pickFolder = (folderPath) => (items) => {
  const item = items.find((candidate) => samePath(candidate.path, folderPath));
  assert.ok(
    item,
    `folder ${folderPath} offered among ${items.map((candidate) => candidate.path).join(" | ")}`,
  );
  return item;
};
const pickLabel = (label) => (items) => {
  const item = items.find((candidate) => candidate.label === label);
  assert.ok(item, `quick pick offers "${label}"`);
  return item;
};

async function run(name, command, setup = {}) {
  ui.messages.length = 0;
  ui.inputs.push(...(setup.inputs ?? []));
  ui.picks.push(...(setup.picks ?? []));
  await vscode.commands.executeCommand(command);
  assert.equal(ui.inputs.length, 0, `${name}: unused input`);
  assert.equal(ui.picks.length, 0, `${name}: unused quick pick`);
  console.log(`  ✓ ${name}`);
  return [...ui.messages];
}

const only = (messages, level) => {
  assert.equal(
    messages.length,
    1,
    `one message, got ${JSON.stringify(messages)}`,
  );
  assert.equal(messages[0].level, level, JSON.stringify(messages));
  return messages[0].message;
};

async function setAgentUrl(url) {
  await vscode.workspace
    .getConfiguration("codifier")
    .update("agentUrl", url, vscode.ConfigurationTarget.Global);
}

async function fetchGraph(repositoryId) {
  const response = await fetch(
    `${agentUrl}/v1/repositories/${repositoryId}/graph`,
    {
      headers: { authorization: `Bearer ${token}` },
    },
  );
  assert.equal(response.status, 200);
  return response.json();
}

async function openFile(relativePath) {
  const document = await vscode.workspace.openTextDocument(
    vscode.Uri.file(path.join(workspaceA, ...relativePath.split("/"))),
  );
  return vscode.window.showTextDocument(document, { preview: false });
}

async function runSuite() {
  for (const value of [token, agentUrl, deadAgentUrl, workspaceA, workspaceB]) {
    assert.ok(value, "host test environment is incomplete");
  }
  const extension = vscode.extensions.getExtension(extensionId);
  assert.ok(extension, `${extensionId} is loaded`);
  // UI stubs only reach the extension when this file runs inside it.
  const insideExtension = path
    .relative(extension.extensionPath, __dirname)
    .split(path.sep)
    .every((part) => part !== "..");
  assert.ok(
    insideExtension,
    `suite must run inside ${extension.extensionPath}`,
  );
  console.log(
    `Extension ${extensionId} ${extension.packageJSON.version} in VS Code ${vscode.version}`,
  );
  installUiStubs();

  const contributed = extension.packageJSON.contributes.commands.map(
    (item) => item.command,
  );
  assert.deepEqual(
    [...contributed].sort(),
    [...commands].sort(),
    "manifest contributes every command",
  );
  // Activation is lazy (onCommand); activate, then confirm handlers exist.
  await extension.activate();
  assert.equal(extension.isActive, true, "extension activates");
  const registered = await vscode.commands.getCommands(true);
  for (const command of commands) {
    assert.ok(
      registered.includes(command),
      `${command} is registered after activation`,
    );
  }

  // Failure: agent unavailable.
  await setAgentUrl(deadAgentUrl);
  assert.match(
    only(
      await run("reports an unavailable agent", "codifier.connect", {
        inputs: [token],
      }),
      "error",
    ),
    /Could not reach the local Codifier agent/,
  );

  // Failure: wrong token is rejected and not stored.
  await setAgentUrl(agentUrl);
  assert.match(
    only(
      await run("rejects a wrong token", "codifier.connect", {
        inputs: ["x".repeat(48)],
      }),
      "error",
    ),
    /rejected the saved token/,
  );
  assert.match(
    only(
      await run("stores no token after a rejected connect", "codifier.status"),
      "error",
    ),
    /Connect Codifier and enter the local agent token first/,
  );

  // Auth: correct token is accepted and stored in SecretStorage.
  assert.match(
    only(
      await run("connects with the agent token", "codifier.connect", {
        inputs: [token],
      }),
      "info",
    ),
    /Connected to the local Codifier agent/,
  );
  assert.match(
    only(await run("reports status", "codifier.status"), "info"),
    /agent is available\. No analyzed workspace is linked/,
  );

  // Failure: graph lookup before this folder is analyzed.
  await openFile("apps/api/src/routes.ts");
  assert.match(
    only(
      await run(
        "refuses lookup before analysis",
        "codifier.showArchitectureForCurrentFile",
        {
          picks: [pickFolder(workspaceA)],
        },
      ),
      "error",
    ),
    /does not match the repository linked/,
  );

  // Analyze through the agent's durable job API.
  const analyzed = only(
    await run("analyzes the workspace", "codifier.analyzeWorkspace", {
      picks: [pickFolder(workspaceA)],
    }),
    "info",
  );
  const repositoryId = analyzed.match(/graph ([0-9a-f-]{36})/)?.[1];
  assert.ok(repositoryId, analyzed);
  const graph = await fetchGraph(repositoryId);
  const createRoutes = graph.entities.find(
    (entity) => entity.kind === "symbol" && entity.name === "createRoutes",
  );
  assert.ok(createRoutes?.source, "createRoutes has a source locator");

  // Lookup: source-to-architecture for the active file.
  await openFile("apps/api/src/routes.ts");
  const lookup = await run(
    "looks up architecture for the active file",
    "codifier.showArchitectureForCurrentFile",
    {
      picks: [pickFolder(workspaceA), pickLabel("symbol: createRoutes")],
    },
  );
  assert.match(
    only(lookup, "info"),
    /symbol: createRoutes · No intended component mapping/,
  );
  const lookupItems = ui.pickRequests.at(-1).items;
  const { start } = createRoutes.source.range;
  assert.ok(
    lookupItems.some(
      (item) =>
        item.detail ===
        `apps/api/src/routes.ts:${start.line}:${start.column + 1}`,
    ),
    "lookup shows the 1-based line and column",
  );

  // Exact range: architecture-to-source opens the recorded range.
  await openFile("apps/api/src/server.ts");
  assert.deepEqual(
    await run(
      "opens the exact source range",
      "codifier.openSourceFromArchitecture",
      {
        picks: [pickFolder(workspaceA), pickLabel("symbol: createRoutes")],
      },
    ),
    [],
  );
  const editor = vscode.window.activeTextEditor;
  assert.ok(editor);
  assert.equal(
    path.resolve(editor.document.uri.fsPath).toLowerCase(),
    path.resolve(workspaceA, "apps", "api", "src", "routes.ts").toLowerCase(),
  );
  const { range } = createRoutes.source;
  assert.deepEqual(
    {
      start: [editor.selection.start.line, editor.selection.start.character],
      end: [editor.selection.end.line, editor.selection.end.character],
    },
    {
      start: [range.start.line - 1, range.start.column],
      end: [range.end.line - 1, range.end.column],
    },
    "selection equals the recorded 0-based-column range",
  );
  assert.equal(
    editor.document
      .getText(editor.selection)
      .trimStart()
      .startsWith("export function createRoutes"),
    true,
    `selected text: ${editor.document.getText(editor.selection).slice(0, 60)}`,
  );

  // Failure: stale source is refused and never redirected.
  await openFile("apps/api/src/server.ts");
  const routesPath = path.join(workspaceA, "apps", "api", "src", "routes.ts");
  fs.appendFileSync(routesPath, "\n// edited after analysis\n");
  assert.match(
    only(
      await run(
        "refuses a stale source location",
        "codifier.openSourceFromArchitecture",
        {
          picks: [pickFolder(workspaceA), pickLabel("symbol: createRoutes")],
        },
      ),
      "warning",
    ),
    /^Source stale:/,
  );
  assert.ok(
    vscode.window.activeTextEditor.document.uri.fsPath.endsWith("server.ts"),
    "a stale location does not open an editor",
  );

  // Failure: a different workspace folder does not use this repository's graph.
  assert.match(
    only(
      await run(
        "refuses a mismatched workspace folder",
        "codifier.openSourceFromArchitecture",
        {
          picks: [pickFolder(workspaceB)],
        },
      ),
      "error",
    ),
    /does not match the repository linked/,
  );

  // Credentials never appear in anything shown to the user.
  const shown = JSON.stringify(ui);
  assert.equal(
    shown.includes(token),
    false,
    "token appears in UI messages or quick picks",
  );
  console.log("  ✓ token absent from every message and quick pick");
}

module.exports = {
  async run() {
    try {
      await runSuite();
      console.log("HOST SUITE PASSED");
    } catch (error) {
      console.error("HOST SUITE FAILED:", error);
      console.error("Last messages:", JSON.stringify(ui.messages));
      throw error;
    }
  },
};
