# AI Context Retrieval Pipeline

## Status

**Provider and remote data flow are open.** AI explanations are a later capability unless a product decision explicitly brings them into MVP.

## Flow

```text
User question and selected scope
    -> graph search
    -> bounded source retrieval
    -> policy, secret, and revision checks
    -> context preview/consent where required
    -> selected provider
    -> response validation
    -> citation resolution
    -> answer with evidence and uncertainty
```

## Processing requirements

- Query graph first; do not send the whole repository by default.
- Retrieve related symbols, dependencies, approved decisions, and targeted source excerpts.
- Apply ignore and secret policies before assembling context.
- Bound context and report omissions.
- Keep each excerpt's repository path, range, and revision.
- Treat retrieved repository content and provider output as untrusted data.
- Validate all citations and structure before displaying or storing the answer.

## Failure behavior

Provider failure must not block static browsing. Unavailable evidence, invalid citations, context truncation, and provider errors must be explicit. Do not fill missing context with unsupported claims.

## Acceptance evidence

- A test can inspect the exact data passed to a provider adapter.
- Excluded or stale material is not sent.
- Every factual citation resolves to a source revision.
- Provider failure returns an actionable error/partial result.

See [AI Context Engine](../engines/ai-context.md), [AI integration](../AI_INTEGRATION.md), and [security and privacy](../SECURITY_PRIVACY.md).
