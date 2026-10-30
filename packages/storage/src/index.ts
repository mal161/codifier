import {
  validateGraphSnapshot,
  type Evidence,
  type GraphEntity,
  type GraphRelationship,
  type GraphSnapshot,
} from "@codifier/domain";
import BetterSqlite3 from "better-sqlite3";
import { asc, eq } from "drizzle-orm";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import { applyMigrations } from "./migrations.js";
import * as schema from "./schema.js";
import {
  entities,
  evidence as evidenceTable,
  relationships,
  repositories,
} from "./schema.js";

export interface GraphStore {
  getGraph(repositoryId: string): GraphSnapshot | null;
  replaceGraph(snapshot: GraphSnapshot): void;
  close(): void;
}

export class GraphValidationError extends Error {
  constructor(
    public readonly issues: ReturnType<typeof validateGraphSnapshot>,
  ) {
    super("Graph snapshot violates domain invariants.");
    this.name = "GraphValidationError";
  }
}

export class StorageCorruptionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StorageCorruptionError";
  }
}

export function openGraphStore(databasePath: string): GraphStore {
  const sqlite = new BetterSqlite3(databasePath);
  try {
    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("busy_timeout = 5000");
    sqlite.pragma("journal_mode = WAL");
    applyMigrations(sqlite);

    const db = drizzle(sqlite, { schema });
    return createGraphStore(db, sqlite);
  } catch (error) {
    sqlite.close();
    throw error;
  }
}

function createGraphStore(
  db: BetterSQLite3Database<typeof schema>,
  sqlite: BetterSqlite3.Database,
): GraphStore {
  return {
    getGraph(repositoryId) {
      const repository = db
        .select()
        .from(repositories)
        .where(eq(repositories.id, repositoryId))
        .limit(1)
        .get();

      if (!repository) {
        return null;
      }

      const evidenceRows = db
        .select()
        .from(evidenceTable)
        .where(eq(evidenceTable.repositoryId, repositoryId))
        .orderBy(asc(evidenceTable.id))
        .all();
      const entityRows = db
        .select()
        .from(entities)
        .where(eq(entities.repositoryId, repositoryId))
        .orderBy(asc(entities.id))
        .all();
      const relationshipRows = db
        .select()
        .from(relationships)
        .where(eq(relationships.repositoryId, repositoryId))
        .orderBy(asc(relationships.id))
        .all();

      const snapshot: GraphSnapshot = {
        schemaVersion: 1,
        repositoryId,
        revision: repository.revision,
        evidence: evidenceRows.map((row): Evidence => ({
          id: row.id,
          origin: row.origin as Evidence["origin"],
          description: row.description,
          ...(row.sourceJson
            ? { source: parseJson(row.sourceJson, "evidence source") }
            : {}),
        })),
        entities: entityRows.map((row): GraphEntity => ({
          id: row.id,
          kind: row.kind as GraphEntity["kind"],
          name: row.name,
          state: row.state as GraphEntity["state"],
          evidenceIds: parseJson(row.evidenceIdsJson, "entity evidence IDs"),
          ...(row.sourceJson
            ? { source: parseJson(row.sourceJson, "entity source") }
            : {}),
        })),
        relationships: relationshipRows.map((row): GraphRelationship => ({
          id: row.id,
          sourceEntityId: row.sourceEntityId,
          targetEntityId: row.targetEntityId,
          type: row.type,
          state: row.state as GraphRelationship["state"],
          evidenceIds: parseJson(
            row.evidenceIdsJson,
            "relationship evidence IDs",
          ),
        })),
      };

      try {
        const issues = validateGraphSnapshot(snapshot);
        if (issues.length > 0) {
          throw new GraphValidationError(issues);
        }
      } catch (cause) {
        throw new StorageCorruptionError(
          "Stored graph violates graph invariants; the database may be corrupted.",
          { cause },
        );
      }

      return snapshot;
    },

    replaceGraph(snapshot) {
      const issues = validateGraphSnapshot(snapshot);
      if (issues.length > 0) {
        throw new GraphValidationError(issues);
      }

      db.transaction((transaction) => {
        transaction
          .insert(repositories)
          .values({
            id: snapshot.repositoryId,
            revision: snapshot.revision,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: repositories.id,
            set: {
              revision: snapshot.revision,
              updatedAt: new Date(),
            },
          })
          .run();

        transaction
          .delete(relationships)
          .where(eq(relationships.repositoryId, snapshot.repositoryId))
          .run();
        transaction
          .delete(entities)
          .where(eq(entities.repositoryId, snapshot.repositoryId))
          .run();
        transaction
          .delete(evidenceTable)
          .where(eq(evidenceTable.repositoryId, snapshot.repositoryId))
          .run();

        if (snapshot.evidence.length > 0) {
          transaction
            .insert(evidenceTable)
            .values(
              snapshot.evidence.map((item) => ({
                id: item.id,
                repositoryId: snapshot.repositoryId,
                origin: item.origin,
                description: item.description,
                sourceJson: item.source ? JSON.stringify(item.source) : null,
              })),
            )
            .run();
        }

        if (snapshot.entities.length > 0) {
          transaction
            .insert(entities)
            .values(
              snapshot.entities.map((entity) => ({
                id: entity.id,
                repositoryId: snapshot.repositoryId,
                kind: entity.kind,
                name: entity.name,
                state: entity.state,
                evidenceIdsJson: JSON.stringify(entity.evidenceIds),
                sourceJson: entity.source
                  ? JSON.stringify(entity.source)
                  : null,
              })),
            )
            .run();
        }

        if (snapshot.relationships.length > 0) {
          transaction
            .insert(relationships)
            .values(
              snapshot.relationships.map((relationship) => ({
                id: relationship.id,
                repositoryId: snapshot.repositoryId,
                sourceEntityId: relationship.sourceEntityId,
                targetEntityId: relationship.targetEntityId,
                type: relationship.type,
                state: relationship.state,
                evidenceIdsJson: JSON.stringify(relationship.evidenceIds),
              })),
            )
            .run();
        }
      });
    },

    close() {
      sqlite.close();
    },
  };
}

function parseJson<T>(value: string, field: string): T {
  try {
    return JSON.parse(value) as T;
  } catch (cause) {
    throw new StorageCorruptionError(
      `Could not decode stored ${field}; the database may be corrupted.`,
      { cause },
    );
  }
}
