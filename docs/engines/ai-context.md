# AI Context Engine

## Status

**Proposed capability; provider, data flow, and MVP inclusion are open.** This page complements, and does not replace, the [AI integration guide](../AI_INTEGRATION.md).

## Purpose

Assemble a small, relevant, evidence-linked context package for an optional model request instead of sending an entire repository.

## Responsibilities

1. Accept a user question and selected graph scope.
2. Retrieve relevant graph entities, relationships, approved decisions, and source excerpts.
3. Apply repository exclusions, secret handling, context limits, and current revision checks.
4. Preserve source paths, ranges, and evidence references for every excerpt.
5. Present the outgoing data boundary and obtain required user consent.
6. Return context to a provider adapter and validate response references against retrieved evidence.

## Data flow

```text
Question and selection
    -> graph query
    -> bounded source retrieval
    -> policy and freshness checks
    -> user-visible consent boundary
    -> provider adapter
    -> evidence/reference validation
    -> answer with uncertainty
```

## Required behavior

- Never include the whole repository by default.
- Do not silently include secrets, excluded files, or stale source.
- Report context truncation or missing evidence.
- Treat repository content and provider output as untrusted data.
- Fail explicitly on provider errors or unresolvable citations.
- Keep provider credentials outside workspace files and logs.

## Open decisions

Provider(s), local-model support, credential flow, context preview UX, request retention, redaction, and whether explanations ship in MVP all require an ADR before implementation.

## Acceptance evidence

- Requests contain only policy-approved retrieved context.
- Every displayed citation resolves to the relevant repository revision.
- Insufficient context yields a limitation or error rather than fabricated detail.
- AI disabled/network unavailable leaves static navigation fully usable.

See [AI integration](../AI_INTEGRATION.md) and [security and privacy](../SECURITY_PRIVACY.md).
