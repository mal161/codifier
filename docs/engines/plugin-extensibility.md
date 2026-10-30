# Plugin Extensibility

## Status

**Approved as a product direction; implementation timing and contract are open.** The discussion says a plugin architecture has already been approved for technical extensions. It does not specify a plugin API or trust model.

## Purpose

Allow separately developed capabilities to integrate with Codifier through validated, versioned interfaces without coupling the core to every language, provider, or tool.

## Candidate extension points

- Language/parser and semantic adapters.
- Architecture notation import/export adapters.
- AI provider adapters.
- Read-only integrations and external tools.
- Additional analysis rules or graph views.

These are candidates, not a finalized extension API.

## Security and compatibility requirements

- Document the trust boundary and permissions before allowing plugin code to run.
- Do not execute repository-supplied plugins during indexing.
- Prefer declarative data/configuration where it meets the need.
- Version interfaces and validate all plugin inputs/outputs.
- Restrict filesystem, network, and graph write access by explicit capability.
- Keep plugin failure isolated and report it without corrupting graph state.
- Do not allow plugins to override tenant isolation, provenance, or security invariants.

## Decision gate

Before implementation, determine whether plugins are trusted first-party packages, user-installed third-party code, or both; define signing, distribution, permissions, compatibility, and support ownership.

See [architecture overview](../ARCHITECTURE.md), [platform customization](platform-customization.md), and [security and privacy](../SECURITY_PRIVACY.md).
