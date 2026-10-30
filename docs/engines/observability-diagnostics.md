# Observability and Diagnostics

## Status

**Approved direction.** The discussion approves OpenTelemetry-compatible observability across local and cloud components. This does not select a vendor or authorize collecting source code.

## Purpose

Make failures, latency, resource use, and cross-component operations diagnosable while preventing sensitive repository content from leaking into telemetry.

## Signals

- **Logs:** structured events, timestamps, severity, correlation/trace identifiers, and actionable error context.
- **Metrics:** indexing duration, files/symbols analyzed, graph update latency, queue depth where applicable, provider latency/usage if AI is enabled, error rates, and resource utilization.
- **Traces:** follow an operation across IDE, local agent, API, worker, storage, and provider boundaries when those components exist.
- **Health/diagnostics:** local and hosted service status, downloadable diagnostic reports, and user-accessible failure details.

## Requirements

- Use OpenTelemetry-compatible instrumentation and keep backend choice replaceable.
- Redact source, secrets, credentials, personal data, and derived sensitive metadata by default.
- Do not log full prompts, source excerpts, or arbitrary repository content.
- Give each analysis/synchronization operation correlation identifiers.
- Make local diagnostic logs inspectable and retention configurable.
- Surface errors explicitly; telemetry must not be a substitute for user-facing error handling.

## Acceptance evidence

- A failed analysis can be traced to its stage and correlation ID.
- A diagnostic report contains enough context to troubleshoot without exposing source.
- Redaction tests cover secret-like values and source content.
- Metrics distinguish partial, failed, canceled, and successful work.

See [security and privacy](../SECURITY_PRIVACY.md), [analysis pipeline](../ANALYSIS_PIPELINE.md), and [decision register D-011](../DECISION_REGISTER.md).
