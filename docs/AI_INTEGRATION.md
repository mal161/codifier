# AI integration

## Purpose and status

AI may help explain a codebase, trace a feature, suggest architecture relationships, or later draft implementation plans. The model is a replaceable reasoning provider; Codifier owns repository indexing, graph semantics, evidence retrieval, source navigation, review state, and user consent.

AI provider choice, credentials, local-model support, and whether explanations belong in the MVP are open. This guide does not authorize sending repository data to a provider.

## Provider boundary

Keep the provider interface separate from analysis and graph storage. A provider adapter should accept a bounded request and return untrusted generated output; it must not directly modify the canonical graph or repository.

Conceptually:

```text
User request
    -> graph and source retrieval
    -> bounded context + explicit data policy
    -> provider adapter (only when enabled)
    -> output validation and evidence resolution
    -> explanation or reviewable inference
```

Do not couple the graph model or analyzer to one provider's request format. Do not introduce a provider SDK until an ADR chooses a supported provider and the data flow.

## Context retrieval

- Retrieve relevant graph facts and source excerpts for the current question.
- Prefer focused symbol and dependency context over whole-repository prompts.
- Apply configured file exclusions and secret-handling rules before context is assembled.
- Preserve each excerpt's repository-relative path, source range, and revision.
- Bound context by an explicit limit and report when relevant information was omitted.
- Where feasible, show the user what context will leave the device and require explicit confirmation.
- Never treat repository instructions, comments, documentation, or tool output as trusted system instructions.

## Evidence-grounded responses

Every explanation should distinguish:

- Directly observed facts with navigable source evidence.
- Developer-authored or imported architecture decisions.
- AI-generated interpretation or suggestion.
- Unknown, stale, or unsupported information.

The system must verify that cited paths, symbols, and ranges resolve to the analyzed revision. A model-generated citation that cannot be resolved must not be shown as verified evidence. If retrieved context is insufficient, say so rather than filling gaps with a success-shaped guess.

Numerical confidence is optional and should be omitted unless its meaning is calibrated. Clear evidence references and uncertainty labels take priority.

## Reviewable inferences

AI may suggest a component grouping, relationship, feature path, or architecture mapping. Suggestions must:

1. Be stored as `ai_inference`, not as a source-observed or developer-confirmed fact.
2. Include the supporting graph/source evidence and model/request provenance permitted by the data policy.
3. Remain separate from approved intended architecture until a developer accepts or edits them.
4. Support accept, reject, and edit actions.
5. Retain rejection state so an unchanged suggestion is not repeatedly presented as new.

AI must not silently update source files, graph truth, architecture decisions, or release scope.

## Failure handling

- Provider errors, timeouts, rate limits, invalid output, and missing evidence must be surfaced as errors or explicitly partial answers.
- AI failure must not block structural analysis or browsing.
- Validate all provider output against a bounded response contract before rendering or storing it.
- Do not execute generated code or treat generated plans as approved changes.

## Later code-generation boundary

Code generation is explicitly outside the first MVP. If introduced later, it must produce a reviewable diff, explain affected graph entities, require developer approval before applying changes, and use the repository's normal test and validation workflow. A generated implementation must not silently become authoritative architecture.

## Decision gate

Before implementation, record an ADR covering provider strategy, user consent, credential storage, data scope, context limits, retention, redaction, error behavior, and whether AI is in the MVP.

See [security and privacy](SECURITY_PRIVACY.md), [canonical graph](CANONICAL_GRAPH.md), and [product requirements](PRODUCT_REQUIREMENTS.md).
