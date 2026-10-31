/* eslint-disable @typescript-eslint/no-require-imports */
import { describe, expect, it, vi } from "vitest";

// The extension host supplies the VS Code module; these tests exercise its pure local-agent boundary.
const {
  agentRequest,
  assertAnalysisJob,
  assertGraphSnapshot,
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
});
