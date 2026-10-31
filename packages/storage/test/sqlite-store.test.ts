import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  GraphValidationError,
  openGraphStore,
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
    firstStore.replaceGraph(createSnapshot());
    firstStore.close();

    const secondStore = openGraphStore(databasePath);
    stores.push(secondStore);
    expect(secondStore.getGraph(repositoryId)).toEqual(createSnapshot());
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

    const invalid = createSnapshot("invalid");
    invalid.entities[0]!.evidenceIds = ["b04d9f9b-1e3d-4c44-82db-905f5f325737"];

    expect(() => store.replaceGraph(invalid)).toThrow(GraphValidationError);
    expect(store.getGraph(repositoryId)).toEqual(original);
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
});
