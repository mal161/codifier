# AI Provider Orchestration

## Status

**Provider strategy and product boundary are open.** The product discussion recommends an AI orchestrator/provider abstraction and names hosted and local providers as candidates. It does not finalize providers, key ownership, proxy topology, or MVP inclusion.

## Purpose

Provide a replaceable boundary between Codifier's evidence/context services and one or more external or local language models.

## Responsibilities

- Accept a bounded, policy-checked request from the AI context pipeline.
- Select a configured provider/model for an explicitly enabled task.
- Manage provider-specific request/response adaptation.
- Enforce timeouts, limits, cancellation, and consistent error reporting.
- Validate provider output before passing it to explanation, planning, or review workflows.
- Keep provider credentials out of source, workspace files, logs, and diagnostics.

## Candidate provider modes

- User-managed API credentials for a hosted provider.
- A platform-managed gateway, if a later service/data policy supports it.
- Local model endpoint(s).

Provider examples in the discussion are options for evaluation, not commitments.

## Security and privacy requirements

- Do not contact a model until the user has enabled the feature and the applicable consent flow succeeds.
- Forward only context approved by the [AI context pipeline](../pipelines/ai-context-retrieval.md).
- Store credentials in a platform-approved secure secret store.
- Never log keys, full source prompts, or unredacted model payloads.
- Treat provider responses as untrusted input and validate before display or persistence.
- State clearly whether a request leaves the device and which provider receives it.

## Acceptance evidence

- Provider adapters conform to a versioned internal request/response contract.
- Adapter failures are explicit and cannot corrupt graph state.
- Tests prove no request occurs when AI is disabled or consent is absent.
- Credentials and source excerpts are absent from ordinary logs and diagnostics.

See [AI integration](../AI_INTEGRATION.md), [AI context engine](ai-context.md), and [security and privacy](../SECURITY_PRIVACY.md).
