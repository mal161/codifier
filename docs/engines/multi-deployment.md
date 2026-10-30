# Multi-Deployment Architecture

## Status

**Approved deployment direction; MVP architecture is local-first.** Preserve a future path to cloud-hosted SaaS, self-hosted, private-cloud, on-premises, and eventually air-gapped operation. The MVP uses an independently distributed local agent with optional authenticated graph synchronization; broad deployment modes are not MVP requirements.

## Purpose

Keep the product's core graph and analysis contracts portable enough to support different hosting modes without maintaining separate product codebases.

## Deployment concepts

- **MVP:** local companion agent and clients, with offline analysis and optional cloud graph synchronization.
- **Later direction:** provider-managed hosted service with local analysis capabilities.
- **Future options:** self-hosted, private cloud, on-premises, hybrid local-agent/control-plane, and possibly air-gapped.
- **Local agent:** independently distributed component, required by the user-directed MVP architecture.

## Portability constraints

- Keep core domain interfaces independent of one cloud vendor.
- Isolate deployment-specific identity, storage, networking, AI provider, and retention configuration.
- Avoid premature abstraction for deployment modes not validated by users.
- Document which data remains local and which crosses to a hosted control plane.
- Define upgrade, schema migration, compatibility, and rollback procedures before supporting managed installations.

## Security and operations

Each deployment mode changes the trust boundary. Authentication, authorization, tenant isolation, secrets, backups, observability, and data residency must be specified per supported mode. Air-gapped capability requires a separate dependency/update strategy and is explicitly later scope.

## Acceptance evidence

- The initial deployment can run with a documented, minimal topology.
- Domain and graph contracts do not embed provider-specific identifiers.
- Deployment configuration is validated and errors are actionable.
- Future deployment modes are not claimed supported until install, upgrade, backup, and recovery are tested.

See [architecture overview](../ARCHITECTURE.md), [development setup](../DEVELOPMENT_SETUP.md), and [decision register D-019](../DECISION_REGISTER.md).
