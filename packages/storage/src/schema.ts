import {
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const architectureRuleExceptions = sqliteTable(
  "architecture_rule_exceptions",
  {
    id: text("id").primaryKey(),
    repositoryId: text("repository_id").notNull(),
    findingKey: text("finding_key").notNull(),
    ruleId: text("rule_id").notNull(),
    entityIdsJson: text("entity_ids_json").notNull(),
    rationale: text("rationale").notNull(),
    author: text("author").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    revokedBy: text("revoked_by"),
    revokeReason: text("revoke_reason"),
  },
);

export const graphHistoryPrunes = sqliteTable("graph_history_prunes", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id").notNull(),
  removedCount: integer("removed_count").notNull(),
  oldestKeptSequence: integer("oldest_kept_sequence").notNull(),
  keepLast: integer("keep_last"),
  olderThan: integer("older_than", { mode: "timestamp_ms" }),
  prunedAt: integer("pruned_at", { mode: "timestamp_ms" }).notNull(),
});

export const repositories = sqliteTable("repositories", {
  id: text("id").primaryKey(),
  revision: text("revision"),
  gitContextJson: text("git_context_json"),
  currentGraphRevisionId: text("current_graph_revision_id"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const graphRevisions = sqliteTable(
  "graph_revisions",
  {
    id: text("id").primaryKey(),
    repositoryId: text("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    parentRevisionId: text("parent_revision_id"),
    sequence: integer("sequence").notNull(),
    sourceRevision: text("source_revision"),
    contentHash: text("content_hash").notNull(),
    changeSummaryJson: text("change_summary_json").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    restoredFromRevisionId: text("restored_from_revision_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.parentRevisionId],
      foreignColumns: [table.id],
      name: "graph_revision_parent",
    }),
    uniqueIndex("graph_revisions_repository_sequence").on(
      table.repositoryId,
      table.sequence,
    ),
  ],
);

export const analysisJobs = sqliteTable(
  "analysis_jobs",
  {
    id: text("id").primaryKey(),
    repositoryId: text("repository_id").notNull(),
    status: text("status").notNull(),
    jobJson: text("job_json").notNull(),
    requestJson: text("request_json").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("analysis_jobs_updated_at").on(table.updatedAt)],
);

export const evidence = sqliteTable(
  "evidence",
  {
    id: text("id").primaryKey(),
    repositoryId: text("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    origin: text("origin").notNull(),
    description: text("description").notNull(),
    sourceJson: text("source_json"),
  },
  (table) => [
    uniqueIndex("evidence_repository_id_id").on(table.repositoryId, table.id),
    index("evidence_repository_id").on(table.repositoryId),
  ],
);

export const entities = sqliteTable(
  "entities",
  {
    id: text("id").primaryKey(),
    repositoryId: text("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    state: text("state").notNull(),
    evidenceIdsJson: text("evidence_ids_json").notNull(),
    sourceJson: text("source_json"),
  },
  (table) => [
    uniqueIndex("entities_repository_id_id").on(table.repositoryId, table.id),
    index("entities_repository_id_name").on(table.repositoryId, table.name),
  ],
);

export const relationships = sqliteTable(
  "relationships",
  {
    id: text("id").primaryKey(),
    repositoryId: text("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    sourceEntityId: text("source_entity_id").notNull(),
    targetEntityId: text("target_entity_id").notNull(),
    type: text("type").notNull(),
    state: text("state").notNull(),
    evidenceIdsJson: text("evidence_ids_json").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.repositoryId, table.sourceEntityId],
      foreignColumns: [entities.repositoryId, entities.id],
      name: "relationships_source_entity",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.repositoryId, table.targetEntityId],
      foreignColumns: [entities.repositoryId, entities.id],
      name: "relationships_target_entity",
    }).onDelete("cascade"),
    index("relationships_repository_source").on(
      table.repositoryId,
      table.sourceEntityId,
    ),
    index("relationships_repository_target").on(
      table.repositoryId,
      table.targetEntityId,
    ),
  ],
);
