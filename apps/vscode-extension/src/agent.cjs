/* global URL, fetch, AbortSignal, require, module */
/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path");

class AgentError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "AgentError";
    this.status = status;
  }
}

function normalizeAgentUrl(value) {
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    throw new Error("Enter a valid local Codifier agent URL.");
  }
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname) ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new Error("Codifier connects only to an HTTP loopback agent URL without a path.");
  }
  return url.origin;
}

function repositoryRelativePath(rootPath, filePath) {
  const root = path.resolve(rootPath);
  const file = path.resolve(filePath);
  const relative = path.relative(root, file);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("The active file is outside the selected workspace folder.");
  }
  return relative.split(path.sep).join("/");
}

function resolveSourcePath(rootPath, relativePath) {
  if (
    typeof relativePath !== "string" ||
    !relativePath ||
    relativePath.startsWith("/") ||
    relativePath.includes("\\") ||
    relativePath.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("The graph contains an invalid repository-relative source path.");
  }
  const root = path.resolve(rootPath);
  const file = path.resolve(root, ...relativePath.split("/"));
  const relative = path.relative(root, file);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("The source location escapes the selected workspace folder.");
  }
  return file;
}

async function agentRequest(baseUrl, token, endpoint, options = {}, fetcher = fetch) {
  const url = new URL(endpoint, normalizeAgentUrl(baseUrl));
  let response;
  try {
    response = await fetcher(url, {
      ...options,
      signal: options.signal ?? AbortSignal.timeout(15_000),
      headers: {
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...options.headers,
        authorization: `Bearer ${token}`,
      },
    });
  } catch (error) {
    if (error && error.name === "TimeoutError") {
      throw new Error("The local Codifier agent did not respond before the request timed out.", { cause: error });
    }
    throw new Error("Could not reach the local Codifier agent. Check that it is running.", { cause: error });
  }
  if (!response.ok) {
    if (response.status === 401) throw new AgentError("The agent rejected the saved token. Connect again with the correct token.", 401);
    if (response.status === 403) throw new AgentError("The agent rejected this VS Code request. Check its local access policy.", 403);
    if (response.status === 404) throw new AgentError("The selected repository or graph item was not found. Analyze this workspace again.", 404);
    const payload = await response.json().catch(() => ({}));
    const detail = typeof payload.message === "string" ? ` ${payload.message}` : "";
    throw new AgentError(`The Codifier agent returned HTTP ${response.status}.${detail}`, response.status);
  }
  if (response.status === 204) return null;
  try {
    return await response.json();
  } catch {
    throw new Error("The Codifier agent returned an unreadable response.");
  }
}

async function getGraph(baseUrl, token, repositoryId) {
  return assertGraphSnapshot(await agentRequest(baseUrl, token, `/v1/repositories/${encodeURIComponent(repositoryId)}/graph`));
}

async function checkFreshness(baseUrl, token, repositoryId, rootPath, entityId) {
  const result = await agentRequest(
    baseUrl,
    token,
    `/v1/repositories/${encodeURIComponent(repositoryId)}/source-freshness`,
    { method: "POST", body: JSON.stringify({ rootPath, entityId }) },
  );
  return assertSourceFreshness(result);
}

function assertSourceFreshness(value) {
  if (!isObject(value) || !["current", "stale", "unresolved"].includes(value.status) || typeof value.message !== "string") {
    throw new Error("The Codifier agent returned invalid source freshness information.");
  }
  return value;
}

function assertAnalysisJob(value) {
  if (
    !isObject(value) ||
    !isUuid(value.id) ||
    !isUuid(value.repositoryId) ||
    !["queued", "running", "cancelling", "cancelled", "completed", "failed"].includes(value.status) ||
    !isObject(value.progress) ||
    typeof value.progress.phase !== "string" ||
    !Number.isSafeInteger(value.progress.completedFiles)
  ) {
    throw new Error("The Codifier agent returned an invalid analysis job response.");
  }
  return value;
}

function assertGraphSnapshot(value) {
  if (
    !isObject(value) ||
    value.schemaVersion !== 1 ||
    !isUuid(value.repositoryId) ||
    !Array.isArray(value.entities) ||
    !Array.isArray(value.relationships) ||
    !Array.isArray(value.evidence)
  ) {
    throw new Error("The Codifier agent returned an invalid graph snapshot.");
  }
  for (const entity of value.entities) {
    if (!isObject(entity) || !isUuid(entity.id) || typeof entity.kind !== "string" || typeof entity.name !== "string" || !["actual", "intended"].includes(entity.state) || !Array.isArray(entity.evidenceIds) || !entity.evidenceIds.every(isUuid) || (entity.source !== undefined && !isLocator(entity.source))) {
      throw new Error("The Codifier agent returned an invalid graph entity.");
    }
  }
  for (const relationship of value.relationships) {
    if (!isObject(relationship) || !isUuid(relationship.id) || !isUuid(relationship.sourceEntityId) || !isUuid(relationship.targetEntityId) || typeof relationship.type !== "string" || !["actual", "intended"].includes(relationship.state) || !Array.isArray(relationship.evidenceIds) || !relationship.evidenceIds.every(isUuid)) {
      throw new Error("The Codifier agent returned an invalid graph relationship.");
    }
  }
  return value;
}

function isLocator(value) {
  return isObject(value) &&
    isUuid(value.repositoryId) &&
    typeof value.repositoryRelativePath === "string" &&
    !value.repositoryRelativePath.startsWith("/") &&
    !value.repositoryRelativePath.includes("\\") &&
    isObject(value.range) &&
    isPosition(value.range.start) &&
    isPosition(value.range.end);
}

function isPosition(value) {
  return isObject(value) && Number.isSafeInteger(value.line) && value.line > 0 && Number.isSafeInteger(value.column) && value.column >= 0;
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

module.exports = {
  AgentError,
  assertAnalysisJob,
  assertGraphSnapshot,
  assertSourceFreshness,
  agentRequest,
  checkFreshness,
  getGraph,
  normalizeAgentUrl,
  repositoryRelativePath,
  resolveSourcePath,
};
