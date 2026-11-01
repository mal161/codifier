/* global require, module, setTimeout */
/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path");
const {
  agentRequest,
  assertAnalysisJob,
  checkFreshness,
  describeIncompleteAnalysis,
  formatAnalysisReport,
  getGraph,
  normalizeAgentUrl,
  repositoryRelativePath,
  resolveSourcePath,
} = require("./agent.cjs");

const tokenKey = "codifier.agentToken";
const bindingKey = "codifier.repositoryBinding";
const commandIds = [
  "codifier.connect",
  "codifier.status",
  "codifier.analyzeWorkspace",
  "codifier.showArchitectureForCurrentFile",
  "codifier.openSourceFromArchitecture",
];

function activate(context) {
  const vscode = require("vscode");
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 20);
  status.text = "Codifier: Disconnected";
  status.command = "codifier.status";
  status.tooltip = "Connect to the local Codifier agent";
  status.show();
  context.subscriptions.push(status);
  const output = vscode.window.createOutputChannel("Codifier");
  context.subscriptions.push(output);

  const handlers = {
    "codifier.connect": () => connect(vscode, context, status),
    "codifier.status": () => showStatus(vscode, context, status),
    "codifier.analyzeWorkspace": () => analyzeWorkspace(vscode, context, status, output),
    "codifier.showArchitectureForCurrentFile": () => showArchitecture(vscode, context),
    "codifier.openSourceFromArchitecture": () => openSource(vscode, context),
  };
  for (const command of commandIds) {
    context.subscriptions.push(vscode.commands.registerCommand(command, handlers[command]));
  }
}

function deactivate() {}

function agentUrl(vscode) {
  return normalizeAgentUrl(vscode.workspace.getConfiguration("codifier").get("agentUrl", "http://127.0.0.1:4141"));
}

async function tokenFor(context, vscode) {
  const token = await context.secrets.get(tokenKey);
  if (!token) {
    const action = await vscode.window.showErrorMessage("Connect Codifier and enter the local agent token first.", "Connect");
    if (action === "Connect") await vscode.commands.executeCommand("codifier.connect");
    return null;
  }
  return token;
}

async function connect(vscode, context, status) {
  try {
    const baseUrl = agentUrl(vscode);
    const token = await vscode.window.showInputBox({
      title: "Connect to the local Codifier agent",
      prompt: "Paste the agent token. It is stored in VS Code SecretStorage and never placed in a URL or log.",
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => value.trim().length < 32 ? "The token must contain at least 32 characters." : undefined,
    });
    if (!token) return;
    await agentRequest(baseUrl, token.trim(), "/v1/health");
    await context.secrets.store(tokenKey, token.trim());
    status.text = "Codifier: Connected";
    status.tooltip = `Local agent ${baseUrl}`;
    await vscode.window.showInformationMessage("Connected to the local Codifier agent. The token is stored securely by VS Code.");
  } catch (error) {
    status.text = "Codifier: Disconnected";
    status.tooltip = "Codifier agent unavailable";
    reportError(vscode, error);
  }
}

async function showStatus(vscode, context, status) {
  try {
    const token = await tokenFor(context, vscode);
    if (!token) return;
    const baseUrl = agentUrl(vscode);
    await agentRequest(baseUrl, token, "/v1/health");
    const binding = context.globalState.get(bindingKey);
    status.text = "Codifier: Connected";
    status.tooltip = `Local agent ${baseUrl}`;
    const repoDescription = binding?.repositoryId ? `Repository ${binding.repositoryId}` : "No analyzed workspace is linked";
    await vscode.window.showInformationMessage(`Codifier agent is available. ${repoDescription}.`);
  } catch (error) {
    status.text = "Codifier: Disconnected";
    reportError(vscode, error);
  }
}

async function workspaceRoot(vscode) {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) throw new Error("Open a repository folder in VS Code first.");
  if (folders.some((folder) => folder.uri.scheme !== "file")) {
    throw new Error("The local Codifier agent requires a local file-system workspace folder.");
  }
  if (folders.length === 1) return folders[0].uri.fsPath;
  const chosen = await vscode.window.showQuickPick(
    folders.map((folder) => ({ label: folder.name, description: folder.uri.fsPath, path: folder.uri.fsPath })),
    { placeHolder: "Select the repository folder to use with Codifier" },
  );
  if (!chosen) return null;
  return chosen.path;
}

