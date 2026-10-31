declare const agent: {
  agentRequest(
    baseUrl: string,
    token: string,
    endpoint: string,
    options: Record<string, unknown>,
    fetcher: typeof fetch,
  ): Promise<unknown>;
  assertAnalysisJob(value: unknown): unknown;
  assertGraphSnapshot(value: unknown): unknown;
  normalizeAgentUrl(value: string): string;
  repositoryRelativePath(root: string, file: string): string;
  resolveSourcePath(root: string, relativePath: string): string;
};

export = agent;
