import { describe, expect, it, vi } from "vitest";
import {
  analyzeRepository,
  cancelAnalysisJob,
  checkAgent,
  getAnalysisJob,
  getGraph,
  normalizeAgentUrl,
  startAnalysisJob,
} from "../src/agent/client.js";

const token = "this-is-a-test-token-with-at-least-32-bytes";
const repositoryId = "7b9442d6-faaa-49f9-a39e-7de8a276a978";
const jobId = "c4f1cb1e-74ba-4de6-b0ac-1838cc5a1124";
const baseUrl = "http://127.0.0.1:4141";

function analysisJob(status = "running") {
  return {
    id: jobId,
    repositoryId,
    status,
    progress: {
      phase: "reading",
      currentFile: "src/index.ts",
      completedFiles: 1,
      totalFiles: 3,
    },
  };
}

function graphSnapshot() {
  return {
    schemaVersion: 1,
    repositoryId,
    revision: null,
    entities: [],
    evidence: [],
    relationships: [],
  };
}

describe("local agent client", () => {
  it("only accepts loopback HTTP agent addresses", () => {
    expect(normalizeAgentUrl("http://localhost:4141/")).toBe(
      "http://localhost:4141",
    );
    expect(() => normalizeAgentUrl("https://127.0.0.1:4141")).toThrow(
      "must use HTTP on 127.0.0.1 or localhost",
    );
    expect(() => normalizeAgentUrl("http://example.com")).toThrow(
      "must use HTTP on 127.0.0.1 or localhost",
    );
    expect(() => normalizeAgentUrl("http://127.0.0.1:4141/api")).toThrow(
      "without a path",
    );
  });

  it("authenticates health requests without persisting the token", async () => {
    const fetcher: typeof fetch = vi.fn(async (_input, init) => {
      expect(new Headers(init?.headers).get("authorization")).toBe(
        `Bearer ${token}`,
      );
      return new Response('{"status":"ok"}', { status: 200 });
    });

    await expect(checkAgent(baseUrl, token, fetcher)).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("validates analysis responses and sends the requested path", async () => {
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      expect(new URL(String(input)).pathname).toBe("/v1/analyze");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        rootPath: "C:\\projects\\sample",
      });
      return new Response(
        JSON.stringify({
          repositoryId,
          coverage: {
            filesDiscovered: 2,
            supportedFiles: 2,
            analyzedFiles: 2,
            unsupportedFiles: 0,
            skippedFiles: 0,
            failedFiles: 0,
            excludedDirectories: 0,
            truncated: false,
          },
          diagnostics: [],
          diagnosticsTruncated: false,
          persisted: true,
        }),
        { status: 200 },
      );
    });

    const result = await analyzeRepository(
      baseUrl,
      token,
      " C:\\projects\\sample ",
      undefined,
      fetcher,
    );

    expect(result.repositoryId).toBe(repositoryId);
    expect(result.persisted).toBe(true);
  });

  it("rejects malformed agent analysis responses", async () => {
    const fetcher: typeof fetch = vi.fn(
      async () => new Response('{"repositoryId":"invalid"}', { status: 200 }),
    );

    await expect(
      analyzeRepository(
        baseUrl,
        token,
        "C:\\projects\\sample",
        undefined,
        fetcher,
      ),
    ).rejects.toThrow("invalid analysis response");
  });

  it("starts and polls a validated analysis job", async () => {
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/v1/analysis-jobs");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        rootPath: "C:\\projects\\sample",
      });
      return new Response(JSON.stringify(analysisJob()), { status: 202 });
    });

    await expect(
      startAnalysisJob(
        baseUrl,
        token,
        " C:\\projects\\sample ",
        undefined,
        fetcher,
      ),
    ).resolves.toMatchObject({ id: jobId, status: "running" });

    const poller: typeof fetch = vi.fn(
      async () => new Response(JSON.stringify(analysisJob()), { status: 200 }),
    );
    await expect(
      getAnalysisJob(baseUrl, token, jobId, poller),
    ).resolves.toMatchObject({ progress: { completedFiles: 1 } });
  });

  it("sends an authenticated cancellation request and validates its response", async () => {
    const cancelledJob = {
      ...analysisJob("cancelling"),
      status: "cancelled",
      progress: {
        phase: "cancelled",
        currentFile: null,
        completedFiles: 1,
        totalFiles: 3,
      },
    };
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      expect(new URL(String(input)).pathname).toBe(
        `/v1/analysis-jobs/${jobId}`,
      );
      expect(init?.method).toBe("DELETE");
      return new Response(JSON.stringify(cancelledJob), { status: 200 });
    });

    await expect(
      cancelAnalysisJob(baseUrl, token, jobId, fetcher),
    ).resolves.toMatchObject({ status: "cancelled" });
  });

  it("validates returned graph snapshots and treats a missing graph as absent", async () => {
    const validFetcher: typeof fetch = vi.fn(
      async () =>
        new Response(JSON.stringify(graphSnapshot()), { status: 200 }),
    );
    await expect(
      getGraph(baseUrl, token, repositoryId, validFetcher),
    ).resolves.toEqual(graphSnapshot());

    const missingFetcher: typeof fetch = vi.fn(
      async () =>
        new Response('{"error":"repository_not_found"}', { status: 404 }),
    );
    await expect(
      getGraph(baseUrl, token, repositoryId, missingFetcher),
    ).resolves.toBeNull();
  });

  it("gives a clear message when the agent rejects the token", async () => {
    const fetcher: typeof fetch = vi.fn(
      async () =>
        new Response('{"error":"unauthorized"}', {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
    );
    await expect(checkAgent(baseUrl, token, fetcher)).rejects.toThrow(
      "The agent token was rejected.",
    );
  });
});
