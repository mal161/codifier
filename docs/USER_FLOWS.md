# User flows

## Purpose and status

These flows translate the product vision into user-visible behavior. The MVP clients (CLI, VS Code, and local web app) share the standalone local agent; other flows describe later capabilities and are not release commitments.

## Local web visual direction

Use the [Wispr Flow website](https://wisprflow.ai) as a visual reference for the future local web client, not as a template to reproduce. The user wants a similar clean, contemporary typographic feel, including a comparable font style. Select the actual typeface during UI implementation after checking availability and licensing; do not copy Wispr Flow branding, assets, or marketing copy.

Research and write Codifier's own interface content around its developer workflow: repository selection and analysis status, coverage and diagnostics, searchable architecture structure, evidence/provenance, relationships, and exact source navigation. The web experience must remain a functional codebase tool rather than a transcription of the reference site's marketing layout. Preserve responsive behavior, keyboard access, and the accessibility requirements below.

## MVP: map and navigate a local repository

### Start analysis

1. The developer starts or connects to the local agent from the CLI, VS Code, or local web client.
2. The developer selects a repository; the agent confirms the authorized root and applies the documented file policy.
3. The client requests analysis from the agent and shows progress/cancellation from authenticated local API events.
4. The agent stores results locally and returns a map with coverage, supported languages, skipped files, and errors.
5. The client shows the Git commit, branch when available, and whether the working tree is clean or has uncommitted changes. A non-Git folder remains analyzable and is identified as such.
6. If analysis is partial, the client retains valid results and clearly identifies gaps. This flow works offline.

**Failure behavior:** invalid or inaccessible roots, cancellation, and analyzer failures produce actionable messages; they must not appear as successful empty maps.

### Explore a component or symbol

1. The developer searches by name and switches between the structured Browse list and a React Flow relationship map.
2. The map centers on the selected file or symbol and shows its direct relationships, with a bounded number of neighboring items so large repositories remain navigable.
3. The developer can enter a repository-relative `path:line[:column]` to find graph items whose recorded source ranges cover that position; matches are ordered from the narrowest range to the widest.
4. Selecting an item in either view or a source-location match shows its kind, parent/containing component when known, source files/ranges, relationships, evidence, and freshness.
5. The developer chooses a source location.
6. The editor opens the corresponding file and selects the recorded range.
7. If the location is stale or unresolved, Codifier explains that state and offers re-analysis rather than navigating to a misleading location.

### Inspect dependencies

1. The developer selects a component, file, or symbol.
2. Codifier shows supported dependencies and dependents with relationship type and evidence.
3. Unresolved or inferred relationships are visually distinct from directly resolved relationships.
4. Selecting a relationship reveals why it exists and the relevant source evidence.

### Refresh after edits

1. Codifier detects or is asked to analyze repository changes.
2. It shows progress and permits cancellation.
3. It updates affected graph entities and relationships while retaining supported identities for unchanged items.
4. It reports added, changed, removed, stale, unresolved, and failed items.
5. If incremental state is inconsistent, it reports the issue and offers a full re-analysis.

Git context is read-only metadata captured with the analyzed snapshot. A dirty working tree is allowed; source ranges describe the analyzed working tree and the recorded commit is its HEAD baseline.

## Later: ask an evidence-grounded question

1. The user explicitly enables an AI provider and reviews the data boundary.
2. The user asks about a selected component or feature.
3. Codifier retrieves bounded graph and source context, indicating what is sent when applicable.
4. The response distinguishes observed evidence from AI interpretation and links to source ranges.
5. The user can inspect, correct, accept, or reject suggested relationships.

This flow is blocked until provider, opt-in, credential, context, and retention decisions are recorded.

## MVP: synchronize graph metadata

1. The user explicitly configures and authorizes cloud synchronization; it is not inferred from local analysis.
2. The agent queues approved graph metadata/events in a durable local outbox.
3. The agent authenticates to the cloud API and submits versioned, idempotent events for the authorized workspace.
4. The client shows pending, completed, and failed states; network errors preserve local results and retryable changes.
5. Conflicts or rejected events are surfaced for resolution rather than silently overwritten.

Complete source files are not uploaded by default. See [the local agent guide](engines/local-companion-agent.md) and [security and privacy](SECURITY_PRIVACY.md) for boundaries and safeguards.

## MVP: author and compare intended architecture

1. The developer creates an intended component in the local web explorer.
2. Codifier records the component and each mapping as developer-authored evidence, separate from source-analysis facts.
3. The developer selects an observed file or symbol and maps it to the selected intended component.
4. An unmapped intended component remains visible as a design gap; mapped components show their linked code and provenance.
5. Re-analysis retains authored components and valid mappings. A mapping is removed if its observed code entity no longer exists.
6. Importing architecture notation, documenting deviations, and reviewing AI-suggested intent remain future capabilities.

## Local marketplace: browse and install architecture templates

1. The developer opens the Marketplace from the local web explorer; the authenticated local agent serves its bundled catalog.
2. The developer filters templates by category or searches names, tags, and component descriptions.
3. Before installing, the developer analyzes or loads a saved repository graph.
4. Installing a template adds its components as intended graph entities with imported provenance. It does not create mappings or edit source files.
5. Repeating an install is idempotent, and existing observed graph facts and Git context are preserved.
6. This first slice has no remote service, accounts, payments, executable plugins, or install scripts. User-authored rule packs wait until a declarative format is supported.

## MVP: review architecture-rule findings

1. The developer loads or analyzes a repository and opens Rules in the local web explorer.
2. The authenticated local agent evaluates a versioned set of explicit checks over the saved graph; repository source is not executed.
3. Findings identify dependency cycles, code mapped to multiple intended components, and intended components without mapped code.
4. Each finding cites the graph entities, relationships, and evidence used to produce it. The developer can navigate to a related graph item and inspect its source evidence.
5. Findings are informational review prompts, not automatic design decisions, defects, or compliance claims. User-authored rule packs await a separate declarative format and review.

## Later: architecture-aware implementation planning

1. The developer describes a requested change.
2. Codifier retrieves affected components, constraints, dependencies, source evidence, and relevant decisions.
3. Codifier produces a reviewable plan with unknowns called out.
4. Any proposed code change appears as a diff and is not applied without explicit developer approval.
5. Tests and architecture checks run through a separately approved workflow; outcomes are recorded as evidence, not as guarantees.

## Accessibility and interaction requirements

- Every graph interaction must have a keyboard-operable structured alternative; the Browse list remains available alongside the relationship map.
- Source links must have meaningful accessible names and identify the target file/range.
- Use text labels and non-color indicators for provenance, uncertainty, stale state, and errors.
- Do not make hover or drag the only way to discover a relationship or action.
- Preserve accessible focus when analysis refreshes or graph results change.

The approved product direction targets WCAG 2.2 AA and English-first launch with localization readiness; validation scope and timing must be planned.
