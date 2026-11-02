import {
  reviewedArchitectureRuleEvaluationSchema,
  ruleExceptionSchema,
  architectureTemplateCatalogSchema,
  analysisJobSchema,
  graphSnapshotSchema,
  installArchitectureTemplateRequestSchema,
  sourceFreshnessResultSchema,
  type ArchitectureTemplate,
  type ReviewedArchitectureRuleEvaluation,
  type RuleException,
  type AnalysisJob,
  type AnalysisJobResult,
} from "@codifier/contracts";
import type { GraphSnapshot } from "@codifier/domain";

export interface AnalysisCoverage {
  filesDiscovered: number;
  supportedFiles: number;
  analyzedFiles: number;
  unsupportedFiles: number;
  skippedFiles: number;
  failedFiles: number;
  excludedDirectories: number;
  truncated: boolean;
}

export interface AnalysisDiagnostic {
  code: string;
  severity: "warning" | "error";
  message: string;
  path?: string;
}

export interface AnalysisResult extends AnalysisJobResult {
  repositoryId: string;
}

export type SourceFreshness = ReturnType<
  typeof sourceFreshnessResultSchema.parse
>;

export function normalizeAgentUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch (cause) {
    throw new Error("Enter a valid local agent URL.", { cause });
  }
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.pathname !== "/" ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error(
      "The agent URL must use HTTP on 127.0.0.1 or localhost, without a path.",
    );
  }
  return url.origin;
}

export async function checkAgent(
  baseUrl: string,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  await request(baseUrl, token, "/v1/health", {}, fetcher);
}

export async function getGraph(
  baseUrl: string,
  token: string,
  repositoryId: string,
  fetcher: typeof fetch = fetch,
): Promise<GraphSnapshot | null> {
  const response = await request(
    baseUrl,
    token,
    `/v1/repositories/${encodeURIComponent(repositoryId)}/graph`,
    {},
    fetcher,
    true,
  );
  if (response === null) {
    return null;
  }
  const parsed = graphSnapshotSchema.safeParse(response);
  if (!parsed.success) {
    throw new Error("The agent returned an invalid graph snapshot.");
  }
  return parsed.data;
}

export async function listArchitectureTemplates(
  baseUrl: string,
  token: string,
  repositoryId?: string,
  fetcher: typeof fetch = fetch,
): Promise<ArchitectureTemplate[]> {
  if (repositoryId && !isRepositoryId(repositoryId)) {
    throw new Error("Enter a valid repository UUID.");
  }
  const query = repositoryId
    ? `?repositoryId=${encodeURIComponent(repositoryId)}`
    : "";
  const response = await request(
    baseUrl,
    token,
    `/v1/marketplace/templates${query}`,
    {},
    fetcher,
  );
  const parsed = architectureTemplateCatalogSchema.safeParse(response);
  if (!parsed.success) {
    throw new Error(
      "The agent returned an invalid architecture template catalog.",
    );
  }
  return parsed.data;
}

export async function installArchitectureTemplate(
  baseUrl: string,
  token: string,
  repositoryId: string,
  templateId: string,
  fetcher: typeof fetch = fetch,
): Promise<GraphSnapshot> {
  if (!isRepositoryId(repositoryId)) {
    throw new Error("Enter a valid repository UUID.");
  }
  const requestBody = installArchitectureTemplateRequestSchema.safeParse({
    templateId,
  });
  if (!requestBody.success) {
    throw new Error("The architecture template ID is invalid.");
  }
  const response = await request(
    baseUrl,
    token,
    `/v1/repositories/${encodeURIComponent(repositoryId)}/marketplace/templates`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody.data),
    },
    fetcher,
  );
  const parsed = graphSnapshotSchema.safeParse(response);
  if (!parsed.success) {
    throw new Error("The agent returned an invalid graph snapshot.");
  }
  return parsed.data;
}

export async function getArchitectureRuleEvaluation(
  baseUrl: string,
  token: string,
  repositoryId: string,
  fetcher: typeof fetch = fetch,
): Promise<ReviewedArchitectureRuleEvaluation> {
  if (!isRepositoryId(repositoryId)) {
    throw new Error("Enter a valid repository UUID.");
  }
  const response = await request(
    baseUrl,
    token,
    `/v1/repositories/${encodeURIComponent(repositoryId)}/architecture-rules`,
    {},
    fetcher,
  );
  const parsed = reviewedArchitectureRuleEvaluationSchema.safeParse(response);
  if (!parsed.success) {
    throw new Error("The agent returned invalid architecture rule findings.");
  }
  return parsed.data;
}

