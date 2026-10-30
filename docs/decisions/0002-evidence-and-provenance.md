# 0002: Preserve evidence and provenance for graph claims

- Status: accepted
- Decision date: Not stated in the source discussion

## Context

The graph combines source analysis, developer-authored intent, imported architecture, tests or runtime evidence, and possible AI suggestions. Without provenance, users cannot tell what was observed, assumed, or reviewed.

## Decision

Attach provenance and supporting evidence to graph entities and relationships. Distinguish source-observed facts, developer-confirmed intent, imported information, test/runtime evidence, and AI inference. Keep AI-inferred claims labeled as inferences until a developer reviews them, and retain review outcomes, including rejected suggestions.

Claims must not be stronger than their evidence. A test supports only the behavior it exercises. Numerical confidence is not required unless its meaning is defined and calibrated.

## Alternatives considered

- Store generated explanations without claim-level evidence.
- Treat all imported or AI-generated content as authoritative.
- Use a confidence number as a substitute for inspectable evidence.

The source discussion did not document a full comparison of these alternatives.

## Consequences

- Evidence references and source revision context are core graph data, not optional UI decoration.
- AI output and imported content require visible provenance and review status.
- Explanations must expose uncertainty and unresolved evidence.
- See the [canonical graph specification](../CANONICAL_GRAPH.md), [AI integration guide](../AI_INTEGRATION.md), and [decision register D-005](../DECISION_REGISTER.md).
