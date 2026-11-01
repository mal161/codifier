# Remaining MVP implementation phases

This plan reconciles the two supplied implementation specifications with the current repository. The specifications' audit labels are not treated as evidence. Work starts from the code and documents listed in each phase, and a feature is complete only when its exit gate has reproducible evidence.

## Current baseline verified in this worktree

- `packages/analysis-core` performs bounded TypeScript/JavaScript syntax analysis and returns a replacement snapshot. It has identity reconciliation, repository-root and symlink checks, but no file watcher or changed-file analysis pipeline.
- `packages/storage` keeps normalized current graph rows and appends validated SQLite snapshot revisions in the same transaction (ADR 0009). Authenticated routes list revisions, retrieve earlier snapshots, and restore one as a new revision (ADR 0014), and export verified history (ADR 0015); the web explorer lists, restores, and exports revisions. History import and retention are not implemented.
- Agent analysis job requests, progress, and outcomes now persist. On restart, queued/running jobs are marked failed with a retry message; resume-from-checkpoint and failure-injection verification remain unimplemented.
- The local web app supports graph-to-source URI opening and explicit source-location lookup. Phase 4 adds a local-agent fingerprint check before enabling the VS Code link; there is still no VS Code extension or automatic background freshness monitoring.
- Intended components and observed mappings exist. A general intended-vs-actual discrepancy review and documented exception lifecycle are not implemented.
- Git metadata, basic local architecture rules, template catalog, and neighborhood map are present. They do not establish broader Git history, rule packs, marketplace, or full graph visualization support.
- The current fixture named `react-express-workspace` is synthetic and uses the local stack; it is not the separate representative React/Express acceptance repository requested by the specification.
- Root and nested `.gitignore` rules support common glob patterns and ordered negation; unsupported escaped/bracket-class patterns are diagnosed. Additive exclusion patterns are exposed in the API and web analysis form. Re-inclusion under an excluded ancestor remains prohibited, consistent with Git ignore behavior. Phase 1 code is in place and its focused analysis-core tests ran green on 2026-11-01 (Windows; the symlink fixture self-skips when the OS denies symlink creation).
- Cloud sync is not implemented. Its inclusion in an MVP release remains conditional on the data policy and conflict decisions in the remaining-features specification.

## Phase sequence

### Phase 0 — Baseline and safety reconciliation

**Purpose:** establish accurate status and preserve valid current behavior before changing persistence or analysis semantics.

**Work**

- Maintain this evidence-based baseline as the source of truth; map each change to the relevant product requirement and existing ADR.
- Review local-agent authentication, Host/Origin checks, repository path validation, graph validation, and persistence failure behavior against the correction specification.
- Correct documentation that calls a proposal an accepted decision or reports a feature as complete without evidence.
- Keep current TypeScript compiler AST analysis unless a measured coverage, packaging, or correctness gap justifies an adapter change and ADR update.

**Exit gate:** each MVP item is marked implemented, partial, absent, deferred, or decision-blocked with code/doc/test evidence; no proposal is silently promoted to a decision.

### Phase 1 — Repository policy and graph/source contracts (implementation in place; verification pending)

**Purpose:** make inventory, provenance, source ranges, and policy predictable before adding incremental mutation.

**Work**

- Verify ignore behavior against Git-compatible fixtures: nested `.gitignore`, negation semantics, deterministic precedence, and explicit diagnostics for unreadable or oversized ignore files.
- Keep exclusion patterns and ignore behavior exposed in both the web analysis flow and agent API; validate patterns at each boundary.
- Preserve non-overridable hard exclusions, symlink refusal, and canonical repository-root checks.
- Document and enforce source range conventions, mapping provenance, and intended/actual separation.
- Keep source-location lookup and editor URI path/line encoding consistent with the source locator contract; implement stale/unresolved state in Phase 4.

**Exit gate:** inventory is deterministic under a recorded policy; out-of-root paths cannot be read; skipped items have reasons; range and mapping contracts are documented and covered by focused checks.

### Phase 2 — Durable graph revisions and recoverable jobs (storage, restore, export, and failure-injection coverage implemented; import and retention pending)

**Purpose:** implement accepted ADR 0004 before incremental analysis can mutate snapshots.

**Work**

- Add transactional graph revisions/change events with permanent entity UUID continuity and explicit parent/input revision. The append-only snapshot history and atomic current-pointer update are implemented in SQLite under [ADR 0009](decisions/0009-local-graph-revision-storage.md); verification and API exposure remain.
- Keep the current snapshot as a pointer to a committed revision; failed analysis must leave the last committed graph readable.
- Persist job requests, progress, and outcomes across restart; interrupted queued/running jobs are marked failed and can be safely retried from the last committed graph. Do not persist source contents in history.
- Commit successful analysis job outcome atomically with its graph snapshot and revision; throttled progress checkpoints are advisory only.
- Add migrations, export/recovery behavior, retention notes, and failure-injection coverage.
- **Implemented:** restore commits a verified earlier snapshot as a new revision with `restored_from_revision_id`; an identical restore is a no-op. Storage tests cover ordering across reopen, tampered history, rollback of a mid-transaction constraint failure, and duplicate job retries ([ADR 0014](decisions/0014-graph-revision-restore.md)).
- **Implemented:** verified history export through the agent, the CLI (`graph history`), and the web explorer ([ADR 0015](decisions/0015-graph-history-export.md)); a web revision-history card with confirm-before-restore; an agent test for the restore-while-analyzing `409`.
- **Pending:** history import into a new database, a retention/pruning policy (needs a decision), a VS Code restore control, and a manual browser check of the history card.

