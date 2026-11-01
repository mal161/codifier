import { describe, expect, it, vi } from "vitest";
import {
  exportGraphHistory,
  listGraphRevisions,
  restoreGraphRevision,
} from "../src/agent/client.js";

const token = "this-is-a-test-token-with-at-least-32-bytes";
const repositoryId = "7b9442d6-faaa-49f9-a39e-7de8a276a978";
const firstId = "0c2d4f61-9c2e-4d6b-a8a4-6c3f2b9f4a01";
const restoredId = "0c2d4f61-9c2e-4d6b-a8a4-6c3f2b9f4a03";
const baseUrl = "http://127.0.0.1:4141";

function revision(id: string, sequence: number, restoredFrom: string | null) {
  return {
    id,
    repositoryId,
    parentRevisionId: sequence === 1 ? null : firstId,
    sequence,
    sourceRevision: "a1b2c3d",
    contentHash: "hash",
    changeSummary: {
      entities: { added: ["a", "b"], changed: ["c"], removed: [] },
      relationships: { added: [], changed: [], removed: ["d"] },
      evidence: { added: ["e"], changed: [], removed: [] },
    },
    restoredFromRevisionId: restoredFrom,
    createdAt: 1_793_560_000_000,
  };
}

function graph() {
  return {
    schemaVersion: 1,
    repositoryId,
    revision: null,
    entities: [],
    evidence: [],
    relationships: [],
  };
}

function respondWith(body: unknown, status = 200) {
  return vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify(body), { status }),
  );
}

describe("graph history client", () => {
  it("lists revisions with aggregated change counts", async () => {
    const fetcher = respondWith({
      revisions: [revision(firstId, 1, null), revision(restoredId, 3, firstId)],
    });

    const revisions = await listGraphRevisions(
      baseUrl,
      token,
      repositoryId,
      fetcher,
    );

    expect(String(fetcher.mock.calls[0]![0])).toBe(
      `${baseUrl}/v1/repositories/${repositoryId}/revisions`,
    );
    expect(revisions[1]).toEqual({
      id: restoredId,
      parentRevisionId: firstId,
      sequence: 3,
      sourceRevision: "a1b2c3d",
      restoredFromRevisionId: firstId,
      createdAt: 1_793_560_000_000,
      changeCounts: { added: 3, changed: 1, removed: 1 },
    });
  });

  it("rejects malformed revision records", async () => {
    const fetcher = respondWith({
      revisions: [{ ...revision(firstId, 1, null), sequence: 0 }],
    });
    await expect(
      listGraphRevisions(baseUrl, token, repositoryId, fetcher),
    ).rejects.toThrow("invalid revision history");
  });

  it("posts a restore and validates the returned graph", async () => {
    const fetcher = respondWith({
      status: "restored",
      revision: revision(restoredId, 3, firstId),
      graph: graph(),
    });

    const result = await restoreGraphRevision(
      baseUrl,
      token,
      repositoryId,
      firstId,
      fetcher,
    );

    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe(
      `${baseUrl}/v1/repositories/${repositoryId}/revisions/${firstId}/restore`,
    );
    expect(init?.method).toBe("POST");
    expect(result.status).toBe("restored");
    expect(result.revision.restoredFromRevisionId).toBe(firstId);
    expect(result.graph).toEqual(graph());
  });

  it("refuses a restore result for a different repository", async () => {
    const fetcher = respondWith({
      status: "restored",
      revision: revision(restoredId, 3, firstId),
      graph: { ...graph(), repositoryId: firstId },
    });
    await expect(
      restoreGraphRevision(baseUrl, token, repositoryId, firstId, fetcher),
    ).rejects.toThrow("invalid restore result");
  });

  it("surfaces the agent's message when analysis blocks a restore", async () => {
    const fetcher = respondWith(
      {
        error: "analysis_already_running",
        message:
          "Wait for or cancel the running analysis before restoring a revision.",
      },
      409,
    );
    await expect(
      restoreGraphRevision(baseUrl, token, repositoryId, firstId, fetcher),
    ).rejects.toThrow("Wait for or cancel the running analysis");
  });

  it("validates identifiers before contacting the agent", async () => {
    const fetcher = respondWith({});
    await expect(
      restoreGraphRevision(baseUrl, token, repositoryId, "not-a-uuid", fetcher),
    ).rejects.toThrow("valid UUIDs");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns an export only when it matches the expected format", async () => {
    const exported = {
      format: "codifier.graph-history",
      formatVersion: 1,
      repositoryId,
      currentRevisionId: firstId,
      exportedAt: 1,
      revisions: [{ ...revision(firstId, 1, null), snapshot: graph() }],
    };
    const text = await exportGraphHistory(
      baseUrl,
      token,
      repositoryId,
      respondWith(exported),
    );
    expect(JSON.parse(text)).toEqual(exported);

    await expect(
      exportGraphHistory(
        baseUrl,
        token,
        repositoryId,
        respondWith({ ...exported, format: "other" }),
      ),
    ).rejects.toThrow("invalid history export");
  });
});