export async function recordRuleException(
  baseUrl: string,
  token: string,
  repositoryId: string,
  input: {
    findingKey: string;
    author: string;
    rationale: string;
    expiresAt: number | null;
  },
  fetcher: typeof fetch = fetch,
): Promise<RuleException> {
  if (!isRepositoryId(repositoryId)) {
    throw new Error("Enter a valid repository UUID.");
  }
  if (!input.author.trim() || !input.rationale.trim()) {
    throw new Error("Enter your name and a rationale for the exception.");
  }
  const response = await request(
    baseUrl,
    token,
    `/v1/repositories/${encodeURIComponent(repositoryId)}/rule-exceptions`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
    fetcher,
  );
  return parseRuleException(response);
}

export async function revokeRuleException(
  baseUrl: string,
  token: string,
  repositoryId: string,
  exceptionId: string,
  input: { revokedBy: string; reason: string },
  fetcher: typeof fetch = fetch,
): Promise<RuleException> {
  if (![repositoryId, exceptionId].every(isRepositoryId)) {
    throw new Error("Repository and exception IDs must be valid UUIDs.");
  }
  if (!input.revokedBy.trim() || !input.reason.trim()) {
    throw new Error("Enter your name and a reason for revoking the exception.");
  }
  const response = await request(
    baseUrl,
    token,
    `/v1/repositories/${encodeURIComponent(repositoryId)}/rule-exceptions/${encodeURIComponent(exceptionId)}/revoke`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
    fetcher,
  );
  return parseRuleException(response);
}

function parseRuleException(response: unknown): RuleException {
  const parsed = ruleExceptionSchema.safeParse(response);
  if (!parsed.success) {
    throw new Error("The agent returned an invalid rule exception.");
  }
  return parsed.data;
}

export async function checkSourceFreshness(
  baseUrl: string,
  token: string,
  repositoryId: string,
  rootPath: string,
  entityId: string,
  fetcher: typeof fetch = fetch,
): Promise<SourceFreshness> {
  if (!isRepositoryId(repositoryId) || !isRepositoryId(entityId)) {
    throw new Error("Repository and entity IDs must be valid UUIDs.");
  }
  const response = await request(
    baseUrl,
    token,
    `/v1/repositories/${encodeURIComponent(repositoryId)}/source-freshness`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rootPath: rootPath.trim(), entityId }),
    },
    fetcher,
  );
  const parsed = sourceFreshnessResultSchema.safeParse(response);
  if (!parsed.success) {
    throw new Error("The agent returned invalid source freshness information.");
  }
  return parsed.data;
}

export async function createIntendedComponent(
  baseUrl: string,
  token: string,
  repositoryId: string,
  name: string,
  fetcher: typeof fetch = fetch,
): Promise<GraphSnapshot> {
  if (!isRepositoryId(repositoryId)) {
    throw new Error("Enter a valid repository UUID.");
  }
  const componentName = name.trim();
  if (!componentName || componentName.length > 120) {
    throw new Error("Component names must be between 1 and 120 characters.");
  }
  const response = await request(
    baseUrl,
    token,
    `/v1/repositories/${encodeURIComponent(repositoryId)}/intended-components`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: componentName }),
    },
    fetcher,
  );
  const parsed = graphSnapshotSchema.safeParse(response);
  if (!parsed.success) {
    throw new Error("The agent returned an invalid graph snapshot.");
  }
  return parsed.data;
}

/** Declares (`add`) or removes an intended dependency between components. */
export async function setIntendedDependency(
  baseUrl: string,
  token: string,
  repositoryId: string,
  componentId: string,
  targetComponentId: string,
  action: "add" | "remove",
  fetcher: typeof fetch = fetch,
): Promise<GraphSnapshot> {
  if (![repositoryId, componentId, targetComponentId].every(isRepositoryId)) {
    throw new Error("Repository and component IDs must be valid UUIDs.");
  }
  if (componentId === targetComponentId) {
    throw new Error("A component cannot depend on itself.");
  }
  const base = `/v1/repositories/${encodeURIComponent(repositoryId)}/intended-components/${encodeURIComponent(componentId)}/dependencies`;
  const response = await request(
    baseUrl,
    token,
    action === "add"
      ? base
      : `${base}/${encodeURIComponent(targetComponentId)}`,
    action === "add"
      ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ targetComponentId }),
        }
      : { method: "DELETE" },
    fetcher,
  );
  const parsed = graphSnapshotSchema.safeParse(response);
  if (!parsed.success) {
    throw new Error("The agent returned an invalid graph snapshot.");
  }
  return parsed.data;
}

