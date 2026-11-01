# 0016: Reuse unchanged syntax trees through an in-memory parse cache

- Status: accepted
- Date: 2026-11-01

## Context

Phase 3 requires re-analysis of affected inputs and proof that incremental output equals a clean analysis. The analyzer rebuilt everything on every refresh: it re-parsed every file and re-ran syntax diagnostics through a TypeScript program over all files. Parsing and diagnostics depend only on one file's own content, while import resolution, identity reconciliation, and relationships depend on the whole file set and on project configuration.

## Decision

`createParseCache()` returns an opaque, process-local cache that `analyzeRepository` accepts as `parseCache`. Entries are keyed by script kind, canonical absolute path, and the file's SHA-256, and hold the parsed `ts.SourceFile` plus that file's syntax diagnostics. On a hit the analyzer reuses both; a TypeScript program is created only for files that missed. Import/export resolution, identity allocation, relationships, and reconciliation are always recomputed over the full inventory, so a change in one file correctly re-resolves imports in unchanged files (for example, a deleted import target).

The cache is bounded (default 32 MiB of source text and 20,000 files, least recently used first), keeps only the latest content per path, and is never written to disk. The local agent owns one cache for its process lifetime and passes it to every synchronous and durable analysis. Reports add optional `reconciliation.parseReuse: { reusedFiles, parsedFiles }`; `mode` values are unchanged.

## Alternatives considered

- Rebuild per-file facts from the previous graph snapshot. The graph does not retain imports' module specifiers or syntax diagnostics, and reconstruction would add a second source of truth.
- Persist parse results in SQLite. This stores source text at rest, conflicting with data-minimization guidance, and needs invalidation across TypeScript versions.
- Resolve imports only for changed files. This needs a reverse-dependency index that is invalidated by config, package-manifest, and file-set changes; whole-inventory resolution is cheap relative to parsing and correct by construction.

## Consequences

- Equivalence tests (`packages/analysis-core/test/incremental.test.ts`) compare cached incremental passes with clean passes over the same files and identity baseline for no-op, edit, deletion of an import target, addition, rename, TypeScript-config-only change, and cached syntax errors; deliberately keying by path alone makes three of them fail.
- Every refresh still reads and hashes every inventoried file; there is no file watcher. The first analysis after an agent restart parses everything.
- Cached syntax trees hold source text in agent memory up to the byte bound. Memory use per byte of source is higher than the source itself; measure on large repositories before raising the default.
