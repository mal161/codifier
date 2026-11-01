# Repository analysis pipeline

## Purpose and status

This document defines implementation boundaries for turning a selected repository into an evidence-backed graph inside the standalone local companion agent. It follows the accepted direction to use Tree-sitter for syntax analysis, language-specific semantic adapters for deeper resolution, and a common intermediate representation (IR) before graph ingestion. TypeScript/JavaScript is the first target; exact construct and framework coverage must be validated with fixtures.

The agent persists local graph state in SQLite and optionally synchronizes approved graph metadata/events to cloud PostgreSQL. Exact parser bindings, schema/migrations, sync conflict policy, and deployment provider remain open implementation decisions.

## Pipeline

```text
Repository selection
    -> bounded file inventory
    -> language and file classification
    -> syntax parsing
    -> optional semantic resolution
    -> versioned intermediate representation
    -> identity reconciliation and graph update
    -> diagnostics, queries, and source navigation
```

The stages have explicit inputs and outputs so that parser failures, unsupported syntax, and partial results are visible instead of becoming silent omissions.

## Initial implementation boundary

The first working TypeScript/JavaScript slice is in `packages/analysis-core` and is invoked through the authenticated local agent. It uses the TypeScript compiler AST to inventory `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`, `.mjs`, and `.cjs`; extracts named top-level and nested declarations, static imports/re-exports, local JSX component references, and a bounded set of HTTP route-registration patterns; emits file/symbol entities, containment, resolved `IMPORTS`/`REEXPORTS`, same-file `RENDERS`, and `ROUTES_TO` relationships with evidence and line/column locators; and reports syntax errors, unsupported files, read failures, and configured size/file limits. React-like rendering relationships require a uniquely matched same-file uppercase JSX tag. Route relationships require a direct `app.*` or `router.*` call, a static path, and a uniquely matched local handler or inline function. These are syntax-backed patterns, not proof of framework identity or runtime behavior.

Import resolution supports relative paths, inherited `compilerOptions.paths` aliases from the nearest in-repository `tsconfig.json`, and local package names declared by inventoried `package.json` files. This allows separate projects in a monorepo to use project-specific aliases. Relative imports that target inventoried files with unsupported extensions receive an `unsupported_local_import` diagnostic at the import source range, rather than being described as unresolved source imports. Up to 32 project configurations are considered; their inherited configuration reads share limits of 32 files and 4 MiB total, with individual files capped at 1 MiB. Configuration reads are restricted to the selected repository. Symlinked configs are ignored, out-of-root configs are not read, and invalid or unavailable config details are reported. Package root/subpath targets use conditional or wildcard `exports` when present, otherwise the package's declared type/runtime entry fields or direct subpaths; targets must stay within the package and resolve to an inventoried source file. Duplicate package names are diagnosed and left unresolved. This remains syntax/module-resolution support, not project-wide type or call resolution.

Re-analysis accepts the previous graph. Exact paths retain file identity; an unchanged uniquely hashed file can retain its identity after a move. Symbols are matched by unique syntax fingerprints across moves, or by unique kind/name within an unchanged path. Ambiguous matches produce diagnostics and distinct deterministic IDs. File hashes are stored only as evidence descriptions for local move reconciliation; source contents are not stored in graph evidence.

Before opening a saved source locator in VS Code, the local web client can ask the authenticated agent to check its freshness. The agent resolves the user-provided repository root, verifies that the locator remains inside that root, refuses a final symlink, and compares the bounded current file hash with the recorded file evidence. A missing or changed file is stale; unsafe, oversized, unreadable, or un-fingerprinted inputs are unresolved. The result is point-in-time, and the client requires a current result before enabling the link. It does not redirect to a guessed replacement.

Analysis reports now compare the analyzed path/hash set with the previous graph and classify additions, edits, removals, and uniquely evidenced renames. The classification is returned by synchronous analyze calls and durable job results. Identical analyzed inputs report `unchanged`. Any detected change re-resolves imports and re-exports across the whole inventory before atomic snapshot replacement. With the agent's in-memory parse cache, only files whose path or content hash changed are re-parsed and syntax-checked; `reconciliation.parseReuse` reports the counts ([ADR 0016](decisions/0016-in-memory-parse-cache.md)). Inventory paths omitted because they are ignored or excluded are not treated as deletions. Equivalence with a clean analysis is tested for no-op, edit, deleted import target, addition, rename, and TypeScript-config-only changes.

The AST adapter is a bounded first implementation, not a resolution of the broader Tree-sitter packaging direction. Revisit Tree-sitter when validating cross-platform parser packaging or adding language adapters. An incomplete parse/inventory is returned with diagnostics and does not replace the stored graph.

The local agent also exposes authenticated analysis jobs for clients that need live progress or cancellation. A job reports inventory, reading, parsing, relationship-resolution, and persistence stages; clients poll its status and may cancel queued or running work. After a successful graph write, the job result includes counts of added, changed, and removed entities and relationships; the first saved graph is identified as an initial analysis. Results that are cancelled, failed, or incomplete do not include a change summary. An incomplete result lists its persistence blockers (failed files, skipped files, inventory truncation, or no analyzable files) with up to five example paths and reason codes each; these are tracked separately from diagnostics, so they survive the diagnostic limit. The analyzer yields between directory batches and files so cancellation requests can be handled promptly. Cancellation never writes a partial graph. Job requests, progress, and outcomes are persisted in SQLite. If the agent restarts with a queued or running job, it marks that job failed with a retry message; the last committed graph remains current and the user can safely start a new analysis. The agent runs at most two jobs concurrently and retains at most 50 job records. The older synchronous analyze endpoints remain available for CLI compatibility.

