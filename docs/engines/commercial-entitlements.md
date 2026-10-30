# Platform Commercial Intelligence and Entitlements

## Status

**Approved as a product direction; explicitly not MVP scope.** The discussion approves provider-independent entitlement and metering concepts with replaceable billing adapters.

## Purpose

Manage capability access and usage if/when a commercial hosted platform is validated. Preserve useful local-first behavior within applicable license terms.

## Candidate capabilities

- Subscription and license records, trials, and enterprise agreements.
- Feature entitlements and server-side authorization of paid capabilities.
- Usage measurement for selected products/operations.
- Quotas, notices, and customer-visible usage reports.
- Replaceable payment and billing adapters.
- Upgrades that preserve graph history and configuration.

## Architecture constraints

- Enforce entitlements on trusted backend boundaries, never only by hiding UI.
- Keep commercial state separate from canonical architecture facts.
- Define offline/local behavior explicitly; do not assume cloud connectivity for local analysis.
- Minimize collection and retention of usage data.
- Avoid complex usage-based pricing until real usage is understood.
- Never introduce billing dependencies or payment flows before a validated commercial requirement.

## Acceptance evidence when prioritized

- Unauthorized feature/API requests are denied server-side.
- Entitlement changes are auditable and do not delete graph data.
- Usage is explainable to customers and bounded by a documented data policy.
- Billing-provider failures cannot corrupt architecture history or grant false entitlements.

See [decision register D-020](../DECISION_REGISTER.md), [security and privacy](../SECURITY_PRIVACY.md), and [roadmap](../ROADMAP.md).