async function analyzeWorkspace(vscode, context, status, output) {
  try {
    const token = await tokenFor(context, vscode);
    if (!token) return;
    const rootPath = await workspaceRoot(vscode);
    if (!rootPath) return;
    const baseUrl = agentUrl(vscode);
    const currentBinding = context.globalState.get(bindingKey);
    const sameRoot = currentBinding?.rootPath === path.resolve(rootPath);
    const endpoint = sameRoot && currentBinding.repositoryId
      ? `/v1/repositories/${encodeURIComponent(currentBinding.repositoryId)}/analysis-jobs`
      : "/v1/analysis-jobs";
    const created = assertAnalysisJob(await agentRequest(baseUrl, token, endpoint, {
      method: "POST",
      body: JSON.stringify({ rootPath }),
    }));
    const repositoryId = created.repositoryId;
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Codifier analysis", cancellable: true },
      async (progress, cancellation) => {
        let job = created;
        while (["queued", "running", "cancelling"].includes(job.status)) {
          if (cancellation.isCancellationRequested) {
            await agentRequest(baseUrl, token, `/v1/analysis-jobs/${encodeURIComponent(job.id)}`, { method: "DELETE" });
            throw new Error("Analysis cancelled. The last committed graph remains available.");
          }
          progress.report({ message: `${job.progress.phase}: ${job.progress.currentFile ?? "working"}` });
          await new Promise((resolve) => setTimeout(resolve, 400));
          job = assertAnalysisJob(await agentRequest(baseUrl, token, `/v1/analysis-jobs/${encodeURIComponent(job.id)}`));
        }
        if (job.status !== "completed" || !job.result) throw new Error(job.error ?? "Codifier analysis did not complete.");
        return job.result;
      },
    );
    output.clear();
    output.appendLine(formatAnalysisReport(result, rootPath));
    if (!result.persisted) {
      const action = await vscode.window.showErrorMessage(describeIncompleteAnalysis(result), "Show Details");
      if (action === "Show Details") output.show(true);
      return;
    }
    await context.globalState.update(bindingKey, { repositoryId, rootPath: path.resolve(rootPath) });
    status.text = "Codifier: Connected";
    await vscode.window.showInformationMessage(`Codifier analyzed this workspace. ${result.coverage.analyzedFiles} source files analyzed; graph ${repositoryId}.`);
  } catch (error) {
    reportError(vscode, error);
  }
}

async function getBoundWorkspace(vscode, context) {
  const token = await tokenFor(context, vscode);
  if (!token) return null;
  const rootPath = await workspaceRoot(vscode);
  if (!rootPath) return null;
  const binding = context.globalState.get(bindingKey);
  if (!binding?.repositoryId || binding.rootPath !== path.resolve(rootPath)) {
    throw new Error("The open workspace does not match the repository linked in Codifier. Run Codifier: Analyze Workspace to bind this folder.");
  }
  const graph = await getGraph(agentUrl(vscode), token, binding.repositoryId);
  return { token, rootPath, binding, graph };
}

