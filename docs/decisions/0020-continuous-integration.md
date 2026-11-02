# 0020: Continuous integration on GitHub Actions

- Status: accepted
- Date: 2026-11-02

## Context

Checks and the Phase 6 acceptance walkthrough had only been run on one Windows machine. The walkthrough and the product make no deliberate platform-specific choices, but macOS and Linux behavior (paths, native SQLite binaries, process handling, Git) was unverified. Repository guidance requires infrastructure to have a documented purpose and owner.

## Decision

- `.github/workflows/ci.yml` runs on pushes to `main` and on pull requests, on `ubuntu-latest`, `macos-latest`, and `windows-latest` with fail-fast disabled.
- Each job uses Node 24 and the repository's pinned pnpm through corepack, installs with `--frozen-lockfile`, runs `pnpm check` (lint, typecheck, unit tests), then `pnpm acceptance`, and uploads the walkthrough report as an artifact.
- A second job runs the VS Code Extension Host suite on the same three operating systems against VS Code 1.90.0 (the manifest floor) and current stable, downloading official builds from Microsoft's update service (ADR 0019).
- The workflow has read-only repository permissions, needs no secrets, and sends no repository content anywhere except GitHub's own runners.
- Owner: the repository maintainer. A red job blocks claims of platform support until fixed or explicitly scoped out in docs.

## Not included

- The browser driver and the NVDA screen-reader flow (need Playwright outside the repository, and NVDA on Windows); they remain local checks.
- `format:check`, until the few files that predate the formatter configuration are reformatted in a dedicated change.

## Alternatives considered

- Manual runs on borrowed machines: no continuing evidence.
- Linux only: cheaper, but leaves macOS unverified.

## Consequences

- Every push to `main` produces platform evidence for the checks and the acceptance walkthrough.
- CI minutes are consumed on three operating systems; macOS minutes are the most expensive.
