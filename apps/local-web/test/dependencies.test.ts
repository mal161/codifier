import { describe, expect, it, vi } from "vitest";
import { setIntendedDependency } from "../src/agent/client.js";

const token = "this-is-a-test-token-with-at-least-32-bytes";
const baseUrl = "http://127.0.0.1:4141";
const repositoryId = "7b9442d6-faaa-49f9-a39e-7de8a276a978";
const api = "d1a1d2e3-7f6a-4a5b-8c9d-0123456789ab";
const domain = "d2a1d2e3-7f6a-4a5b-8c9d-0123456789ab";
const graph = {
  schemaVersion: 1,
  repositoryId,
  revision: null,
  entities: [],
  evidence: [],
  relationships: [],
};

describe("intended dependency client", () => {
  it("posts a new dependency and deletes an existing one", async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      calls.push({
        method: init?.method ?? "GET",
        path: new URL(String(input)).pathname,
        ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
      });
      return new Response(JSON.stringify(graph), { status: 200 });
    });

    await setIntendedDependency(
      baseUrl,
      token,
      repositoryId,
      api,
      domain,
      "add",
      fetcher,
    );
    await setIntendedDependency(
      baseUrl,
      token,
      repositoryId,
      api,
      domain,
      "remove",
      fetcher,
    );

    const base = `/v1/repositories/${repositoryId}/intended-components/${api}/dependencies`;
    expect(calls).toEqual([
      { method: "POST", path: base, body: { targetComponentId: domain } },
      { method: "DELETE", path: `${base}/${domain}` },
    ]);
  });

  it("rejects self-dependencies and invalid IDs before contacting the agent", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      setIntendedDependency(
        baseUrl,
        token,
        repositoryId,
        api,
        api,
        "add",
        fetcher,
      ),
    ).rejects.toThrow("cannot depend on itself");
    await expect(
      setIntendedDependency(
        baseUrl,
        token,
        repositoryId,
        "nope",
        domain,
        "add",
        fetcher,
      ),
    ).rejects.toThrow("valid UUIDs");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refuses a malformed graph response", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    await expect(
      setIntendedDependency(
        baseUrl,
        token,
        repositoryId,
        api,
        domain,
        "add",
        fetcher,
      ),
    ).rejects.toThrow("invalid graph snapshot");
  });
});
