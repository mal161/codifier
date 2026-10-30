# Platform Customization

## Status

**Approved as a future platform direction; not MVP scope.**

## Purpose

Allow organizations to extend platform vocabulary and workflows through validated configuration without modifying core code or weakening graph and security invariants.

## Candidate customization types

- Custom entity and relationship types.
- Validated metadata fields.
- Organization-specific rules and review workflows.
- Saved dashboards, graph views, and terminology.
- Event-triggered automation using constrained, non-arbitrary execution.
- Portable, versioned configuration packages.

## Boundaries

- Customization is schema/configuration, not arbitrary code execution.
- Advanced executable extension belongs to a separately designed plugin system.
- Extensions must validate against canonical graph constraints and schema versions.
- Tenant isolation, access controls, and security policy cannot be overridden.
- Changes need compatibility/migration behavior and a reviewable diff.

## Acceptance evidence

- Invalid custom definitions fail with actionable validation errors.
- Custom packages can be versioned, exported, imported, and compatibility-checked.
- A customization cannot create dangling graph edges or bypass authorization.
- Upgrade tests show how incompatible configurations are handled.

## Decision gate

Define actual organization use cases and ownership before designing a generic customization framework. Do not build an extension marketplace or workflow engine without validated demand.

See [decision register D-021](../DECISION_REGISTER.md), [canonical graph](../CANONICAL_GRAPH.md), and [security and privacy](../SECURITY_PRIVACY.md).
