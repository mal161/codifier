/* eslint-disable @typescript-eslint/no-require-imports */
import { describe, expect, it, vi } from "vitest";

// The extension host supplies the VS Code module; these tests exercise its pure local-agent boundary.
const {
  agentRequest,
  assertAnalysisJob,
  assertGraphSnapshot,
  describeIncompleteAnalysis,
  formatAnalysisReport,
  normalizeAgentUrl,
  repositoryRelativePath,
  resolveSourcePath,
} = require("../src/agent.cjs") as {
  agentRequest: (
    baseUrl: string,
    token: string,
    endpoint: string,
    options: Record<string, unknown>,
    fetcher: typeof fetch,
  ) => Promise<unknown>;
  assertAnalysisJob: (value: unknown) => unknown;
  assertGraphSnapshot: (value: unknown) => unknown;
  describeIncompleteAnalysis: (result: unknown) => string;
  formatAnalysisReport: (result: unknown, rootPath: string) => string;
  normalizeAgentUrl: (value: string) => string;
  repositoryRelativePath: (root: string, file: string) => string;
  resolveSourcePath: (root: string, relativePath: string) => string;
};
const path = require("node:path") as typeof import("node:path");

describe("VS Code extension agent boundary", () => {
  it("accepts loopback HTTP agent URLs only", () => {
    expect(normalizeAgentUrl(" http://127.0.0.1:4141 ")).toBe(
      "http://127.0.0.1:4141",
    );
    expect(normalizeAgentUrl("http://localhost:4141/")).toBe(
      "http://localhost:4141",
    );
    for (const value of [
      "https://127.0.0.1:4141",
      "http://example.com:4141",
      "http://user:secret@127.0.0.1:4141",
      "http://127.0.0.1:4141/other",
      "http://127.0.0.1:4141/?token=secret",
    ]) {
      expect(() => normalizeAgentUrl(value)).toThrow();
    }
  });

  it("keeps source paths within the selected repository", () => {
    const root = path.resolve("codifier-test-root");
    const source = path.join(root, "src", "main.ts");
    expect(repositoryRelativePath(root, source)).toBe(
      "src/main.ts",
    );
    expect(() => repositoryRelativePath(root, path.resolve("outside.ts"))).toThrow(
      "outside the selected workspace",
    );
    expect(() => resolveSourcePath(root, "../secrets.txt")).toThrow();
    expect(resolveSourcePath(root, "src/main.ts")).toBe(source);
  });

  it("keeps credentials out of the request URL and reports authentication failures clearly", async () => {
    const fetcher = vi.fn(async (url: URL, init: RequestInit) => {
      expect(url.toString()).toBe("http://127.0.0.1:4141/v1/health");
      expect(url.toString()).not.toContain("secret-token");
      expect(new Headers(init.headers).get("authorization")).toBe(
        "Bearer secret-token",
      );
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
      });
    });

    await expect(
      agentRequest(
        "http://127.0.0.1:4141",
        "secret-token",
        "/v1/health",
        {},
        fetcher as typeof fetch,
      ),
    ).rejects.toMatchObject({
      name: "AgentError",
      status: 401,
      message: expect.stringContaining("rejected the saved token"),
    });
  });

  it("validates graph and analysis responses before using them", () => {
    expect(() => assertAnalysisJob({ id: "bad" })).toThrow("invalid analysis job");
    expect(() => assertGraphSnapshot({ schemaVersion: 1, entities: [] })).toThrow(
      "invalid graph snapshot",
    );
  });

  const blockedResult = {
    persisted: false,
    coverage: {
      analyzedFiles: 53,
      skippedFiles: 1,
      failedFiles: 0,
      unsupportedFiles: 115,
      truncated: false,
    },
    diagnostics: [
      {
        code: "file_too_large",
        severity: "warning",
        message: "File exceeds the 1048576-byte analysis limit.",
        path: "debug.log",
      },
    ],
    diagnosticsTruncated: true,
    persistBlockers: [
      {
        reason: "skipped_files",
        count: 1,
        message:
          "1 file was skipped because of size limits, read errors, or unsafe paths.",
        examples: [{ path: "debug.log", code: "file_too_large" }],
      },
    ],
  };

  it("names the reasons an analysis was not saved", () => {
    expect(describeIncompleteAnalysis(blockedResult)).toBe(
      "Analysis was incomplete; the saved graph was left unchanged. 1 file was skipped because of size limits, read errors, or unsafe paths. Examples: debug.log (file_too_large).",
    );
  });

  it("points to a stale agent when no reasons are reported", () => {
    const { persistBlockers: _omitted, ...legacy } = blockedResult;
    void _omitted;
    expect(describeIncompleteAnalysis(legacy)).toContain(
      "restart the local agent",
    );
  });

  it("formats a full analysis report for the output channel", () => {
    const report = formatAnalysisReport(blockedResult, "C:\\repo");

    expect(report).toContain("Saved: no");
    expect(report).toContain(
      "53 analyzed, 1 skipped, 0 failed, 115 unsupported; inventory complete.",
    );
    expect(report).toContain("Why the graph was not saved:");
    expect(report).toContain("    debug.log (file_too_large)");
    expect(report).toContain("Diagnostics (1, truncated):");
    expect(report).toContain(
      "- warning file_too_large debug.log: File exceeds the 1048576-byte analysis limit.",
    );
  });
});