async function showArchitecture(vscode, context) {
  try {
    const editor = vscode.window.activeTextEditor;
    if (!editor) throw new Error("Open a source file before looking up its architecture.");
    if (editor.document.uri.scheme !== "file") throw new Error("Architecture lookup is available for local file-system documents.");
    const workspace = await getBoundWorkspace(vscode, context);
    if (!workspace) return;
    const relativePath = repositoryRelativePath(workspace.rootPath, editor.document.uri.fsPath);
    const fileEntity = workspace.graph.entities.find((entity) =>
      entity.kind === "file" && entity.state === "actual" && entity.source?.repositoryRelativePath === relativePath);
    if (!fileEntity) throw new Error(`No analyzed file entry exists for ${relativePath}. Analyze the workspace first.`);
    const freshness = await checkFreshness(agentUrl(vscode), workspace.token, workspace.binding.repositoryId, workspace.rootPath, fileEntity.id);
    if (freshness.status !== "current") {
      await vscode.window.showWarningMessage(`Source ${freshness.status}: ${freshness.message}`);
      return;
    }
    const entities = workspace.graph.entities.filter((entity) =>
      entity.state === "actual" && entity.source?.repositoryRelativePath === relativePath &&
      (entity.kind === "file" || entity.kind === "symbol"));
    if (entities.length === 0) throw new Error(`No analyzed graph items match ${relativePath}. Analyze the workspace after source changes.`);
    const entityById = new Map(workspace.graph.entities.map((entity) => [entity.id, entity]));
    const mappingsByEntity = new Map();
    for (const relationship of workspace.graph.relationships) {
      if (relationship.type !== "MAPS_TO" || relationship.state !== "intended") continue;
      const component = entityById.get(relationship.sourceEntityId);
      if (!component) continue;
      const names = mappingsByEntity.get(relationship.targetEntityId) ?? [];
      names.push(component.name);
      mappingsByEntity.set(relationship.targetEntityId, names);
    }
    const items = entities.map((entity) => ({
      label: `${entity.kind}: ${entity.name}`,
      description: mappingsByEntity.get(entity.id)?.join(", ") ?? "No intended component mapping",
      detail: `${relativePath}:${entity.source.range.start.line}:${entity.source.range.start.column + 1}`,
      entity,
    }));
    const selected = await vscode.window.showQuickPick(items, { placeHolder: "Architecture items for the active source file" });
    if (selected) {
      const mappings = selected.description === "No intended component mapping" ? selected.description : `Mapped to ${selected.description}`;
      await vscode.window.showInformationMessage(`${selected.label} · ${mappings}`);
    }
  } catch (error) {
    reportError(vscode, error);
  }
}

async function openSource(vscode, context) {
  try {
    const workspace = await getBoundWorkspace(vscode, context);
    if (!workspace) return;
    const candidates = workspace.graph.entities.filter((entity) =>
      entity.state === "actual" && entity.source && (entity.kind === "file" || entity.kind === "symbol"));
    const entityById = new Map(workspace.graph.entities.map((entity) => [entity.id, entity]));
    const mappingsByEntity = new Map();
    for (const relationship of workspace.graph.relationships) {
      if (relationship.type !== "MAPS_TO" || relationship.state !== "intended") continue;
      const component = entityById.get(relationship.sourceEntityId);
      if (!component) continue;
      const names = mappingsByEntity.get(relationship.targetEntityId) ?? [];
      names.push(component.name);
      mappingsByEntity.set(relationship.targetEntityId, names);
    }
    const selected = await vscode.window.showQuickPick(
      candidates.map((entity) => ({
        label: `${entity.kind}: ${entity.name}`,
        description: mappingsByEntity.get(entity.id)?.join(", ") ?? "Unmapped",
        detail: `${entity.source.repositoryRelativePath}:${entity.source.range.start.line}:${entity.source.range.start.column + 1}`,
        entity,
      })),
      { placeHolder: "Select an architecture graph item to open in source", matchOnDescription: true },
    );
    if (!selected) return;
    const freshness = await checkFreshness(agentUrl(vscode), workspace.token, workspace.binding.repositoryId, workspace.rootPath, selected.entity.id);
    if (freshness.status !== "current") {
      await vscode.window.showWarningMessage(`Source ${freshness.status}: ${freshness.message}`);
      return;
    }
    const sourcePath = resolveSourcePath(workspace.rootPath, selected.entity.source.repositoryRelativePath);
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(sourcePath));
    const sourceRange = selected.entity.source.range;
    const range = new vscode.Range(
      new vscode.Position(sourceRange.start.line - 1, sourceRange.start.column),
      new vscode.Position(sourceRange.end.line - 1, sourceRange.end.column),
    );
    const editor = await vscode.window.showTextDocument(document, { selection: range, preview: false });
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  } catch (error) {
    reportError(vscode, error);
  }
}

function reportError(vscode, error) {
  const message = error instanceof Error ? error.message : "Codifier failed to complete the request.";
  void vscode.window.showErrorMessage(message);
}

module.exports = { activate, deactivate };