**Exit gate:** restart and injected failures preserve revision ordering and graph validity; retries do not create duplicate semantic revisions; restore creates a new revision and does not erase history.

### Phase 3 — Incremental analysis and reconciliation (parse reuse and clean-equivalence evidence implemented; file watcher deferred)

**Purpose:** synchronize file changes while retaining identities and producing the same graph as a clean analysis.

**Work**

- Add changed-file discovery (watcher as an optimization) for add, edit, delete, and rename; provide explicit full reconciliation.
- **Implemented:** refresh reports classify additions, edits, removals, and uniquely evidenced renames; synchronous API and durable-job responses expose the classification, and the web explorer shows the full-reconciliation fallback.
- **Implemented:** the agent keeps an in-memory parse cache; only files whose path or content hash changed are re-parsed and syntax-checked, while import/export resolution, identity, and relationships are recomputed across the whole inventory so unchanged importers are re-resolved ([ADR 0016](decisions/0016-in-memory-parse-cache.md)). Reports and the web reconciliation card show parsed versus reused counts.
- **Exit-gate evidence:** `packages/analysis-core/test/incremental.test.ts` asserts cached incremental output equals a clean pass (snapshot including evidence and ranges, diagnostics, coverage, reconciliation) for no-op, edit, deleted import target, addition, rename, tsconfig-only change, and cached syntax errors, and that unchanged file UUIDs are kept. No-op refresh adding no revision is covered by storage tests (ADR 0009) and the live agent check.
- **Not implemented:** a file watcher (optional optimization); every refresh still reads and hashes all inventoried files, and the cache is empty after an agent restart.
- Reanalyze affected inputs and invalidate dependent import/export resolutions where needed.
- Preserve unchanged UUIDs; only preserve rename identity when evidence is unambiguous; report ambiguity.
- Replace obsolete relationships atomically, surface removed/stale facts, and expose job progress/results in the UI.
- Reconcile after missed watcher events and recover interrupted jobs using Phase 2 durability.

**Exit gate:** normalized incremental output equals clean analysis for golden change scenarios, including evidence and ranges; unchanged entities retain UUIDs; no-op refresh adds no semantic revision.

### Phase 4 — Traceability, drift review, and accessible web workflow (freshness, drift conflicts, source-located findings, exceptions, and WCAG 2.2 AA review implemented; assistive-technology testing pending)

**Purpose:** close both navigation directions and make architecture discrepancies reviewable.

**Work**

