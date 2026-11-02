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
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import { applyMigrations } from "./migrations.js";
import * as schema from "./schema.js";
import {
  analysisJobs,
  architectureRuleExceptions,
  entities,
  graphHistoryPrunes,
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

/**
 * Portable, verified copy of a repository's revision history. Contains graph
 * metadata, evidence, and source locators, never source file contents or
 * analysis job records.
 */
export interface GraphHistoryExport {
  format: "codifier.graph-history";
  formatVersion: 1;
  repositoryId: string;
  currentRevisionId: string | null;
  exportedAt: number;
  revisions: Array<GraphRevisionRecord & { snapshot: GraphSnapshot }>;
  /** Audit of manual prunes; older revisions they removed are absent. */
  prunes?: GraphHistoryPruneRecord[];
}

/** Audit entry written each time a person prunes old revisions. */
export interface GraphHistoryPruneRecord {
  id: string;
  repositoryId: string;
  removedCount: number;
  oldestKeptSequence: number;
  keepLast: number | null;
  olderThan: number | null;
  prunedAt: number;
}

export interface GraphHistoryPruneResult {
  removedCount: number;
  keptCount: number;
  oldestKeptSequence: number;
  prune: GraphHistoryPruneRecord | null;
}

export interface GraphHistoryImportResult {
  repositoryId: string;
  revisionCount: number;
  currentRevisionId: string;
}

export class GraphHistoryError extends Error {
  constructor(
    public readonly code:
      | "invalid_history"
      | "repository_exists"
      | "identifier_in_use"
      | "invalid_prune",
    message: string,
  ) {
    super(message);
    this.name = "GraphHistoryError";
  }
}

/**
 * A developer-authored, append-only decision to accept one rule finding.
 * Records are never edited or deleted; revoking sets the revoke fields once.
 */
export interface RuleExceptionRecord {
  id: string;
  repositoryId: string;
  findingKey: string;
  ruleId: string;
  entityIds: string[];
  rationale: string;
  author: string;
  createdAt: number;
  expiresAt: number | null;
  revokedAt: number | null;
  revokedBy: string | null;
  revokeReason: string | null;
}

export type NewRuleException = Pick<
  RuleExceptionRecord,
  | "repositoryId"
  | "findingKey"
  | "ruleId"
  | "entityIds"
  | "rationale"
  | "author"
  | "expiresAt"
>;

export class RuleExceptionConflictError extends Error {
  constructor(
    public readonly code:
      "repository_not_found" | "active_exception_exists" | "already_revoked",
    message: string,
  ) {
    super(message);
    this.name = "RuleExceptionConflictError";
  }
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
  /**
   * Exports every revision with its re-verified snapshot. Returns null for an
   * unknown repository; throws StorageCorruptionError if any revision fails
   * verification, so a partial export is never produced.
   */
  exportGraphHistory(repositoryId: string): GraphHistoryExport | null;
  listRuleExceptions(repositoryId: string): RuleExceptionRecord[];
  /** Throws RuleExceptionConflictError when an active exception already exists. */
  createRuleException(exception: NewRuleException): RuleExceptionRecord;
  /** Returns null when unknown; throws RuleExceptionConflictError if already revoked. */
  revokeRuleException(
    repositoryId: string,
    exceptionId: string,
    revocation: { revokedBy: string; reason: string },
  ): RuleExceptionRecord | null;
  /**
   * Imports an exported history into a repository this database does not
   * have yet, re-verifying every revision. Throws GraphHistoryError.
   */
  importGraphHistory(history: GraphHistoryExport): GraphHistoryImportResult;
  /**
   * Deletes the oldest revisions that meet every given criterion, never the
   * current one, and records an audit entry. Returns null for an unknown
   * repository; throws GraphHistoryError for invalid options.
   */
  pruneGraphRevisions(
    repositoryId: string,
    options: { keepLast?: number; olderThan?: number },
  ): GraphHistoryPruneResult | null;
  listGraphHistoryPrunes(repositoryId: string): GraphHistoryPruneRecord[];
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

    exportGraphHistory(repositoryId) {
      return db.transaction(() => {
        const repository = db
          .select({
            currentGraphRevisionId: repositories.currentGraphRevisionId,
          })
          .from(repositories)
          .where(eq(repositories.id, repositoryId))
          .get();
        if (!repository) return null;
        const revisions = store
          .listGraphRevisions(repositoryId)
          .map((record) => {
            const snapshot = store.getGraphRevision(repositoryId, record.id);
            if (!snapshot) {
              throw new StorageCorruptionError(
                "Graph revision disappeared while exporting history.",
              );
            }
            return { ...record, snapshot };
          });
        const prunes = store.listGraphHistoryPrunes(repositoryId);
        return {
          format: "codifier.graph-history" as const,
          formatVersion: 1 as const,
          repositoryId,
          currentRevisionId: repository.currentGraphRevisionId,
          exportedAt: Date.now(),
          revisions,
          ...(prunes.length > 0 ? { prunes } : {}),
        };
      });
    },

    importGraphHistory(history) {
      const invalid = (message: string) =>
        new GraphHistoryError("invalid_history", message);
      if (
        history?.format !== "codifier.graph-history" ||
        history.formatVersion !== 1
      ) {
        throw invalid(
          "Not a Codifier graph history export (format version 1).",
        );
      }
      const { repositoryId, revisions } = history;
      if (!Array.isArray(revisions) || revisions.length === 0) {
        throw invalid("The export contains no revisions.");
      }
      const seen = new Set<string>();
      revisions.forEach((revision, index) => {
        const label = `Revision ${revision.sequence ?? index + 1}`;
        if (revision.repositoryId !== repositoryId) {
          throw invalid(`${label} belongs to a different repository.`);
        }
        if (seen.has(revision.id)) throw invalid(`${label} is duplicated.`);
        const previous = revisions[index - 1];
        if (previous && !(revision.sequence > previous.sequence)) {
          throw invalid(`${label} is out of order.`);
        }
        const expectedParent = previous ? previous.id : null;
        if (revision.parentRevisionId !== expectedParent) {
          throw invalid(`${label} does not follow the previous revision.`);
        }
        if (
          revision.restoredFromRevisionId !== null &&
          revision.restoredFromRevisionId !== undefined &&
          !seen.has(revision.restoredFromRevisionId)
        ) {
          throw invalid(
            `${label} restores a revision that is not earlier in the export.`,
          );
        }
        const snapshot = revision.snapshot;
        if (snapshot?.repositoryId !== repositoryId) {
          throw invalid(`${label} has a snapshot for a different repository.`);
        }
        const issues = validateGraphSnapshot(snapshot);
        if (issues.length > 0) {
          throw invalid(
            `${label} violates graph invariants (${issues[0]!.code}).`,
          );
        }
        if (hashSnapshot(snapshot) !== revision.contentHash) {
          throw invalid(`${label} does not match its content hash.`);
        }
        seen.add(revision.id);
      });
      const current = revisions.at(-1)!;
      if (history.currentRevisionId !== current.id) {
        throw invalid(
          "The current revision must be the latest revision in the export.",
        );
      }

      return db.transaction((transaction) => {
        const existing = transaction
          .select({ id: repositories.id })
          .from(repositories)
          .where(eq(repositories.id, repositoryId))
          .get();
        if (existing) {
          throw new GraphHistoryError(
            "repository_exists",
            "This repository already has a graph here. Import only restores a repository the agent does not have yet; local history is never replaced or merged.",
          );
        }
        const inUse = (
          table:
            | typeof graphRevisions
            | typeof entities
            | typeof evidenceTable
            | typeof relationships,
          ids: string[],
        ) => {
          for (let start = 0; start < ids.length; start += 500) {
            const chunk = ids.slice(start, start + 500);
            if (chunk.length === 0) continue;
            const hit = transaction
              .select({ id: table.id })
              .from(table)
              .where(inArray(table.id, chunk))
              .get();
            if (hit) return true;
          }
          return false;
        };
        const snapshot = current.snapshot;
        if (
          inUse(
            graphRevisions,
            revisions.map((revision) => revision.id),
          ) ||
          inUse(
            entities,
            snapshot.entities.map((item) => item.id),
          ) ||
          inUse(
            evidenceTable,
            snapshot.evidence.map((item) => item.id),
          ) ||
          inUse(
            relationships,
            snapshot.relationships.map((item) => item.id),
          )
        ) {
          throw new GraphHistoryError(
            "identifier_in_use",
            "Some identifiers in this export already belong to another repository in this database.",
          );
        }

        transaction
          .insert(repositories)
          .values({
            id: repositoryId,
            revision: snapshot.revision,
            gitContextJson: snapshot.gitContext
              ? JSON.stringify(snapshot.gitContext)
              : null,
            updatedAt: new Date(),
          })
          .run();
        for (const revision of revisions) {
          transaction
            .insert(graphRevisions)
            .values({
              id: revision.id,
              repositoryId,
              parentRevisionId: revision.parentRevisionId,
              sequence: revision.sequence,
              sourceRevision: revision.sourceRevision ?? null,
              contentHash: revision.contentHash,
              changeSummaryJson: JSON.stringify(revision.changeSummary),
              snapshotJson: JSON.stringify(revision.snapshot),
              restoredFromRevisionId: revision.restoredFromRevisionId ?? null,
              createdAt: new Date(revision.createdAt),
            })
            .run();
        }
        writeCurrentGraph(transaction, snapshot);
        transaction
          .update(repositories)
          .set({ currentGraphRevisionId: current.id })
          .where(eq(repositories.id, repositoryId))
          .run();
        for (const prune of history.prunes ?? []) {
          transaction
            .insert(graphHistoryPrunes)
            .values({
              id: randomUUID(),
              repositoryId,
              removedCount: prune.removedCount,
              oldestKeptSequence: prune.oldestKeptSequence,
              keepLast: prune.keepLast,
              olderThan:
                prune.olderThan === null ? null : new Date(prune.olderThan),
              prunedAt: new Date(prune.prunedAt),
            })
            .run();
        }
        return {
          repositoryId,
          revisionCount: revisions.length,
          currentRevisionId: current.id,
        };
      });
    },

    pruneGraphRevisions(repositoryId, options) {
      const { keepLast, olderThan } = options;
      if (keepLast === undefined && olderThan === undefined) {
        throw new GraphHistoryError(
          "invalid_prune",
          "Choose how many revisions to keep, an age cutoff, or both.",
        );
      }
      if (
        keepLast !== undefined &&
        (!Number.isSafeInteger(keepLast) || keepLast < 1)
      ) {
        throw new GraphHistoryError(
          "invalid_prune",
          "keepLast must be a positive integer.",
        );
      }
      if (olderThan !== undefined && !Number.isFinite(olderThan)) {
        throw new GraphHistoryError(
          "invalid_prune",
          "olderThan must be a timestamp.",
        );
      }
      return db.transaction((transaction) => {
        const repository = transaction
          .select({ current: repositories.currentGraphRevisionId })
          .from(repositories)
          .where(eq(repositories.id, repositoryId))
          .get();
        if (!repository) return null;
        const ordered = transaction
          .select({
            id: graphRevisions.id,
            sequence: graphRevisions.sequence,
            createdAt: graphRevisions.createdAt,
          })
          .from(graphRevisions)
          .where(eq(graphRevisions.repositoryId, repositoryId))
          .orderBy(asc(graphRevisions.sequence))
          .all();
        // A revision is removed only if every given criterion selects it;
        // both criteria select a prefix, and the latest revision always stays.
        const limits = [ordered.length - 1];
        if (keepLast !== undefined)
          limits.push(Math.max(0, ordered.length - keepLast));
        if (olderThan !== undefined) {
          const firstRecent = ordered.findIndex(
            (revision) => revision.createdAt.getTime() >= olderThan,
          );
          limits.push(firstRecent === -1 ? ordered.length : firstRecent);
        }
        const count = Math.max(0, Math.min(...limits));
        const removed = ordered.slice(0, count).map((revision) => revision.id);
        if (removed.includes(repository.current ?? "")) {
          throw new StorageCorruptionError(
            "Prune would remove the current revision.",
          );
        }
        const oldestKept = ordered[count];
        if (count === 0 || !oldestKept) {
          return {
            removedCount: 0,
            keptCount: ordered.length,
            oldestKeptSequence: ordered[0]?.sequence ?? 0,
            prune: null,
          };
        }
        for (let start = 0; start < removed.length; start += 500) {
          const chunk = removed.slice(start, start + 500);
          transaction
            .update(graphRevisions)
            .set({ restoredFromRevisionId: null })
            .where(
              and(
                eq(graphRevisions.repositoryId, repositoryId),
                inArray(graphRevisions.restoredFromRevisionId, chunk),
              ),
            )
            .run();
        }
        transaction
          .update(graphRevisions)
          .set({ parentRevisionId: null })
          .where(eq(graphRevisions.id, oldestKept.id))
          .run();
        // Delete newest-first so no remaining row references a deleted parent.
        for (const id of [...removed].reverse()) {
          transaction
            .delete(graphRevisions)
            .where(eq(graphRevisions.id, id))
            .run();
        }
        const row = {
          id: randomUUID(),
          repositoryId,
          removedCount: count,
          oldestKeptSequence: oldestKept.sequence,
          keepLast: keepLast ?? null,
          olderThan: olderThan === undefined ? null : new Date(olderThan),
          prunedAt: new Date(),
        };
        transaction.insert(graphHistoryPrunes).values(row).run();
        return {
          removedCount: count,
          keptCount: ordered.length - count,
          oldestKeptSequence: oldestKept.sequence,
          prune: toPruneRecord(row),
        };
      });
    },

    listGraphHistoryPrunes(repositoryId) {
      return db
        .select()
        .from(graphHistoryPrunes)
        .where(eq(graphHistoryPrunes.repositoryId, repositoryId))
        .orderBy(asc(graphHistoryPrunes.prunedAt), asc(graphHistoryPrunes.id))
        .all()
        .map(toPruneRecord);
    },

    listRuleExceptions(repositoryId) {
      return db
        .select()
        .from(architectureRuleExceptions)
        .where(eq(architectureRuleExceptions.repositoryId, repositoryId))
        .orderBy(
          asc(architectureRuleExceptions.createdAt),
          asc(architectureRuleExceptions.id),
        )
        .all()
        .map(toRuleExceptionRecord);
    },

    createRuleException(exception) {
      return db.transaction((transaction) => {
        const repository = transaction
          .select({ id: repositories.id })
          .from(repositories)
          .where(eq(repositories.id, exception.repositoryId))
          .get();
        if (!repository) {
          throw new RuleExceptionConflictError(
            "repository_not_found",
            "No saved graph exists for this repository.",
          );
        }
        const active = transaction
          .select({ id: architectureRuleExceptions.id })
          .from(architectureRuleExceptions)
          .where(
            and(
              eq(
                architectureRuleExceptions.repositoryId,
                exception.repositoryId,
              ),
              eq(architectureRuleExceptions.findingKey, exception.findingKey),
              isNull(architectureRuleExceptions.revokedAt),
            ),
          )
          .get();
        if (active) {
          throw new RuleExceptionConflictError(
            "active_exception_exists",
            "This finding already has an active exception; revoke it before recording another.",
          );
        }
        const row = {
          id: randomUUID(),
          repositoryId: exception.repositoryId,
          findingKey: exception.findingKey,
          ruleId: exception.ruleId,
          entityIdsJson: JSON.stringify([...exception.entityIds].sort()),
          rationale: exception.rationale,
          author: exception.author,
          createdAt: new Date(),
          expiresAt:
            exception.expiresAt === null ? null : new Date(exception.expiresAt),
          revokedAt: null,
          revokedBy: null,
          revokeReason: null,
        };
        transaction.insert(architectureRuleExceptions).values(row).run();
        return toRuleExceptionRecord(row);
      });
    },

    revokeRuleException(repositoryId, exceptionId, revocation) {
      return db.transaction((transaction) => {
        const existing = transaction
          .select()
          .from(architectureRuleExceptions)
          .where(
            and(
              eq(architectureRuleExceptions.repositoryId, repositoryId),
              eq(architectureRuleExceptions.id, exceptionId),
            ),
          )
          .get();
        if (!existing) return null;
        if (existing.revokedAt) {
          throw new RuleExceptionConflictError(
            "already_revoked",
            "This exception was already revoked.",
          );
        }
        const revokedAt = new Date(
          Math.max(Date.now(), existing.createdAt.getTime()),
        );
        transaction
          .update(architectureRuleExceptions)
          .set({
            revokedAt,
            revokedBy: revocation.revokedBy,
            revokeReason: revocation.reason,
          })
          .where(eq(architectureRuleExceptions.id, exceptionId))
          .run();
        return toRuleExceptionRecord({
          ...existing,
          revokedAt,
          revokedBy: revocation.revokedBy,
          revokeReason: revocation.reason,
        });
      });
    },

    replaceGraph(snapshot, committedJob) {
      commitSnapshot(snapshot, committedJob ? { committedJob } : {});
    },

    close() {
      sqlite.close();
    },
  };

  /** Replaces the normalized current-graph rows for a repository. */
  function writeCurrentGraph(
    transaction: Transaction,
    snapshot: GraphSnapshot,
  ): void {
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
  }

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

      writeCurrentGraph(transaction, snapshot);

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

function toRuleExceptionRecord(
  row: typeof architectureRuleExceptions.$inferSelect,
): RuleExceptionRecord {
  return {
    id: row.id,
    repositoryId: row.repositoryId,
    findingKey: row.findingKey,
    ruleId: row.ruleId,
    entityIds: parseJson<string[]>(row.entityIdsJson, "exception entity IDs"),
    rationale: row.rationale,
    author: row.author,
    createdAt: row.createdAt.getTime(),
    expiresAt: row.expiresAt?.getTime() ?? null,
    revokedAt: row.revokedAt?.getTime() ?? null,
    revokedBy: row.revokedBy,
    revokeReason: row.revokeReason,
  };
}

type Transaction = Parameters<
  Parameters<BetterSQLite3Database<typeof schema>["transaction"]>[0]
>[0];

function toPruneRecord(
  row: typeof graphHistoryPrunes.$inferSelect,
): GraphHistoryPruneRecord {
  return {
    id: row.id,
    repositoryId: row.repositoryId,
    removedCount: row.removedCount,
    oldestKeptSequence: row.oldestKeptSequence,
    keepLast: row.keepLast,
    olderThan: row.olderThan?.getTime() ?? null,
    prunedAt: row.prunedAt.getTime(),
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
