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
  {
    id: "0003_graph_revisions",
    statements: [
      `CREATE TABLE graph_revisions (
        id TEXT PRIMARY KEY NOT NULL,
        repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
        parent_revision_id TEXT REFERENCES graph_revisions(id),
        sequence INTEGER NOT NULL,
        source_revision TEXT,
        content_hash TEXT NOT NULL,
        change_summary_json TEXT NOT NULL CHECK (json_valid(change_summary_json)),
        snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
        created_at INTEGER NOT NULL
      )`,
      `CREATE UNIQUE INDEX graph_revisions_repository_sequence
        ON graph_revisions(repository_id, sequence)`,
      `ALTER TABLE repositories
        ADD COLUMN current_graph_revision_id TEXT`,
    ],
  },
  {
    id: "0004_durable_analysis_jobs",
    statements: [
      `CREATE TABLE analysis_jobs (
        id TEXT PRIMARY KEY NOT NULL,
        repository_id TEXT NOT NULL,
        status TEXT NOT NULL,
        job_json TEXT NOT NULL CHECK (json_valid(job_json)),
        request_json TEXT NOT NULL CHECK (json_valid(request_json)),
        updated_at INTEGER NOT NULL
      )`,
      `CREATE INDEX analysis_jobs_updated_at ON analysis_jobs(updated_at)`,
    ],
  },
  {
    id: "0005_graph_revision_restore",
    statements: [
      `ALTER TABLE graph_revisions
        ADD COLUMN restored_from_revision_id TEXT REFERENCES graph_revisions(id)`,
    ],
  },
  {
    id: "0006_architecture_rule_exceptions",
    statements: [
      `CREATE TABLE architecture_rule_exceptions (
        id TEXT PRIMARY KEY NOT NULL,
        repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
        finding_key TEXT NOT NULL,
        rule_id TEXT NOT NULL,
        entity_ids_json TEXT NOT NULL CHECK (json_valid(entity_ids_json)),
        rationale TEXT NOT NULL CHECK (length(rationale) > 0),
        author TEXT NOT NULL CHECK (length(author) > 0),
        created_at INTEGER NOT NULL,
        expires_at INTEGER CHECK (expires_at IS NULL OR expires_at > created_at),
        revoked_at INTEGER,
        revoked_by TEXT,
        revoke_reason TEXT,
        CHECK (
          (revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL) OR
          (revoked_at IS NOT NULL AND length(revoked_by) > 0 AND length(revoke_reason) > 0)
        )
      )`,
      `CREATE INDEX architecture_rule_exceptions_repository
        ON architecture_rule_exceptions(repository_id, created_at)`,
      `CREATE UNIQUE INDEX architecture_rule_exceptions_one_active
        ON architecture_rule_exceptions(repository_id, finding_key)
        WHERE revoked_at IS NULL`,
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
