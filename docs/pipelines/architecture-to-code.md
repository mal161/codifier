# Architecture-to-Code Pipeline

## Status

**Future capability.** The product discussion describes generation from requirements and approved architecture, but excludes full code generation from the first MVP.

## Flow

```text
System requirements
    -> intended architecture
    -> architecture validation
    -> evidence-linked implementation plan
    -> developer review and approval
    -> proposed code diff
    -> tests and validation
    -> repository analysis
    -> actual-architecture mapping
    -> reviewed intended/actual comparison
```

## Stage contracts

1. **Requirements:** capture user-provided goals and constraints with provenance.
2. **Architecture:** use reviewed intended graph state; report missing decisions and conflicts.
3. **Validation:** check graph integrity and explicit rules; do not imply completeness.
4. **Planning:** propose modules, files, responsibilities, interfaces, endpoints, data, dependencies, and tests with evidence references.
5. **Approval:** require an explicit developer decision before any repository modification.
6. **Generation:** present a bounded diff; never run generated code automatically.
7. **Verification:** use an explicitly approved test/validation workflow and report actual outcomes.
8. **Re-analysis:** update the actual graph only from repository evidence and preserve the generated-change provenance.

## Guardrails

- A plan is not permission to change files.
- Generated code and AI suggestions are not authoritative architecture.
- Tests provide evidence only for exercised behavior.
- Do not claim that a generated system conforms to architecture until measured checks have run.
- Preserve rollback/review ability through source-control diffs.

## Acceptance evidence

- No file changes occur before explicit approval.
- The plan and diff identify affected graph elements and constraints.
- Test failures and unresolved mappings are surfaced.
- Re-analysis distinguishes actual code from intended design and AI output.

See [architecture intelligence](../engines/architecture-intelligence.md), [AI integration](../AI_INTEGRATION.md), and [implementation plan](../IMPLEMENTATION_PLAN.md).