- Add freshness validation for source locations after edits, rename, deletion, duplicate symbols, and file replacement. Uncertain references become stale/unresolved.
- **Implemented:** the authenticated local agent compares a selected entity's current regular file against its recorded analyzer SHA-256 evidence. Missing or changed files are stale; unsafe or unverifiable paths are unresolved. The web client requires a current check before enabling the editor link.
- Complete symbol-to-intended-component and component-to-symbol navigation with explicit mapping provenance and reversible user decisions.
- **Implemented:** mapped code relationships carry developer evidence, code-to-component mapping can be removed through the local agent, and mapped dependency drift is reviewed from both intended component dependencies and actual imports between mapped entities.
- Compare intended and actual entities/relationships; report missing, unexpected, and conflicting facts with evidence and source locations.
- **Implemented:** rule set 1.2.0 adds nested-ownership conflicts (code mapped to a component disjoint from its container's) and intended-dependency cycles, notes reversed dependencies, and gives every finding up to 10 source locations plus a total count; intent-only findings say they have none. Evaluation is linear-time and covered by a large-graph regression test ([ADR 0018](decisions/0018-rule-set-1-2-drift-conflicts-and-locations.md)).
- Add auditable exceptions with author, rationale, scope, and optional expiry/status without mutating intended architecture.
- **Implemented:** append-only exception records keyed by a stable finding key (rule plus permanent entity UUIDs), stored outside the graph, with active/expired/revoked status, revoke-with-reason, and one unrevoked exception per finding. Excepted findings stay listed in the rules page with the reviewer, date, expiry, and rationale. Author names are self-attested. Covered by storage, agent, contract, and client tests and the run-codifier browser flow ([ADR 0017](decisions/0017-auditable-rule-exceptions.md)).
- Ensure the graph has keyboard-operable controls and an equivalent structured view; review critical paths against WCAG 2.2 AA and record findings.
- **Implemented:** WCAG 2.2 AA review recorded in [ACCESSIBILITY_REVIEW.md](ACCESSIBILITY_REVIEW.md): automated axe-core plus scripted keyboard, focus-obscured, target-size, and reflow checks over six UI states; contrast, non-text contrast, reflow, focus-obscured, target-size, label-in-name, and role issues fixed; repeatable with `run-codifier --flow a11y`.

Phase 4 remains in progress only for verification beyond automation: screen-reader and speech-input testing, the 1.4.12 text-spacing check, and the React Flow controls naming item listed in the accessibility review.

**Exit gate:** bidirectional navigation and drift scenarios work against the real agent API; stale links never silently redirect; exceptions are reviewable and reversible; accessibility findings are recorded and resolved or tracked.

### Phase 5 — VS Code extension (initial client implemented; host and package verification pending)

**Purpose:** make the IDE a client of the same local agent and graph.

**Work**

- Create a real extension with connection/status, secure pairing/token storage, architecture lookup, and source-to-architecture and architecture-to-source navigation.
- **Implemented:** `apps/vscode-extension` provides commands to connect to the local agent, check status, analyze a workspace with durable jobs, look up architecture for the active file, and open a selected graph item at its exact source range after freshness validation. It stores the token in VS Code SecretStorage and restricts agent URLs to loopback HTTP.
- **Implemented:** the adapter uses the existing REST request shapes and validates the graph/job/freshness response fields it consumes; it does not scan or parse repository files.
- Handle unavailable agent, authentication failure, repository mismatch, and stale locations.
- **Implemented:** command flows surface agent/network/auth failures, bind repository IDs to workspace paths, reject workspace mismatches, and refuse stale or unresolved source locations.
- Reuse agent contracts; do not add a second analyzer or direct repository scanner.
- Document packaging and supported versions only after actual host runs.
- **Complete:** `vsce` packaged `apps/vscode-extension/codifier-vscode-0.1.0.vsix`; generated Turbo artifacts are excluded. Rebuild with `pnpm --filter codifier-vscode exec vsce package --no-dependencies --allow-missing-repository`.
- **Pending:** Extension Host launch/manual workflow, VSIX installation, and cross-platform verification. Manifest API floor is declared but not claimed as a tested supported-version range.

**Exit gate:** extension-host coverage and a manual supported-platform workflow demonstrate auth, failure states, lookup, and exact range opening; no token appears in logs or URLs.

Phase 5 remains in progress until those manual host/package checks are completed.

### Phase 6 — Representative React/Express acceptance walkthrough

**Purpose:** prove the complete local MVP on a separate, representative project.

**Work**

- Establish a reproducible React/TypeScript frontend plus Node/Express backend repository or maintained fixture that is distinct from Codifier and contains realistic routes, imports, and architecture intent.
- Script/document repository registration, clean analysis, graph exploration, exact navigation in both directions, source edit, incremental update, stable identity, drift finding, and offline use.
- Preserve expected assertions and captured outcomes; do not preseed graph results or substitute mocks.

**Exit gate:** a reviewer can repeat the walkthrough from documented setup and observe every assertion using the local agent and real analyzed files.

### Phase 7 — Conditional cloud synchronization

**Purpose:** add optional remote sync only after local revisions and authorization boundaries are stable.

**Precondition:** resolve both data questions in the remaining-features specification: which graph metadata may sync (source content remains off by default) and how concurrent intended-architecture edits are resolved. Record decisions in ADRs before implementation.

**Work after decision:** PostgreSQL persistence, authenticated workspace/repository authorization, durable SQLite outbox, idempotency and ordering, retries/backoff, tombstones, visible conflicts, and explicit resolution. Local analysis remains usable offline and sync opt-in.

**Exit gate:** offline-to-online, duplicate retry, out-of-order, simultaneous edit, authorization, tenant-isolation, and service-outage scenarios pass without silent overwrite or source upload outside policy.

### Phase 8 — Release quality and support evidence

**Purpose:** close release blockers without expanding into deferred product scope.

**Work:** security and boundary review; accessibility closure; supported OS/editor packaging; operational/setup docs; regression review; release evidence and explicit limitations.

**Exit gate:** Phases 0–6 pass. Phase 7 passes only if cloud sync is selected as release scope. No MVP claim is made while graph integrity, identity, exact navigation, offline operation, or the Phase 6 walkthrough is incomplete.

## Deferred scope

Do not pull broad call-graph analysis, additional languages, AI explanations/provider orchestration, runtime instrumentation, rule-pack marketplace, enterprise governance, billing, or multi-deployment into these phases without a new product decision. Keep the current AST adapter honest about its bounded coverage.

## Work sequencing notes

- Phase 1's ignore and configurable exclusion behavior is implemented in analyzer, API, and web form; finish source-locator freshness and run its focused verification before Phase 2.
- Phase 3 has change-set discovery, unchanged-input parse reuse, whole-inventory re-resolution, and incremental-versus-clean equivalence tests. A file watcher remains an optional optimization.
- Phases 4 and 5 can overlap after the source-location contract stabilizes, but Phase 6 depends on the applicable parts of both.
- Phase 7 is blocked on the explicit data and conflict decisions, not on local offline MVP work.
- The prior worktree contains unrelated uncommitted changes. Review those changes independently; do not fold them into these phases without confirming their intent.
