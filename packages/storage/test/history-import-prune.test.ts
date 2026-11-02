import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GraphSnapshot } from "@codifier/domain";
import {
  GraphHistoryError,
  openGraphStore,
  type GraphHistoryExport,
  type GraphStore,
} from "../src/index.js";

const repositoryId = "7b9442d6-faaa-49f9-a39e-7de8a276a978";
const entityId = "9ac38590-a7ac-4101-bfc9-dc323d1c9301";
const evidenceId = "05a4d48e-1e17-4ca7-9e03-773ea13d3561";
const directories: string[] = [];
const stores: GraphStore[] = [];

function open(): GraphStore {
  const directory = mkdtempSync(join(tmpdir(), "codifier-history-test-"));
  directories.push(directory);
  const store = openGraphStore(join(directory, "graph.sqlite"));
  stores.push(store);
  return store;
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function snapshot(name: string): GraphSnapshot {
  return {
    schemaVersion: 1,
    repositoryId,
    revision: name,
    entities: [
      {
        id: entityId,
        kind: "repository",
        name,
        state: "actual",
        evidenceIds: [evidenceId],
      },
    ],
    evidence: [
      { id: evidenceId, origin: "developer", description: "Registered." },
    ],
    relationships: [],
  };
}

/** A store with revisions named r1..rN; returns the store and its export. */
function withHistory(count: number): {
  store: GraphStore;
  exported: GraphHistoryExport;
} {
  const store = open();
  for (let index = 1; index <= count; index += 1) {
    store.replaceGraph(snapshot(`r${index}`));
  }
  return { store, exported: store.exportGraphHistory(repositoryId)! };
}

describe("history import", () => {
  it("restores a full history into a database that lacks the repository", () => {
    const { store: source, exported } = withHistory(3);
    const [first] = source.listGraphRevisions(repositoryId);
    source.restoreGraphRevision(repositoryId, first!.id);
    const full = source.exportGraphHistory(repositoryId)!;

    const target = open();
    const result = target.importGraphHistory(full);

    expect(result).toEqual({
      repositoryId,
      revisionCount: 4,
      currentRevisionId: full.currentRevisionId,
    });
    expect(target.getGraph(repositoryId)).toEqual(snapshot("r1"));
    expect(target.listGraphRevisions(repositoryId)).toEqual(
      source.listGraphRevisions(repositoryId),
    );
    // The imported history keeps working: a new commit continues the chain.
    target.replaceGraph(snapshot("after-import"));
    expect(target.listGraphRevisions(repositoryId).at(-1)).toMatchObject({
      sequence: 5,
      parentRevisionId: full.currentRevisionId,
    });
    expect(exported.revisions).toHaveLength(3);
  });

  it("refuses a repository that already exists here", () => {
    const { store, exported } = withHistory(2);
    expect(() => store.importGraphHistory(exported)).toThrow(
      expect.objectContaining({ code: "repository_exists" }),
    );
  });

  it("refuses identifiers already used by another repository", () => {
    const { exported } = withHistory(1);
    const target = open();
    const otherRepository = "11111111-1111-4111-8111-111111111111";
    const otherEvidence = "22222222-2222-4222-8222-222222222222";
    // Another repository already owns the export's entity ID.
    target.replaceGraph({
      schemaVersion: 1,
      repositoryId: otherRepository,
      revision: null,
      entities: [
        {
          id: entityId,
          kind: "repository",
          name: "other",
          state: "actual",
          evidenceIds: [otherEvidence],
        },
      ],
      evidence: [
        { id: otherEvidence, origin: "developer", description: "Other." },
      ],
      relationships: [],
    });

    expect(() => target.importGraphHistory(exported)).toThrow(
      expect.objectContaining({ code: "identifier_in_use" }),
    );
    expect(target.getGraph(repositoryId)).toBeNull();
    expect(target.getGraph(otherRepository)).not.toBeNull();
  });

  it("rejects tampered, reordered, or inconsistent exports without writing", () => {
    const { exported } = withHistory(3);
    const target = open();
    const cases: Array<[string, GraphHistoryExport]> = [
      [
        "content hash",
        {
          ...exported,
          revisions: exported.revisions.map((revision, index) =>
            index === 1
              ? { ...revision, snapshot: snapshot("forged") }
              : revision,
          ),
        },
      ],
      [
        "previous revision",
        {
          ...exported,
          revisions: exported.revisions.map((revision, index) =>
            index === 2
              ? { ...revision, parentRevisionId: exported.revisions[0]!.id }
              : revision,
          ),
        },
      ],
      [
        "latest revision",
        { ...exported, currentRevisionId: exported.revisions[0]!.id },
      ],
      [
        "format version 1",
        { ...exported, format: "other" } as unknown as GraphHistoryExport,
      ],
      ["no revisions", { ...exported, revisions: [] }],
    ];
    for (const [message, history] of cases) {
      expect(() => target.importGraphHistory(history), message).toThrow(
        message,
      );
      expect(target.getGraph(repositoryId)).toBeNull();
    }
  });
});

describe("history prune", () => {
  it("keeps the most recent N revisions and records an audit entry", () => {
    const { store } = withHistory(5);
    const result = store.pruneGraphRevisions(repositoryId, { keepLast: 2 })!;

    expect(result).toMatchObject({
      removedCount: 3,
      keptCount: 2,
      oldestKeptSequence: 4,
    });
    const remaining = store.listGraphRevisions(repositoryId);
    expect(remaining.map(({ sequence }) => sequence)).toEqual([4, 5]);
    expect(remaining[0]!.parentRevisionId).toBeNull();
    expect(store.getGraph(repositoryId)).toEqual(snapshot("r5"));
    expect(store.listGraphHistoryPrunes(repositoryId)).toEqual([
      expect.objectContaining({
        removedCount: 3,
        oldestKeptSequence: 4,
        keepLast: 2,
        olderThan: null,
      }),
    ]);
  });

  it("never removes the current revision", () => {
    const { store } = withHistory(3);
    expect(
      store.pruneGraphRevisions(repositoryId, {
        olderThan: Date.now() + 60_000,
      }),
    ).toMatchObject({
      removedCount: 2,
      keptCount: 1,
    });
    expect(store.listGraphRevisions(repositoryId)).toHaveLength(1);
    expect(store.getGraph(repositoryId)).toEqual(snapshot("r3"));
  });

  it("removes only revisions that meet every given criterion", () => {
    const { store } = withHistory(4);
    // Nothing is old enough, so keepLast alone would remove two but none go.
    expect(
      store.pruneGraphRevisions(repositoryId, { keepLast: 2, olderThan: 0 }),
    ).toMatchObject({
      removedCount: 0,
      prune: null,
    });
    expect(store.listGraphRevisions(repositoryId)).toHaveLength(4);
    expect(store.listGraphHistoryPrunes(repositoryId)).toEqual([]);
  });

  it("clears restore links to removed revisions", () => {
    const { store } = withHistory(3);
    const [first] = store.listGraphRevisions(repositoryId);
    store.restoreGraphRevision(repositoryId, first!.id);
    store.pruneGraphRevisions(repositoryId, { keepLast: 1 });

    expect(store.listGraphRevisions(repositoryId)).toEqual([
      expect.objectContaining({
        sequence: 4,
        parentRevisionId: null,
        restoredFromRevisionId: null,
      }),
    ]);
  });

  it("exports pruned history that imports elsewhere with its audit", () => {
    const { store } = withHistory(4);
    store.pruneGraphRevisions(repositoryId, { keepLast: 2 });
    const exported = store.exportGraphHistory(repositoryId)!;
    expect(exported.prunes).toHaveLength(1);

    const target = open();
    expect(target.importGraphHistory(exported).revisionCount).toBe(2);
    expect(target.listGraphHistoryPrunes(repositoryId)).toEqual([
      expect.objectContaining({
        removedCount: 2,
        oldestKeptSequence: 3,
        keepLast: 2,
      }),
    ]);
  });

  it("validates options and ignores unknown repositories", () => {
    const { store } = withHistory(2);
    expect(() => store.pruneGraphRevisions(repositoryId, {})).toThrow(
      GraphHistoryError,
    );
    expect(() =>
      store.pruneGraphRevisions(repositoryId, { keepLast: 0 }),
    ).toThrow("positive integer");
    expect(
      store.pruneGraphRevisions("00000000-0000-4000-8000-000000000000", {
        keepLast: 1,
      }),
    ).toBeNull();
  });
});
