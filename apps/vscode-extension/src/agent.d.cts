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
  describeIncompleteAnalysis(result: unknown): string;
  formatAnalysisReport(result: unknown, rootPath: string): string;
  normalizeAgentUrl(value: string): string;
  repositoryRelativePath(root: string, file: string): string;
  resolveSourcePath(root: string, relativePath: string): string;
};

export = agent;
