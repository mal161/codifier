# Developer Knowledge Intelligence

## Status

**Product concept; scope overlaps with codebase intelligence and AI context.** The discussion refers to a Developer Knowledge Intelligence Engine when describing codebase explanations, but does not establish a separate implementation boundary. Avoid implementing duplicate analysis or retrieval systems.

## Purpose

Help a developer understand a selected component, symbol, feature, or dependency path using verified repository facts and clearly labeled interpretation.

## Candidate capabilities

- Explain a selected symbol or component and its role in the wider system.
- Trace a behavior across routes, UI, services, repositories, APIs, and data stores where evidence supports the path.
- Explain dependency and impact results.
- Link every factual claim to source ranges, graph facts, or reviewed architecture decisions.
- Distinguish observed facts, developer intent, imported material, AI interpretation, and unknowns.
- Surface relevant approved documentation and ADRs.

## Boundary

The analyzer establishes structural facts; the graph stores evidence; the retrieval pipeline selects relevant context; an optional model may help explain it. This capability must not own a parallel graph, duplicate source index, or silently promote an explanation into architecture truth.

## Constraints

- Useful navigation must work without AI.
- No remote model request without explicit, informed user control and an accepted data policy.
- Incomplete evidence must produce an explicit limitation, not a confident narrative.
- Generated explanations are not verified engineering knowledge until reviewed.

## MVP guidance

Prioritize code browsing, symbol search, relationship inspection, and exact source navigation. Evidence-grounded natural-language explanations are a later, separately gated capability.

## Acceptance evidence

- A feature explanation can be traversed to the evidence behind each claimed step.
- Unknown dynamic behavior is described as unknown or inferred.
- AI/provider failure does not block repository navigation.

See [AI integration](../AI_INTEGRATION.md), [AI context engine](ai-context.md), and [user flows](../USER_FLOWS.md).
