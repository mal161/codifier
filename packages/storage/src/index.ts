import {
  validateGraphSnapshot,
  type Evidence,
  type GitContext,
  type GraphEntity,
  type GraphRelationship,
  type GraphSnapshot,
} from "@codifier/domain";
import { createHash, randomUUID } from "node:crypto";
import BetterSqlite3 from "better-sqlite3";
import { and, asc, desc, eq } from "drizzle-orm";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import { applyMigrations } from "./migrations.js";
import * as schema from "./schema.js";
import {
  analysisJobs,
  entities,
  evidence as evidenceTable,
  graphRevisions,
  relationships,
  repositories,
} from "./schema.js";

export interface PersistedAnalysisJob {
  id: string;
  repositoryId: string;
  status: string;
  jobJson: string;
  requestJson: string;
  updatedAt: number;
}

export interface GraphRevisionRecord {
  id: string;
  repositoryId: string;
  parentRevisionId: string | null;
  sequence: number;
  sourceRevision: string | null;
  contentHash: string;
  changeSummary: GraphRevisionChangeSummary;
  /** Set when this revision re-commits an earlier revision's snapshot. */
  restoredFromRevisionId: string | null;
  createdAt: number;
}

export interface GraphRestoreResult {
  /** "unchanged" when the requested snapshot already is the current graph. */
  status: "restored" | "unchanged";
  revision: GraphRevisionRecord;
}

export interface GraphRevisionChangeSummary {
  entities: { added: string[]; changed: string[]; removed: string[] };
  relationships: { added: string[]; changed: string[]; removed: string[] };
  evidence: { added: string[]; changed: string[]; removed: string[] };
}

export interface GraphStore {
  getGraph(repositoryId: string): GraphSnapshot | null;
  getGraphRevision(
    repositoryId: string,
    revisionId: string,
  ): GraphSnapshot | null;
  listGraphRevisions(repositoryId: string): GraphRevisionRecord[];
  /**
   * Re-commits an earlier revision's snapshot as a new current revision.
   * History is never rewritten; returns null when the revision is unknown.
   */
  restoreGraphRevision(
    repositoryId: string,
    revisionId: string,
  ): GraphRestoreResult | null;
  getAnalysisJob(jobId: string): PersistedAnalysisJob | null;
  listAnalysisJobs(limit?: number): PersistedAnalysisJob[];
  saveAnalysisJob(job: Omit<PersistedAnalysisJob, "updatedAt">): void;
  deleteAnalysisJob(jobId: string): void;
  replaceGraph(
    snapshot: GraphSnapshot,
    committedJob?: Omit<PersistedAnalysisJob, "updatedAt">,
  ): void;
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
  const store: GraphStore = {
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
        ...(repository.gitContextJson
          ? {
              gitContext: parseJson<GitContext>(
                repository.gitContextJson,
                "Git context",
              ),
            }
          : {}),
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

    getGraphRevision(repositoryId, revisionId) {
      const row = db
        .select({
          snapshotJson: graphRevisions.snapshotJson,
          contentHash: graphRevisions.contentHash,
        })
        .from(graphRevisions)
        .where(
          and(
            eq(graphRevisions.repositoryId, repositoryId),
            eq(graphRevisions.id, revisionId),
          ),
        )
        .get();

      if (!row) return null;
      const snapshot = parseJson<GraphSnapshot>(
        row.snapshotJson,
        "graph revision",
      );
      if (
        snapshot.repositoryId !== repositoryId ||
        hashSnapshot(snapshot) !== row.contentHash
      ) {
        throw new StorageCorruptionError(
          "Stored graph revision does not match its repository or content hash.",
        );
      }
      const issues = validateGraphSnapshot(snapshot);
      if (issues.length > 0)
        throw new StorageCorruptionError(
          "Stored graph revision violates graph invariants.",
          { cause: new GraphValidationError(issues) },
        );
      return snapshot;
    },

    listGraphRevisions(repositoryId) {
      return db
        .select()
        .from(graphRevisions)
        .where(eq(graphRevisions.repositoryId, repositoryId))
        .orderBy(asc(graphRevisions.sequence))
        .all()
        .map((row) => ({
          id: row.id,
          repositoryId: row.repositoryId,
          parentRevisionId: row.parentRevisionId,
          sequence: row.sequence,
          sourceRevision: row.sourceRevision,
          contentHash: row.contentHash,
          changeSummary: parseJson<GraphRevisionChangeSummary>(
            row.changeSummaryJson,
            "graph revision change summary",
          ),
          restoredFromRevisionId: row.restoredFromRevisionId,
          createdAt: row.createdAt.getTime(),
        }));
    },

    getAnalysisJob(jobId) {
      const row = db
        .select()
        .from(analysisJobs)
        .where(eq(analysisJobs.id, jobId))
        .get();
      return row
        ? {
            ...row,
            updatedAt: row.updatedAt.getTime(),
          }
        : null;
    },

    listAnalysisJobs(limit = 50) {
      return db
        .select()
        .from(analysisJobs)
        .orderBy(desc(analysisJobs.updatedAt), asc(analysisJobs.id))
        .limit(limit)
        .all()
        .map((row) => ({ ...row, updatedAt: row.updatedAt.getTime() }));
    },

    saveAnalysisJob(job) {
      db.insert(analysisJobs)
        .values({ ...job, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: analysisJobs.id,
          set: {
            repositoryId: job.repositoryId,
            status: job.status,
            jobJson: job.jobJson,
            requestJson: job.requestJson,
            updatedAt: new Date(),
          },
        })
        .run();
    },

    deleteAnalysisJob(jobId) {
      db.delete(analysisJobs).where(eq(analysisJobs.id, jobId)).run();
    },

    restoreGraphRevision(repositoryId, revisionId) {
      const target = store.getGraphRevision(repositoryId, revisionId);
      if (!target) return null;
      const { revisionId: currentId, created } = commitSnapshot(target, {
        restoredFromRevisionId: revisionId,
      });
      const revision = store
        .listGraphRevisions(repositoryId)
        .find(({ id }) => id === currentId);
      if (!revision) {
        throw new StorageCorruptionError(
          "Current graph revision pointer does not resolve to history.",
        );
      }
      return { status: created ? "restored" : "unchanged", revision };
    },

    replaceGraph(snapshot, committedJob) {
      commitSnapshot(snapshot, committedJob ? { committedJob } : {});
    },

    close() {
      sqlite.close();
    },
  };