export async function mapEntityToIntendedComponent(
  baseUrl: string,
  token: string,
  repositoryId: string,
  componentId: string,
  entityId: string,
  fetcher: typeof fetch = fetch,
): Promise<GraphSnapshot> {
  if (
    !isRepositoryId(repositoryId) ||
    !isRepositoryId(componentId) ||
    !isRepositoryId(entityId)
  ) {
    throw new Error(
      "Repository, component, and entity IDs must be valid UUIDs.",
    );
  }
  const response = await request(
    baseUrl,
    token,
    `/v1/repositories/${encodeURIComponent(repositoryId)}/intended-components/${encodeURIComponent(componentId)}/mappings`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entityId }),
    },
    fetcher,
  );
  const parsed = graphSnapshotSchema.safeParse(response);
  if (!parsed.success) {
    throw new Error("The agent returned an invalid graph snapshot.");
  }
  return parsed.data;
}

export async function removeEntityMapping(
  baseUrl: string,
  token: string,
  repositoryId: string,
  componentId: string,
  entityId: string,
  fetcher: typeof fetch = fetch,
): Promise<GraphSnapshot> {
  if (![repositoryId, componentId, entityId].every(isRepositoryId)) {
    throw new Error(
      "Repository, component, and entity IDs must be valid UUIDs.",
    );
  }
  const response = await request(
    baseUrl,
    token,
    `/v1/repositories/${encodeURIComponent(repositoryId)}/intended-components/${encodeURIComponent(componentId)}/mappings/${encodeURIComponent(entityId)}`,
    { method: "DELETE" },
    fetcher,
  );
  const parsed = graphSnapshotSchema.safeParse(response);
  if (!parsed.success)
    throw new Error("The agent returned an invalid graph snapshot.");
  return parsed.data;
}

export interface GraphRevisionSummary {
  id: string;
  parentRevisionId: string | null;
  sequence: number;
  sourceRevision: string | null;
  restoredFromRevisionId: string | null;
  createdAt: number;
  changeCounts: { added: number; changed: number; removed: number };
}

export async function listGraphRevisions(
  baseUrl: string,
  token: string,
  repositoryId: string,
  fetcher: typeof fetch = fetch,
): Promise<GraphRevisionSummary[]> {
  if (!isRepositoryId(repositoryId)) {
    throw new Error("Repository UUID must be a valid UUID.");
  }
  const response = await request(
    baseUrl,
    token,
    `/v1/repositories/${encodeURIComponent(repositoryId)}/revisions`,
    {},
    fetcher,
  );
  if (!isRecord(response) || !Array.isArray(response.revisions)) {
    throw new Error("The agent returned an invalid revision history.");
  }
  return response.revisions.map((value) => {
    const revision = parseRevisionRecord(value);
    if (!revision) {
      throw new Error("The agent returned an invalid revision history.");
    }
    return revision;
  });
}

export async function restoreGraphRevision(
  baseUrl: string,
  token: string,
  repositoryId: string,
  revisionId: string,
  fetcher: typeof fetch = fetch,
): Promise<{
  status: "restored" | "unchanged";
  revision: GraphRevisionSummary;
  graph: GraphSnapshot;
}> {
  if (![repositoryId, revisionId].every(isRepositoryId)) {
    throw new Error("Repository and revision IDs must be valid UUIDs.");
  }
  const response = await request(
    baseUrl,
    token,
    `/v1/repositories/${encodeURIComponent(repositoryId)}/revisions/${encodeURIComponent(revisionId)}/restore`,
    { method: "POST" },
    fetcher,
  );
  const revision = isRecord(response)
    ? parseRevisionRecord(response.revision)
    : null;
  const graph = isRecord(response)
    ? graphSnapshotSchema.safeParse(response.graph)
    : null;
  if (
    !isRecord(response) ||
    (response.status !== "restored" && response.status !== "unchanged") ||
    !revision ||
    !graph?.success ||
    graph.data.repositoryId !== repositoryId
  ) {
    throw new Error("The agent returned an invalid restore result.");
  }
  return { status: response.status, revision, graph: graph.data };
}

