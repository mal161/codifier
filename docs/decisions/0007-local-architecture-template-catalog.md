# 0007: Local architecture-template catalog

- Status: accepted
- Date: Not stated; recorded from the user's explicit direction

## Context

Codifier needs a narrow way to reuse architecture structures without adding a hosted marketplace or executable extension system. A bounded set of built-in architecture checks exists, but there is not yet a reviewed declarative format for user-authored rule packs.

## Decision

- Provide a curated catalog of bundled, data-only architecture templates through the authenticated local agent.
- Install templates into a selected saved graph as intended components with imported evidence. Do not create mappings, alter observed entities, or write source files.
- Make installation idempotent and preserve unrelated graph data and Git context.
- Do not add a remote catalog, accounts, payments, install scripts, or executable plugins.
- Defer rule-pack listings and installation until a declarative rule-pack format has its own design and validation.

## Alternatives considered

- Host a remote marketplace with accounts and payments: rejected for the first slice because it adds services and user-data flows before a validated need.
- Allow marketplace packages to execute install code: rejected because templates need only declarative graph data.
- Offer user-authored rule packs before a supported declarative format exists: rejected because their semantics, versioning, and evidence behavior are not defined.

## Consequences

- Catalog changes ship with Codifier releases and do not require a separate service.
- The local agent remains the only owner of graph mutation; clients do not write templates directly to storage.
- Imported evidence must remain distinguishable from developer-authored intent and observed source facts.
- Adding remote submissions, executable extensions, or installable rules requires separate design and security decisions.