  function commitSnapshot(
    snapshot: GraphSnapshot,
    commit: {
      committedJob?: Omit<PersistedAnalysisJob, "updatedAt">;
      restoredFromRevisionId?: string;
    },
  ): { revisionId: string; created: boolean } {
    const issues = validateGraphSnapshot(snapshot);
    if (issues.length > 0) {
      throw new GraphValidationError(issues);
    }

    const previousSnapshot = store.getGraph(snapshot.repositoryId);
    return db.transaction((transaction) => {
      transaction
        .insert(repositories)
        .values({
          id: snapshot.repositoryId,
          revision: snapshot.revision,
          gitContextJson: snapshot.gitContext
            ? JSON.stringify(snapshot.gitContext)
            : null,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: repositories.id,
          set: {
            revision: snapshot.revision,
            gitContextJson: snapshot.gitContext
              ? JSON.stringify(snapshot.gitContext)
              : null,
            updatedAt: new Date(),
          },
        })
        .run();

      const repository = transaction
        .select({
          currentGraphRevisionId: repositories.currentGraphRevisionId,
        })
        .from(repositories)
        .where(eq(repositories.id, snapshot.repositoryId))
        .get();
      let parentRevisionId = repository?.currentGraphRevisionId ?? null;
      let nextSequence = 1;
      if (parentRevisionId) {
        const currentRevision = transaction
          .select({
            sequence: graphRevisions.sequence,
            contentHash: graphRevisions.contentHash,
          })
          .from(graphRevisions)
          .where(eq(graphRevisions.id, parentRevisionId))
          .get();
        if (!currentRevision) {
          throw new StorageCorruptionError(
            "Current graph revision pointer does not resolve to history.",
          );
        }
        if (
          previousSnapshot &&
          currentRevision.contentHash !== hashSnapshot(previousSnapshot)
        ) {
          throw new StorageCorruptionError(
            "Current graph does not match its committed revision.",
          );
        }
        nextSequence = currentRevision.sequence + 1;
      }
      if (previousSnapshot && !parentRevisionId) {
        const baselineHash = hashSnapshot(previousSnapshot);
        const baselineId = randomUUID();
        transaction
          .insert(graphRevisions)
          .values({
            id: baselineId,
            repositoryId: snapshot.repositoryId,
            parentRevisionId: null,
            sequence: nextSequence,
            sourceRevision: previousSnapshot.revision,
            contentHash: baselineHash,
            changeSummaryJson: JSON.stringify(
              summarizeGraphChanges(null, previousSnapshot),
            ),
            snapshotJson: JSON.stringify(previousSnapshot),
            createdAt: new Date(),
          })
          .run();
        parentRevisionId = baselineId;
        nextSequence += 1;
        transaction
          .update(repositories)
          .set({ currentGraphRevisionId: baselineId })
          .where(eq(repositories.id, snapshot.repositoryId))
          .run();
      }

      const targetHash = hashSnapshot(snapshot);
      if (previousSnapshot && hashSnapshot(previousSnapshot) === targetHash) {
        if (commit.committedJob) {
          transaction
            .insert(analysisJobs)
            .values({ ...commit.committedJob, updatedAt: new Date() })
            .onConflictDoUpdate({
              target: analysisJobs.id,
              set: {
                repositoryId: commit.committedJob.repositoryId,
                status: commit.committedJob.status,
                jobJson: commit.committedJob.jobJson,
                requestJson: commit.committedJob.requestJson,
                updatedAt: new Date(),
              },
            })
            .run();
        }
        return { revisionId: parentRevisionId!, created: false };
      }

      const revisionId = randomUUID();
      transaction
        .insert(graphRevisions)
        .values({
          id: revisionId,
          repositoryId: snapshot.repositoryId,
          parentRevisionId,
          sequence: nextSequence,
          sourceRevision: snapshot.revision,
          contentHash: targetHash,
          changeSummaryJson: JSON.stringify(
            summarizeGraphChanges(previousSnapshot, snapshot),
          ),
          snapshotJson: JSON.stringify(snapshot),
          restoredFromRevisionId: commit.restoredFromRevisionId ?? null,
          createdAt: new Date(),
        })
        .run();
      transaction
        .update(repositories)
        .set({ currentGraphRevisionId: revisionId })
        .where(eq(repositories.id, snapshot.repositoryId))
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
              sourceJson: entity.source ? JSON.stringify(entity.source) : null,
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

      if (commit.committedJob) {
        transaction
          .insert(analysisJobs)
          .values({ ...commit.committedJob, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: analysisJobs.id,
            set: {
              repositoryId: commit.committedJob.repositoryId,
              status: commit.committedJob.status,
              jobJson: commit.committedJob.jobJson,
              requestJson: commit.committedJob.requestJson,
              updatedAt: new Date(),
            },
          })
          .run();
      }
      return { revisionId, created: true };
    });
  }

