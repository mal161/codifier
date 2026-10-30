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
