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
5. If analysis is partial, the client retains valid results and clearly identifies gaps. This flow works offline.

**Failure behavior:** invalid or inaccessible roots, cancellation, and analyzer failures produce actionable messages; they must not appear as successful empty maps.

### Explore a component or symbol

1. The developer searches by name and switches between the structured Browse list and a React Flow relationship map.
2. The map centers on the selected file or symbol and shows its direct relationships, with a bounded number of neighboring items so large repositories remain navigable.
3. Selecting an item in either view shows its kind, parent/containing component when known, source files/ranges, relationships, evidence, and freshness.
4. The developer chooses a source location.
5. The editor opens the corresponding file and selects the recorded range.
6. If the location is stale or unresolved, Codifier explains that state and offers re-analysis rather than navigating to a misleading location.

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

## Later: author or import intended architecture

1. The developer creates a design item or imports a supported notation.
2. Codifier records the author/source and import revision.
3. Imported or AI-suggested items remain unreviewed until a developer confirms them.
4. The developer maps intended elements to actual code and reviews evidence-backed gaps.
5. An intentional deviation can be documented without rewriting actual observations.

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
