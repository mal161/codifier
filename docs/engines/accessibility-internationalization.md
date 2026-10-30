# Accessibility and Internationalization

## Status

**Approved direction.** The discussion approves WCAG 2.2 AA as the target, an English-first launch, and future localization readiness. Build accessibility into interactions and data presentation.

## Accessibility requirements

- Keyboard-operable browsing, menus, dialogs, graph navigation, and workflows.
- Screen-reader names and semantic descriptions for graph nodes and relationships.
- Structured tree/list/table alternatives to complex diagrams.
- Adequate contrast, scalable text, reduced motion, and status indicators that do not rely on color alone.
- Visible focus and predictable focus restoration after graph refreshes.
- Accessible errors, progress, and cancellation states.
- Automated and manual accessibility checks in the delivery process.

## Internationalization requirements

- Keep user-facing text separate from code identifiers and canonical graph values.
- Design for translated interface text and notifications.
- Use locale-aware dates, times, numbers, and currencies where those concepts appear.
- Respect user time-zone preferences for activity and history.
- Keep right-to-left layouts possible; do not infer language from technical identifiers.
- Launch language remains English unless a later decision changes scope.

## Acceptance evidence

- Every primary workflow is usable without a mouse.
- Diagram information is available in an equivalent structured representation.
- Automated checks are supplemented by keyboard and screen-reader testing.
- Locale-sensitive values render using the selected locale without changing stored canonical values.

See [user flows](../USER_FLOWS.md), [product requirements](../PRODUCT_REQUIREMENTS.md), and [decision register D-022](../DECISION_REGISTER.md).
