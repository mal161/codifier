import type BetterSqlite3 from "better-sqlite3";

interface Migration {
  id: string;
  statements: string[];
}

const migrations: Migration[] = [
  {
    id: "0001_initial_graph",
    statements: [
      `CREATE TABLE repositories (
        id TEXT PRIMARY KEY NOT NULL,
        revision TEXT,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE evidence (
        id TEXT PRIMARY KEY NOT NULL,
        repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
        origin TEXT NOT NULL,
        description TEXT NOT NULL,
        source_json TEXT CHECK (source_json IS NULL OR json_valid(source_json)),
        UNIQUE (repository_id, id)
      )`,
      `CREATE INDEX evidence_repository_id ON evidence(repository_id)`,
      `CREATE TABLE entities (
        id TEXT PRIMARY KEY NOT NULL,
        repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('actual', 'intended')),
        evidence_ids_json TEXT NOT NULL CHECK (json_valid(evidence_ids_json)),
        source_json TEXT CHECK (source_json IS NULL OR json_valid(source_json)),
        UNIQUE (repository_id, id)
      )`,
      `CREATE INDEX entities_repository_id_name ON entities(repository_id, name)`,
      `CREATE TABLE relationships (
        id TEXT PRIMARY KEY NOT NULL,
        repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
        source_entity_id TEXT NOT NULL,
        target_entity_id TEXT NOT NULL,
        type TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('actual', 'intended')),
        evidence_ids_json TEXT NOT NULL CHECK (json_valid(evidence_ids_json)),
        FOREIGN KEY (repository_id, source_entity_id)
          REFERENCES entities(repository_id, id) ON DELETE CASCADE,
        FOREIGN KEY (repository_id, target_entity_id)
          REFERENCES entities(repository_id, id) ON DELETE CASCADE
      )`,
      `CREATE INDEX relationships_repository_source
        ON relationships(repository_id, source_entity_id)`,
      `CREATE INDEX relationships_repository_target
        ON relationships(repository_id, target_entity_id)`,
    ],
  },
  {
    id: "0002_repository_git_context",
    statements: [
      `ALTER TABLE repositories
        ADD COLUMN git_context_json TEXT
        CHECK (git_context_json IS NULL OR json_valid(git_context_json))`,
    ],
  },
];

export function applyMigrations(database: BetterSqlite3.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS codifier_migrations (
      id TEXT PRIMARY KEY NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `);

  const isApplied = database.prepare(
    "SELECT 1 FROM codifier_migrations WHERE id = ?",
  );
  const recordMigration = database.prepare(
    "INSERT INTO codifier_migrations (id, applied_at) VALUES (?, ?)",
  );

  for (const migration of migrations) {
    if (isApplied.get(migration.id)) {
      continue;
    }

    database.exec("BEGIN IMMEDIATE");
    try {
      for (const statement of migration.statements) {
        database.exec(statement);
      }
      recordMigration.run(migration.id, Date.now());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw new Error(`Failed to apply storage migration ${migration.id}.`, {
        cause: error,
      });
    }
  }
}
