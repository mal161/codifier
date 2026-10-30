import {
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const repositories = sqliteTable("repositories", {
  id: text("id").primaryKey(),
  revision: text("revision"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

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