During analysis the local agent also reads Git metadata without executing repository code: commit ID, current branch when available, and whether the working tree is clean or dirty. The commit ID becomes the source revision unless the caller explicitly supplies a revision. Dirty trees are supported; recorded source ranges refer to the analyzed working tree and the commit records its HEAD baseline. Non-Git repositories remain analyzable, and Git metadata is stored only as graph context.

## Stage responsibilities

### 1. Repository selection and inventory

- Accept a user-selected repository root; validate and normalize the path at the boundary.
- Apply the repository policy selected before implementation: ignore rules, generated/vendor paths, file-size limits, symlink policy, and supported file types.
- Do not follow a symlink outside the authorized repository boundary unless a future explicit policy permits it.
- Inventory counts and exclusions should be available to the user.
- Inventory reads root and nested `.gitignore` files with bounded file-count and byte budgets. It supports common `*`, `**`, `?`, slash-scoped rules, directory rules, and ordered negation when the parent directory itself is not excluded; escaped pattern and bracket character-class syntax is reported and skipped. The agent API and local web analysis form accept `respectGitignore: false` to disable those rules and `excludePatterns` to add bounded repository-relative glob exclusions. User exclusions are additive; built-in safety directories and repository-root checks cannot be overridden. As required by Git ignore semantics, a file cannot be re-included while an ancestor directory remains excluded. Gitignored and user-excluded paths are reported as diagnostics but are outside the analysis scope: they do not count as skipped files and do not prevent an otherwise complete pass from being persisted. Gitignored directories are not entered; one diagnostic covers the directory and its contents. Symlinks are likewise reported but not followed and do not block persistence ([ADR 0013](decisions/0013-symlinks-out-of-analysis-scope.md)).
- Never execute repository code during indexing.

### 2. Classification

- Map files to supported language/parser adapters using deterministic rules.
- Treat ambiguous, generated, binary, and unsupported files according to documented policy.
- Report the reason a file was skipped or not analyzed.
- Keep file inventory results separate from parser results so partial language support remains visible.

### 3. Syntax parsing

- Use Tree-sitter as the approved syntax-analysis direction.
- Extract only constructs supported by the selected grammar and adapter.
- Record parse errors and recovered nodes; do not treat recovery as complete certainty.
- Parser output must retain source ranges and file/revision context.

### 4. Semantic resolution

- Use language-specific adapters for relationships requiring symbol resolution, such as cross-file references or resolved calls.
- Keep syntactic imports, resolved dependencies, and inferred call paths distinct.
- If the environment cannot resolve a relationship, return unresolved/unknown rather than inventing a target.
- Additional languages require fixture coverage and an explicit support statement.

### 5. Intermediate representation

The IR is the stable boundary between language-specific tools and the graph. It should be versioned and include:

- Repository and source revision identifiers.
- Files and discovered symbols with source ranges.
- Typed candidate relationships and their resolution status.
- Evidence/provenance references.
- Diagnostics, coverage, and unsupported constructs.

The IR must not encode UI-specific layout or assume a particular storage schema.

### 6. Graph ingestion and reconciliation

- Validate IR records before they enter the graph.
- Reconcile entity identity conservatively using the graph's identity rules.
- Apply updates transactionally or with an equivalent consistency guarantee appropriate to the selected storage.
- Preserve valid results when another file fails.
- Emit a change summary and diagnostics; do not silently discard errors.

See the [canonical graph specification](CANONICAL_GRAPH.md) for entities, evidence, source locations, and invariants.

## Incremental analysis

The target is to analyze changed files and the affected dependency neighborhood rather than repeatedly processing the entire repository. The exact invalidation algorithm depends on language tooling and must be measured.

At minimum:

1. Detect file additions, changes, deletions, and renames.
2. Reparse changed files and invalidate dependent semantic resolutions when needed.
3. Preserve identities for unaffected entities.
4. Mark old source ranges and edges stale when they cannot be refreshed.
5. Report changed, removed, unresolved, and retained results.
6. Provide a full re-analysis path to recover from inconsistent cache state.

Incremental behavior must be tested against a clean full analysis of the same revision.

## Failure and partial-result behavior

- A parse failure in one file must not discard successful analysis from other files.
- Cancellation must stop work promptly and leave graph state consistent.
- Job progress is advisory and file-granular; TypeScript program construction is synchronous, then syntax diagnostics and graph construction yield between source files.
- Unsupported syntax or language features must be reported with actionable context.
- External tool failures must identify the failed stage and preserve diagnostics.
- No empty or success-shaped result may conceal a failed analysis.

## Determinism and testing

For a fixed repository revision, toolchain version, and configuration, structural output should be deterministic where possible. Golden repositories should cover:

- Nested declarations, exports, imports, and duplicate symbol names.
- Project-specific TypeScript path aliases in a React/Express-style workspace.
- Relative imports of inventoried but unsupported assets, such as CSS, with source-range diagnostics.
- Local JSX component references, HTTP route-registration patterns, and resolved re-export edges, including their documented resolution limits.
- Syntax errors and parser recovery.
- Cross-file references supported by each adapter.
- File moves/renames and ambiguous identity matches.
- Exclusions, symlinks, oversized files, and unsupported file types.
- Exact source ranges and line-ending variations.
- Incremental results versus a clean analysis.

Use Vitest and golden repositories for domain, parser, graph, and sync behavior; add focused integration tests for storage, the agent API, and client flows. The [implementation plan](IMPLEMENTATION_PLAN.md) defines the MVP order and quality gates; the [development setup](DEVELOPMENT_SETUP.md) records remaining platform and policy decisions.
