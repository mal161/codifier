import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  GraphValidationError,
  openGraphStore,
  RuleExceptionConflictError,
  StorageCorruptionError,
  type GraphStore,
} from "../src/index.js";
import type { GraphSnapshot } from "@codifier/domain";

const repositoryId = "7b9442d6-faaa-49f9-a39e-7de8a276a978";
const evidenceId = "05a4d48e-1e17-4ca7-9e03-773ea13d3561";
const entityId = "9ac38590-a7ac-4101-bfc9-dc323d1c9301";

const temporaryDirectories: string[] = [];
const stores: GraphStore[] = [];

function createTemporaryDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "codifier-storage-test-"));
  temporaryDirectories.push(directory);
  return join(directory, "graph.sqlite");
}

function createSnapshot(name = "root"): GraphSnapshot {
  return {
    schemaVersion: 1,
    repositoryId,
    revision: "a1b2c3d",
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
      {
        id: evidenceId,
        origin: "developer",
        description: "Repository registered by its owner.",
      },
    ],
    relationships: [],
  };
}

afterEach(() => {
  for (const store of stores.splice(0)) {
    store.close();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("SQLite graph store", () => {
  it("applies migrations and round-trips a graph through Drizzle", () => {
    const databasePath = createTemporaryDatabasePath();
    const store = openGraphStore(databasePath);
    stores.push(store);
    const snapshot = createSnapshot();

    expect(store.getGraph(repositoryId)).toBeNull();
    store.replaceGraph(snapshot);
    expect(store.getGraph(repositoryId)).toEqual(snapshot);
  });

  it("persists graph data after closing and reopening the database", () => {
    const databasePath = createTemporaryDatabasePath();
    const firstStore = openGraphStore(databasePath);
    const original = createSnapshot();
    const updated = createSnapshot("reopened");
    firstStore.replaceGraph(original);
    firstStore.replaceGraph(updated);
    const revisionHistory = firstStore.listGraphRevisions(repositoryId);
    firstStore.close();

    const secondStore = openGraphStore(databasePath);
    stores.push(secondStore);
    expect(secondStore.getGraph(repositoryId)).toEqual(updated);
    expect(secondStore.listGraphRevisions(repositoryId)).toEqual(
      revisionHistory,
    );
    expect(
      secondStore.getGraphRevision(repositoryId, revisionHistory[0]!.id),
    ).toEqual(original);
  });

  it("persists Git context", () => {
    const databasePath = createTemporaryDatabasePath();
    const store = openGraphStore(databasePath);
    stores.push(store);
    const snapshot = {
      ...createSnapshot(),
      gitContext: {
        commit: "a".repeat(40),
        branch: "feature/git-context",
        workingTree: "dirty" as const,
      },
    };

    store.replaceGraph(snapshot);

    expect(store.getGraph(repositoryId)).toEqual(snapshot);
  });

  it("migrates a pre-Git repository snapshot without losing its revision", () => {
    const databasePath = createTemporaryDatabasePath();
    const legacyDatabase = new BetterSqlite3(databasePath);
    legacyDatabase.exec(`
      CREATE TABLE codifier_migrations (
        id TEXT PRIMARY KEY NOT NULL,
        applied_at INTEGER NOT NULL
      );
      INSERT INTO codifier_migrations (id, applied_at)
        VALUES ('0001_initial_graph', 1);
      CREATE TABLE repositories (
        id TEXT PRIMARY KEY NOT NULL,
        revision TEXT,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO repositories (id, revision, updated_at)
        VALUES ('${repositoryId}', 'legacy-revision', 1);
      CREATE TABLE evidence (
        id TEXT PRIMARY KEY NOT NULL,
        repository_id TEXT NOT NULL,
        origin TEXT NOT NULL,
        description TEXT NOT NULL,
        source_json TEXT
      );
      CREATE TABLE entities (
        id TEXT PRIMARY KEY NOT NULL,
        repository_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        state TEXT NOT NULL,
        evidence_ids_json TEXT NOT NULL,
        source_json TEXT
      );
      CREATE TABLE relationships (
        id TEXT PRIMARY KEY NOT NULL,
        repository_id TEXT NOT NULL,
        source_entity_id TEXT NOT NULL,
        target_entity_id TEXT NOT NULL,
        type TEXT NOT NULL,
        state TEXT NOT NULL,
        evidence_ids_json TEXT NOT NULL
      );
    `);
    legacyDatabase.close();

    const store = openGraphStore(databasePath);
    stores.push(store);

    const graph = store.getGraph(repositoryId);
    expect(graph).toMatchObject({
      repositoryId,
      revision: "legacy-revision",
      entities: [],
      evidence: [],
      relationships: [],
    });
    expect(graph).not.toHaveProperty("gitContext");
  });

  it("rejects invalid snapshots without changing committed graph state", () => {
    const store = openGraphStore(createTemporaryDatabasePath());
    stores.push(store);
    const original = createSnapshot();
    store.replaceGraph(original);
    const historyBeforeFailure = store.listGraphRevisions(repositoryId);

    const invalid = createSnapshot("invalid");
    invalid.entities[0]!.evidenceIds = ["b04d9f9b-1e3d-4c44-82db-905f5f325737"];

    expect(() => store.replaceGraph(invalid)).toThrow(GraphValidationError);
    expect(store.getGraph(repositoryId)).toEqual(original);
    expect(store.listGraphRevisions(repositoryId)).toEqual(
      historyBeforeFailure,
    );
  });

  it("replaces a repository graph transactionally", () => {
    const store = openGraphStore(createTemporaryDatabasePath());
    stores.push(store);
    store.replaceGraph(createSnapshot());
    const updated = createSnapshot("updated");

    store.replaceGraph(updated);

    expect(store.getGraph(repositoryId)).toEqual(updated);
    expect(store.getGraph(repositoryId)?.entities).toHaveLength(1);
  });

  it("retains committed graph revisions and skips identical snapshots", () => {
    const store = openGraphStore(createTemporaryDatabasePath());
    stores.push(store);
    const initial = createSnapshot();
    const updated = createSnapshot("updated");

    store.replaceGraph(initial);
    const firstRevision = store.listGraphRevisions(repositoryId)[0]!;
    store.replaceGraph(updated);
    store.replaceGraph(updated);

    const history = store.listGraphRevisions(repositoryId);
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({
      id: firstRevision.id,
      parentRevisionId: null,
      sequence: 1,
      sourceRevision: initial.revision,
    });
    expect(history[1]).toMatchObject({
      parentRevisionId: firstRevision.id,
      sequence: 2,
      sourceRevision: updated.revision,
      changeSummary: {
        entities: { added: [], changed: [entityId], removed: [] },
      },
    });
    expect(store.getGraphRevision(repositoryId, firstRevision.id)).toEqual(
      initial,
    );
    expect(store.getGraph(repositoryId)).toEqual(updated);
  });

  it("commits a completed job outcome with its graph snapshot", () => {
    const store = openGraphStore(createTemporaryDatabasePath());
    stores.push(store);
    const snapshot = createSnapshot();
    const jobId = "3a4a9cc2-60eb-4aa7-8668-5f2c7736a834";
    const completedJob = {
      id: jobId,
      repositoryId,
      status: "completed",
      jobJson: JSON.stringify({ id: jobId, status: "completed" }),
      requestJson: JSON.stringify({ rootPath: "/repo" }),
    };

    store.replaceGraph(snapshot, completedJob);

    expect(store.getGraph(repositoryId)).toEqual(snapshot);
    expect(store.getAnalysisJob(jobId)).toMatchObject({
      status: "completed",
      jobJson: completedJob.jobJson,
    });
  });

  it("reports stored graph rows that no longer satisfy domain invariants", () => {
    const databasePath = createTemporaryDatabasePath();
    const store = openGraphStore(databasePath);
    stores.push(store);
    store.replaceGraph(createSnapshot());

    const tamperedDatabase = new BetterSqlite3(databasePath);
    tamperedDatabase
      .prepare("UPDATE evidence SET origin = ? WHERE id = ?")
      .run("unknown-origin", evidenceId);
    tamperedDatabase.close();

    expect(() => store.getGraph(repositoryId)).toThrow(StorageCorruptionError);
  });
  it("restores an earlier revision as a new revision without erasing history", () => {
    const databasePath = createTemporaryDatabasePath();
    const store = openGraphStore(databasePath);
    stores.push(store);
    const initial = createSnapshot();
    store.replaceGraph(initial);
    store.replaceGraph(createSnapshot("updated"));
    const [first, second] = store.listGraphRevisions(repositoryId);

    const result = store.restoreGraphRevision(repositoryId, first!.id);

    expect(result).toMatchObject({
      status: "restored",
      revision: {
        sequence: 3,
        parentRevisionId: second!.id,
        restoredFromRevisionId: first!.id,
        contentHash: first!.contentHash,
        changeSummary: {
          entities: { added: [], changed: [entityId], removed: [] },
        },
      },
    });
    expect(store.getGraph(repositoryId)).toEqual(initial);
    store.close();
    stores.pop();

    const reopened = openGraphStore(databasePath);
    stores.push(reopened);
    const history = reopened.listGraphRevisions(repositoryId);
    expect(history.map(({ sequence }) => sequence)).toEqual([1, 2, 3]);
    expect(history.map(({ id }) => id).slice(0, 2)).toEqual([
      first!.id,
      second!.id,
    ]);
    expect(reopened.getGraph(repositoryId)).toEqual(initial);
  });

  it("does not add a revision when restoring the current graph", () => {
    const store = openGraphStore(createTemporaryDatabasePath());
    stores.push(store);
    store.replaceGraph(createSnapshot());
    const [current] = store.listGraphRevisions(repositoryId);

    expect(store.restoreGraphRevision(repositoryId, current!.id)).toEqual({
      status: "unchanged",
      revision: current,
    });
    expect(store.listGraphRevisions(repositoryId)).toHaveLength(1);
  });

  it("returns null for revisions of another or unknown repository", () => {
    const store = openGraphStore(createTemporaryDatabasePath());
    stores.push(store);
    store.replaceGraph(createSnapshot());
    const [current] = store.listGraphRevisions(repositoryId);

    expect(
      store.restoreGraphRevision(
        "00000000-0000-4000-8000-000000000000",
        current!.id,
      ),
    ).toBeNull();
    expect(
      store.restoreGraphRevision(
        repositoryId,
        "00000000-0000-4000-8000-000000000001",
      ),
    ).toBeNull();
  });

  it("refuses to restore a tampered revision and keeps the current graph", () => {
    const databasePath = createTemporaryDatabasePath();
    const store = openGraphStore(databasePath);
    stores.push(store);
    store.replaceGraph(createSnapshot());
    store.replaceGraph(createSnapshot("updated"));
    const [first] = store.listGraphRevisions(repositoryId);

    const tamperedDatabase = new BetterSqlite3(databasePath);
    tamperedDatabase
      .prepare(
        "UPDATE graph_revisions SET snapshot_json = json_set(snapshot_json, '$.revision', 'forged') WHERE id = ?",
      )
      .run(first!.id);
    tamperedDatabase.close();

    expect(() => store.restoreGraphRevision(repositoryId, first!.id)).toThrow(
      StorageCorruptionError,
    );
    expect(store.listGraphRevisions(repositoryId)).toHaveLength(2);
    expect(store.getGraph(repositoryId)).toEqual(createSnapshot("updated"));
  });

  it("rolls back the revision and current graph when a write fails mid-transaction", () => {
    const store = openGraphStore(createTemporaryDatabasePath());
    stores.push(store);
    store.replaceGraph(createSnapshot());
    const before = store.listGraphRevisions(repositoryId);
    const jobId = "6f0c3f53-8f43-4b8a-9d32-1f5b0a6f1d11";

    // The job row is the transaction's final write; invalid JSON violates its
    // CHECK constraint after the revision and graph rows were already written.
    expect(() =>
      store.replaceGraph(createSnapshot("updated"), {
        id: jobId,
        repositoryId,
        status: "completed",
        jobJson: "{not json",
        requestJson: "{}",
      }),
    ).toThrow();

    expect(store.listGraphRevisions(repositoryId)).toEqual(before);
    expect(store.getGraph(repositoryId)).toEqual(createSnapshot());
    expect(store.getAnalysisJob(jobId)).toBeNull();

    store.replaceGraph(createSnapshot("updated"));
    expect(
      store.listGraphRevisions(repositoryId).map(({ sequence }) => sequence),
    ).toEqual([1, 2]);
  });

  it("does not create duplicate revisions when a committed job is retried", () => {
    const store = openGraphStore(createTemporaryDatabasePath());
    stores.push(store);
    store.replaceGraph(createSnapshot());
    const retry = (id: string) => ({
      id,
      repositoryId,
      status: "completed",
      jobJson: JSON.stringify({ id, status: "completed" }),
      requestJson: "{}",
    });

    store.replaceGraph(
      createSnapshot("updated"),
      retry("0c2d4f61-9c2e-4d6b-a8a4-6c3f2b9f4a01"),
    );
    store.replaceGraph(
      createSnapshot("updated"),
      retry("0c2d4f61-9c2e-4d6b-a8a4-6c3f2b9f4a02"),
    );

    expect(store.listGraphRevisions(repositoryId)).toHaveLength(2);
    expect(
      store.getAnalysisJob("0c2d4f61-9c2e-4d6b-a8a4-6c3f2b9f4a02"),
    ).toMatchObject({ status: "completed" });
  });
  it("exports verified revision history without job records", () => {
    const databasePath = createTemporaryDatabasePath();
    const store = openGraphStore(databasePath);
    stores.push(store);
    expect(store.exportGraphHistory(repositoryId)).toBeNull();
    store.replaceGraph(createSnapshot(), {
      id: "8d1c2b7e-3f4a-4c5d-9e6f-7a8b9c0d1e2f",
      repositoryId,
      status: "completed",
      jobJson: JSON.stringify({ status: "completed" }),
      requestJson: JSON.stringify({ rootPath: "/private/repo" }),
    });
    store.replaceGraph(createSnapshot("updated"));
    const [first] = store.listGraphRevisions(repositoryId);
    const restored = store.restoreGraphRevision(repositoryId, first!.id)!;

    const exported = store.exportGraphHistory(repositoryId)!;

    expect(exported).toMatchObject({
      format: "codifier.graph-history",
      formatVersion: 1,
      repositoryId,
      currentRevisionId: restored.revision.id,
    });
    expect(exported.revisions.map(({ sequence }) => sequence)).toEqual([
      1, 2, 3,
    ]);
    expect(exported.revisions.map(({ snapshot }) => snapshot)).toEqual([
      createSnapshot(),
      createSnapshot("updated"),
      createSnapshot(),
    ]);
    expect(exported.revisions[2]!.restoredFromRevisionId).toBe(first!.id);
    expect(JSON.stringify(exported)).not.toContain("/private/repo");

    const tamperedDatabase = new BetterSqlite3(databasePath);
    tamperedDatabase
      .prepare(
        "UPDATE graph_revisions SET content_hash = 'forged' WHERE sequence = 2",
      )
      .run();
    tamperedDatabase.close();
    expect(() => store.exportGraphHistory(repositoryId)).toThrow(
      StorageCorruptionError,
    );
  });
  it("records, lists, and revokes rule exceptions append-only", () => {
    const databasePath = createTemporaryDatabasePath();
    const store = openGraphStore(databasePath);
    stores.push(store);
    const exception = {
      repositoryId,
      findingKey: "a".repeat(64),
      ruleId: "unmapped-intended-component",
      entityIds: [entityId],
      rationale: "Planned for next quarter.",
      author: "Reviewer",
      expiresAt: null,
    };
    expect(() => store.createRuleException(exception)).toThrow(
      RuleExceptionConflictError,
    );
    store.replaceGraph(createSnapshot());

    const created = store.createRuleException(exception);
    expect(created).toMatchObject({ ...exception, revokedAt: null });
    expect(() => store.createRuleException(exception)).toThrow(
      "already has an active exception",
    );

    const revoked = store.revokeRuleException(repositoryId, created.id, {
      revokedBy: "Lead",
      reason: "Component was implemented.",
    })!;
    expect(revoked).toMatchObject({
      id: created.id,
      rationale: exception.rationale,
      revokedBy: "Lead",
      revokeReason: "Component was implemented.",
    });
    expect(revoked.revokedAt).toBeGreaterThanOrEqual(created.createdAt);
    expect(() =>
      store.revokeRuleException(repositoryId, created.id, {
        revokedBy: "Lead",
        reason: "again",
      }),
    ).toThrow("already revoked");
    expect(
      store.revokeRuleException(
        "00000000-0000-4000-8000-000000000000",
        created.id,
        { revokedBy: "Lead", reason: "wrong repository" },
      ),
    ).toBeNull();

    // A revoked exception does not block a new decision for the same finding.
    const second = store.createRuleException({
      ...exception,
      expiresAt: Date.now() + 86_400_000,
    });
    store.close();
    stores.pop();

    const reopened = openGraphStore(databasePath);
    stores.push(reopened);
    expect(
      reopened.listRuleExceptions(repositoryId).map(({ id }) => id),
    ).toEqual([created.id, second.id]);
    expect(reopened.listRuleExceptions(repositoryId)[0]!.revokedBy).toBe(
      "Lead",
    );
  });

  it("keeps exceptions when the graph is replaced or restored", () => {
    const store = openGraphStore(createTemporaryDatabasePath());
    stores.push(store);
    store.replaceGraph(createSnapshot());
    store.createRuleException({
      repositoryId,
      findingKey: "b".repeat(64),
      ruleId: "dependency-cycle",
      entityIds: [entityId],
      rationale: "Accepted while migrating.",
      author: "Reviewer",
      expiresAt: null,
    });
    store.replaceGraph(createSnapshot("updated"));
    const [first] = store.listGraphRevisions(repositoryId);
    store.restoreGraphRevision(repositoryId, first!.id);

    expect(store.listRuleExceptions(repositoryId)).toHaveLength(1);
  });
});