/** Returns the verified history export as formatted JSON text for saving. */
export async function exportGraphHistory(
  baseUrl: string,
  token: string,
  repositoryId: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  if (!isRepositoryId(repositoryId)) {
    throw new Error("Repository UUID must be a valid UUID.");
  }
  const response = await request(
    baseUrl,
    token,
    `/v1/repositories/${encodeURIComponent(repositoryId)}/history/export`,
    {},
    fetcher,
  );
  if (
    !isRecord(response) ||
    response.format !== "codifier.graph-history" ||
    response.formatVersion !== 1 ||
    response.repositoryId !== repositoryId ||
    !Array.isArray(response.revisions)
  ) {
    throw new Error("The agent returned an invalid history export.");
  }
  return `${JSON.stringify(response, null, 2)}
`;
}

function parseRevisionRecord(value: unknown): GraphRevisionSummary | null {
  if (!isRecord(value) || !isRecord(value.changeSummary)) return null;
  const nullableId = (field: unknown) =>
    field === null || (typeof field === "string" && isRepositoryId(field));
  if (
    typeof value.id !== "string" ||
    !isRepositoryId(value.id) ||
    !nullableId(value.parentRevisionId) ||
    !nullableId(value.restoredFromRevisionId ?? null) ||
    !Number.isSafeInteger(value.sequence) ||
    Number(value.sequence) < 1 ||
    !(
      value.sourceRevision === null || typeof value.sourceRevision === "string"
    ) ||
    !Number.isFinite(value.createdAt)
  ) {
    return null;
  }
  const changeCounts = { added: 0, changed: 0, removed: 0 };
  for (const group of ["entities", "relationships", "evidence"] as const) {
    const summary = value.changeSummary[group];
    if (!isRecord(summary)) return null;
    for (const kind of ["added", "changed", "removed"] as const) {
      const ids = summary[kind];
      if (!Array.isArray(ids)) return null;
      changeCounts[kind] += ids.length;
    }
  }
  return {
    id: value.id,
    parentRevisionId: value.parentRevisionId as string | null,
    sequence: Number(value.sequence),
    sourceRevision: value.sourceRevision,
    restoredFromRevisionId:
      (value.restoredFromRevisionId as string | null | undefined) ?? null,
    createdAt: Number(value.createdAt),
    changeCounts,
  };
}

export async function analyzeRepository(
  baseUrl: string,
  token: string,
  rootPath: string,
  repositoryId?: string,
  fetcher: typeof fetch = fetch,
): Promise<AnalysisResult> {
  const path = rootPath.trim();
  if (!path) {
    throw new Error("Enter the full path to a repository folder.");
  }
  if (new TextEncoder().encode(token).length < 32) {
    throw new Error("The agent token must contain at least 32 bytes.");
  }
  if (repositoryId && !isRepositoryId(repositoryId)) {
    throw new Error("Enter a valid repository UUID or leave the field blank.");
  }

  const endpoint = repositoryId
    ? `/v1/repositories/${encodeURIComponent(repositoryId)}/analyze`
    : "/v1/analyze";
  const result = await request(
    baseUrl,
    token,
    endpoint,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rootPath: path }),
    },
    fetcher,
  );
  if (!isAnalysisResult(result)) {
    throw new Error("The agent returned an invalid analysis response.");
  }
  return result;
}

export async function startAnalysisJob(
  baseUrl: string,
  token: string,
  rootPath: string,
  repositoryId?: string,
  fetcher: typeof fetch = fetch,
  policy: { excludePatterns?: string[]; respectGitignore?: boolean } = {},
): Promise<AnalysisJob> {
  const path = rootPath.trim();
  if (!path) {
    throw new Error("Enter the full path to a repository folder.");
  }
  if (new TextEncoder().encode(token).length < 32) {
    throw new Error("The agent token must contain at least 32 bytes.");
  }
  if (repositoryId && !isRepositoryId(repositoryId)) {
    throw new Error("Enter a valid repository UUID or leave the field blank.");
  }
  const endpoint = repositoryId
    ? `/v1/repositories/${encodeURIComponent(repositoryId)}/analysis-jobs`
    : "/v1/analysis-jobs";
  const response = await request(
    baseUrl,
    token,
    endpoint,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        rootPath: path,
        ...policy,
      }),
    },
    fetcher,
  );
  const parsed = analysisJobSchema.safeParse(response);
  if (!parsed.success) {
    throw new Error("The agent returned an invalid analysis job.");
  }
  return parsed.data;
}