  return store;
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

function hashSnapshot(snapshot: GraphSnapshot): string {
  const stableSnapshot = {
    ...snapshot,
    evidence: [...snapshot.evidence].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
    entities: [...snapshot.entities]
      .map((entity) => ({
        ...entity,
        evidenceIds: [...entity.evidenceIds].sort(),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    relationships: [...snapshot.relationships]
      .map((relationship) => ({
        ...relationship,
        evidenceIds: [...relationship.evidenceIds].sort(),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
  return createHash("sha256")
    .update(canonicalJson(stableSnapshot))
    .digest("hex");
}

function summarizeGraphChanges(
  previous: GraphSnapshot | null,
  next: GraphSnapshot,
): GraphRevisionChangeSummary {
  return {
    entities: diffById(previous?.entities ?? [], next.entities),
    relationships: diffById(previous?.relationships ?? [], next.relationships),
    evidence: diffById(previous?.evidence ?? [], next.evidence),
  };
}

function diffById<T extends { id: string }>(
  previous: T[],
  next: T[],
): { added: string[]; changed: string[]; removed: string[] } {
  const previousById = new Map(previous.map((item) => [item.id, item]));
  const nextById = new Map(next.map((item) => [item.id, item]));
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  for (const [id, item] of nextById) {
    const prior = previousById.get(id);
    if (!prior) added.push(id);
    else if (canonicalJson(prior) !== canonicalJson(item)) changed.push(id);
  }
  for (const id of previousById.keys()) {
    if (!nextById.has(id)) removed.push(id);
  }
  return {
    added: added.sort(),
    changed: changed.sort(),
    removed: removed.sort(),
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
