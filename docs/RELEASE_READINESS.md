# Release readiness — first local release

- Date: 2026-11-02
- Scope: the local, single-machine product — local agent and CLI, local web explorer, VS Code extension — run from a source checkout. Cloud sync is out of scope ([ADR 0021](decisions/0021-defer-cloud-sync-intent-only-scope.md)).
- Form of delivery: source checkout with `pnpm install --frozen-lockfile`, plus a locally built VSIX. There are no standalone installers, signed binaries, or marketplace listing.

## What the release claims, and the evidence

| Claim (Phase 8 exit gate) | Evidence |
|---|---|
| Graph integrity | Domain invariants validated on every write and read (storage tests); transactional revisions with rollback on injected mid-write failure (ADR 0009, 0014). |
| Stable identity | Unchanged entities keep UUIDs across edits and renames (analysis-core identity tests, incremental equivalence tests); 74/74 entities kept in the acceptance walkthrough. |
| Exact navigation | Source → architecture and architecture → source with freshness checks: web lookup tests, VS Code Extension Host suite (selection equals the recorded range), acceptance walkthrough (range text, editor link). |
| Offline operation | Acceptance walkthrough runs the agent with a guard that refuses non-loopback network access: no attempts logged. |
| Phase 6 walkthrough | `pnpm acceptance`: 41/41 locally and in CI on Linux, macOS, and Windows ([ACCEPTANCE_WALKTHROUGH.md](ACCEPTANCE_WALKTHROUGH.md)). |

Phase status: Phases 0–6 meet their exit gates for the platforms below; Phase 7 is deferred by decision; open items are listed under Limitations.

## Supported platforms

| Component | Verified | How |
|---|---|---|
| Local agent, CLI, analysis, storage | Linux, macOS, Windows (x64 runners; macOS on GitHub's current image) | CI: `pnpm check` and `pnpm acceptance` ([ADR 0020](decisions/0020-continuous-integration.md)) |
| Local web explorer | Windows, Microsoft Edge (Chromium) | `run-codifier` browser flows and WCAG audit; other browsers not tested |
| VS Code extension | Windows 11 x64, VS Code 1.144.0, from source and from the installed VSIX | Extension Host suite ([ADR 0019](decisions/0019-vscode-extension-host-verification.md)) |
| Runtime | Node.js 24 (`engines`: `>=24 <25`), pnpm 12 | `engine-strict=true` |

## Security and boundary review

Reviewed the local agent, the only component that reads repositories or listens on the network.

| Boundary | Finding |
|---|---|
| Network exposure | Binds to 127.0.0.1 only; refuses other bind addresses. |
| Authentication | Bearer token of at least 32 bytes, compared in constant time; required on every route including WebSocket upgrades; tokens come from the environment, never arguments. |
| Browser access | Host header must be `127.0.0.1` or `localhost` on the agent's port (DNS-rebinding defense); `Origin` must be on an explicit loopback allow-list; CORS reflects only allowed origins. |
| Input validation | All bodies validated with strict Zod schemas; 1 MiB body limit; 64 KiB WebSocket message limit. **Fixed:** the analysis `revision` label had no length bound; it is now limited to 256 characters. |
| File system | Repository roots are canonicalized; symlinks are not followed; reads are size-bounded; source-freshness refuses paths escaping the root and final symlinks. |
| Logging | Authorization header removed from request logs; request bodies (repository paths) are not logged; the acceptance walkthrough and VS Code suite confirm the token appears in no log, message, or profile file. |
| Data at rest | SQLite in the user's application-data directory; no source file contents stored; parse cache is memory-only (ADR 0016). |
| Dependencies | `pnpm audit --prod`: no known vulnerabilities. **Fixed:** Vite 7.3.1 → 7.3.7, which resolves eleven advisories including dev-server arbitrary file read and `server.fs` bypasses (relevant because the web explorer runs on Vite's dev server) and an esbuild dev-server advisory. **Remaining:** one moderate `minimatch` denial-of-service advisory reachable only through ESLint during development linting of repository-controlled patterns. |

Not reviewed: a formal threat model, penetration testing, or supply-chain provenance (signatures, SBOM).

## Accessibility

WCAG 2.2 Level A and AA review recorded in [ACCESSIBILITY_REVIEW.md](ACCESSIBILITY_REVIEW.md): zero axe violations in six UI states; keyboard, focus visibility, focus not obscured at 1440 and 320 px, target size, reflow, and text spacing checked by script. Screen-reader testing with NVDA 2026.2 and Edge 156 (18/18 steps) found and fixed unannounced status messages and lost focus when content is replaced or views change. Not done: NVDA browse-mode reading by a person, JAWS, VoiceOver, speech input, and testing with users with disabilities.

## Regression run on the release tree

| Check | Result |
|---|---|
| `pnpm check` (lint, typecheck, unit tests, 7 packages) | 21/21 tasks; 179 tests passed, 1 skipped (symlink case where Windows denies symlink creation) |
| `pnpm acceptance` | 41/41 |
| `run-codifier` browser flows (exceptions, dependencies, history) | pass, no console errors |
| `run-codifier --flow a11y` | 0 violations in all states |
| VS Code Extension Host suite | 12 scenarios plus 2 token-leak checks, pass |
| CI (Linux, macOS, Windows) | green on the last pushed commit before this change; re-runs on push |

## Limitations

- TypeScript and JavaScript only; syntax-level analysis with import resolution, no type or call resolution.
- Analysis limits: 10,000 files, 1 MiB per file, 100 MiB per run; overflow is reported, never silently dropped.
- Every refresh re-reads all files; only changed files are re-parsed while the agent runs; no file watcher.
- Single machine; no sync, sharing, or multi-user features (ADR 0021). Rule-exception authors are self-attested.
- VS Code extension verified only on Windows with VS Code 1.144.0; the declared floor of 1.90.0 is untested. Web explorer verified only in Chromium.
- History import works only for repositories the agent does not have yet; prune and import are available through the API and CLI, not the web explorer. History is kept until someone prunes it; there is no automatic limit (ADR 0022).
- Browser token pairing is manual (paste the token); tokens are not rotated automatically.
- No standalone installers or signed packages; run from source.
- AI features in the planning documents are not implemented.
