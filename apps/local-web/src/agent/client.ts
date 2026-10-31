import {
  architectureRuleEvaluationSchema,
  architectureTemplateCatalogSchema,
  analysisJobSchema,
  graphSnapshotSchema,
  installArchitectureTemplateRequestSchema,
  sourceFreshnessResultSchema,
  type ArchitectureTemplate,
  type ArchitectureRuleEvaluation,
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

export type SourceFreshness = ReturnType<typeof sourceFreshnessResultSchema.parse>;

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
): Promise<ArchitectureRuleEvaluation> {
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
  const parsed = architectureRuleEvaluationSchema.safeParse(response);
  if (!parsed.success) {
    throw new Error("The agent returned invalid architecture rule findings.");
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
    throw new Error("Repository, component, and entity IDs must be valid UUIDs.");
  }
  const response = await request(
    baseUrl,
    token,
    `/v1/repositories/${encodeURIComponent(repositoryId)}/intended-components/${encodeURIComponent(componentId)}/mappings/${encodeURIComponent(entityId)}`,
    { method: "DELETE" },
    fetcher,
  );
  const parsed = graphSnapshotSchema.safeParse(response);
  if (!parsed.success) throw new Error("The agent returned an invalid graph snapshot.");
  return parsed.data;
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
