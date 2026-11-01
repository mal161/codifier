# 0013: Symlinks are outside the analysis scope

- Status: accepted
- Date: 2026-11-01

## Context

The analyzer has never followed symbolic links, but it counted each symlinked file as a skipped file. Persistence requires a pass with no skipped files, so a single symlink anywhere in a repository prevented its graph from ever being saved. Gitignored and user-excluded paths had the same problem and were changed to be reported without blocking persistence. This record settles the symlink part of open item O-009.

## Decision

- Inventory does not follow symlinks, to files or directories, and does not read their targets.
- Each symlink is reported with a `symlink_ignored` warning diagnostic. It is not counted as a discovered or skipped file and does not prevent an otherwise complete pass from being persisted.
- A symlink whose target is inside the repository adds no missing content, because the target is analyzed at its own path. A target outside the repository must not be read under the repository-boundary rule.

## Alternatives considered

- Keep blocking persistence: rejected because a single symlink would prevent saving any graph, with no way for the user to resolve it other than deleting the link.
- Follow symlinks whose canonical target stays inside the repository: deferred. It would duplicate files already analyzed at their real path and complicate stable identity, without adding coverage.
- Record symlinks as graph entities: deferred until a workflow needs link-level navigation.

## Consequences

- Repositories containing symlinks can be analyzed and persisted. Each link is still visible as a diagnostic.
- Imports written through a symlinked path do not resolve to the link's target and appear as unresolved local imports.
- Symlink-only content whose target lies outside the repository is absent from the graph by design.
