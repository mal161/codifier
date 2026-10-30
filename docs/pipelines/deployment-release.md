# Deployment and Release Pipeline

## Status

**Operational direction; stack and hosting are open.** The discussion mentions containerized deployment and CI/CD, while recommending deferring Kubernetes until justified by scale.

## Flow

```text
Change proposal
    -> automated checks and tests
    -> build signed/versioned artifacts
    -> deploy to a controlled environment
    -> health and telemetry checks
    -> staged rollout
    -> verify or rollback
```

## Requirements when a hosted platform is selected

- Build artifacts reproducibly and keep credentials out of repository and logs.
- Run the agreed test and security checks before deployment.
- Use database/schema migration gates with backup and rollback planning.
- Verify health and key user workflows after rollout.
- Define release approval and incident ownership.
- Keep future hosted-service deployment portable only to the degree justified by validated product needs; the MVP is local-first.
- Do not introduce CI/CD services, container orchestration, or infrastructure before the deployment decision.

## Acceptance evidence

- A release can be traced to source revision, build, tests, and deployment.
- Failed health checks stop rollout or trigger a documented rollback.
- A restore/migration rehearsal exists before handling durable user graph data.

See [multi-deployment](../engines/multi-deployment.md), [observability and diagnostics](../engines/observability-diagnostics.md), and [development setup](../DEVELOPMENT_SETUP.md).