export async function getAnalysisJob(
  baseUrl: string,
  token: string,
  jobId: string,
  fetcher: typeof fetch = fetch,
): Promise<AnalysisJob> {
  if (!isRepositoryId(jobId)) {
    throw new Error("The analysis job ID is invalid.");
  }
  const response = await request(
    baseUrl,
    token,
    `/v1/analysis-jobs/${encodeURIComponent(jobId)}`,
    {},
    fetcher,
  );
  const parsed = analysisJobSchema.safeParse(response);
  if (!parsed.success) {
    throw new Error("The agent returned an invalid analysis job.");
  }
  return parsed.data;
}

export async function cancelAnalysisJob(
  baseUrl: string,
  token: string,
  jobId: string,
  fetcher: typeof fetch = fetch,
): Promise<AnalysisJob> {
  if (!isRepositoryId(jobId)) {
    throw new Error("The analysis job ID is invalid.");
  }
  const response = await request(
    baseUrl,
    token,
    `/v1/analysis-jobs/${encodeURIComponent(jobId)}`,
    { method: "DELETE" },
    fetcher,
  );
  const parsed = analysisJobSchema.safeParse(response);
  if (!parsed.success) {
    throw new Error("The agent returned an invalid analysis job.");
  }
  return parsed.data;
}

function isRepositoryId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAnalysisResult(value: unknown): value is AnalysisResult {
  if (!isRecord(value)) {
    return false;
  }
  const coverage = value.coverage;
  if (!isRecord(coverage)) {
    return false;
  }
  const countFields: (keyof AnalysisCoverage)[] = [
    "filesDiscovered",
    "supportedFiles",
    "analyzedFiles",
    "unsupportedFiles",
    "skippedFiles",
    "failedFiles",
    "excludedDirectories",
  ];
  return (
    typeof value.repositoryId === "string" &&
    countFields.every(
      (field) =>
        Number.isSafeInteger(coverage[field]) && Number(coverage[field]) >= 0,
    ) &&
    typeof coverage.truncated === "boolean" &&
    typeof value.repositoryId === "string" &&
    isRepositoryId(value.repositoryId) &&
    Array.isArray(value.diagnostics) &&
    value.diagnostics.every(
      (diagnostic) =>
        isRecord(diagnostic) &&
        typeof diagnostic.code === "string" &&
        (diagnostic.severity === "warning" ||
          diagnostic.severity === "error") &&
        typeof diagnostic.message === "string" &&
        (diagnostic.path === undefined || typeof diagnostic.path === "string"),
    ) &&
    typeof value.diagnosticsTruncated === "boolean" &&
    typeof value.persisted === "boolean"
  );
}

async function request(
  baseUrl: string,
  token: string,
  path: string,
  init: RequestInit,
  fetcher: typeof fetch,
  allowNotFound = false,
): Promise<unknown | null> {
  const normalizedBaseUrl = normalizeAgentUrl(baseUrl);
  if (new TextEncoder().encode(token).length < 32) {
    throw new Error("The agent token must contain at least 32 bytes.");
  }

  let response: Response;
  try {
    response = await fetcher(new URL(path, normalizedBaseUrl), {
      ...init,
      headers: {
        ...init.headers,
        authorization: `Bearer ${token}`,
      },
    });
  } catch (cause) {
    throw new Error(
      "Could not reach the local agent. Check that it is running and that its browser origin is allowed.",
      { cause },
    );
  }

  const body = await response.text();
  if (allowNotFound && response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(agentErrorMessage(response.status, body));
  }
  if (!body) {
    return null;
  }
  try {
    return JSON.parse(body) as unknown;
  } catch (cause) {
    throw new Error("The local agent returned malformed JSON.", { cause });
  }
}

function agentErrorMessage(status: number, body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (isRecord(parsed)) {
      if (typeof parsed.message === "string") {
        return parsed.message;
      }
      if (typeof parsed.error === "string") {
        const messages: Record<string, string> = {
          unauthorized: "The agent token was rejected.",
          origin_not_allowed:
            "This browser origin is not allowed by the local agent.",
          repository_not_found:
            "No saved graph exists for this repository UUID.",
          architecture_template_identity_conflict:
            "A graph item conflicts with this template's stable identity. Review the graph before installing it.",
          architecture_template_not_found:
            "That architecture template is not available in this local catalog.",
        };
        return messages[parsed.error] ?? `The local agent returned ${status}.`;
      }
    }
  } catch {
    return `The local agent returned ${status}: ${body || "request failed"}`;
  }
  return `The local agent returned ${status}: ${body || "request failed"}`;
}
