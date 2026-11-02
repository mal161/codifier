# WCAG 2.2 AA review — local web explorer

- Date: 2026-11-02
- Scope: `apps/local-web` critical paths — workspace and analysis forms, repository map (Browse list and Relationship map), entity details, revision history, Rules page with exception form, Marketplace, status messages.
- Out of scope: the VS Code extension (its UI is VS Code's own), the local agent CLI.
- Reviewer: AI-assisted engineering review in this repository. This is not a third-party conformance audit and does not claim conformance for the product.

## Method

1. **Automated rules.** axe-core 4.10.2 with tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`, plus the experimental `label-content-name-mismatch` rule for 2.5.3, in six UI states.
2. **Scripted checks** for criteria axe cannot fully decide: Tab order from the top of the document with a focus-indicator check at every stop (2.1.1, 2.1.2, 2.4.3, 2.4.7); whether author content covers the focused element (2.4.11) at 1440 px and at 320 px; pointer targets under 24×24 CSS px (2.5.8); horizontal overflow at 320 px (1.4.10).
3. **Manual inspection** of source and screenshots for the remaining criteria, with contrast ratios computed from the design tokens.

Environment: Windows 11, Microsoft Edge (Chromium) headless via playwright-core 1.49.1, viewports 1440×1000 and 320×800, `prefers-reduced-motion: reduce` emulated so scroll positions are measured after scrolling completes. Reproduce with the `run-codifier` skill: `node .claude/skills/run-codifier/driver.mjs --flow a11y`, which writes `a11y-report.json` and screenshots.

Screen-reader testing (added 2026-11-02): NVDA 2026.2 with Microsoft Edge 156 on Windows 11 — see [Screen-reader testing](#screen-reader-testing) below.

Not performed: JAWS, VoiceOver, TalkBack, speech-input testing, Windows high-contrast mode, 200% browser zoom on a physical display, and testing with users with disabilities.

## Findings and fixes

| # | Criterion | Finding (before) | Fix | Verified by |
|---|---|---|---|---|
| A1 | 1.4.3 Contrast (Minimum) | Secondary text token `muted` `#78817b` was 3.3–4.0:1 on every light surface; flagged on every page (up to 40 nodes). | Token changed to `#5e6761` (≥ 4.78:1 on white, canvas, mist, and line surfaces). | axe: 0 violations in all states |
| A2 | 1.4.3 | Placeholder text `stone-400` was 2.52:1 (axe does not test placeholders). | `stone-500` (4.79:1). | computed ratio |
| A3 | 1.4.3 | React Flow attribution link `#999` was 2.84:1. | Overridden to `muted`. | axe |
| A4 | 1.4.11 Non-text Contrast | Form-field borders `#e6e9e4` were 1.2:1. | New `field` token `#868f89` for input borders only (3.33:1 on white, 3.07:1 on canvas). | computed ratio, screenshots |
| A5 | 1.4.10 Reflow | Loaded explorer overflowed horizontally by 183 px at 320 px: the single-column grid grew to fit unbreakable hashes and fingerprints. | Column bounded with `minmax(0,1fr)`; only machine tokens (evidence text, revision IDs, map footer) wrap anywhere. A first attempt that wrapped the whole grid split button labels ("Fin/d") and was replaced. | scripted overflow check: 0 px in all states; screenshots |
| A6 | 2.4.11 Focus Not Obscured (Minimum) | At 320 px the fixed status message covered focused controls (7 stops in the loaded explorer). | `scroll-padding-bottom: 8rem` on `html` (technique C43). Removing it reproduces the 7 obscured stops; restoring it gives 0. | scripted check at 320 px and 1440 px |
| A7 | 2.5.8 Target Size (Minimum) | "Dismiss message" control was 48×20 px; attribution link 47×14 px. | Dismiss gets `min-h-6`; attribution link padded to 24 px. | scripted target check |
| A8 | 2.5.3 Label in Name | Header home link name "Codifier codebase map home" did not contain its visible text; "Copy location" and "Open in VS Code" names did not contain theirs as a phrase. | Visible text now starts each accessible name; decorative logo mark hidden from assistive technology. | axe `label-content-name-mismatch`: 0 |
| A9 | 4.1.2 Name, Role, Value | Disabled "Open in VS Code" `<a>` without `href` had no role, so its label was not reliably exposed. | `role="link"` with `aria-disabled` while unavailable. | axe (no longer reported) |
| A12 | 4.1.3 Status Messages | Found by NVDA, missed by inspection: the status message region was `display: none` while empty, so it was not in the accessibility tree and success messages ("Connected to the local agent.", "Saved graph loaded…") were never announced. | Always-present, visually hidden `status` (notices) and `alert` (errors) regions inside the toast. | NVDA announces each message |
| A13 | 2.4.3 Focus Order | Found by NVDA: activating a control that is replaced by other content ("Show revision history", "Restore this revision", "Record exception", removing a dependency) dropped focus to the page ("document … unknown"), losing the user's place. | Focus moves to the revealed content (revision list, Confirm button, first form field, dependency picker) and back to the trigger on Cancel or close. "Restore this revision" became a disclosure button (`aria-expanded`) that stays mounted so focus never falls back to the page. | NVDA announces the expected target; no stray "document" announcements |
| A14 | 2.4.3 Focus Order | Found by NVDA: switching views (Explore, Marketplace, Rules) replaced the main content without telling screen-reader users; focus stayed on the navigation button ("current page"). | Focus moves to the new view's level-1 heading. | NVDA announces "Architecture rules, heading level 1" |
| A11 | 4.1.2 Name, Role, Value | React Flow's controls panel had `aria-label` on a `<div>` without a role (axe "needs review"), and the library offers no role prop. | The panel is given `role="group"` after render. | axe: no longer reported |
| A10 | 2.3.3 (AAA, advisory) | Smooth scrolling and transitions ignored the reduced-motion preference. | `motion-safe:scroll-smooth` and a reduced-motion reset for transitions and animations. | stable repeated audits under reduced motion |

## Criterion results (WCAG 2.2 Level A and AA)

Status values: **Pass** (automated or scripted evidence), **Pass (inspection)** (manual review of source or screenshots), **Fixed** (see table above, then passing), **Exception** (a criterion exception applies, stated), **N/A**, **Needs AT testing** (markup looks correct; not verified with assistive technology).

| Criterion | Status | Notes |
|---|---|---|
| 1.1.1 Non-text Content | Pass (inspection) | Icons accompany text labels; the logo mark is `aria-hidden`; axe image rules pass. |
| 1.2.1–1.2.5 Time-based media | N/A | No audio or video. |
| 1.3.1 Info and Relationships | Pass | Labels associated with fields, headings, lists, landmarks (`header`, `nav`, `main`); axe passes. The Relationship map has an equivalent structured Browse list and relationship cards. |
| 1.3.2 Meaningful Sequence | Pass (inspection) | DOM order matches visual order at both widths. |
| 1.3.3 Sensory Characteristics | Pass (inspection) | Instructions do not rely on shape, color, or position. |
| 1.3.4 Orientation | Pass (inspection) | No orientation lock; layout verified at 320 px portrait. |
| 1.3.5 Identify Input Purpose | Pass (inspection) | The reviewer-name field uses `autocomplete="name"`; other fields do not collect personal data. |
| 1.4.1 Use of Color | Pass (inspection) | Severity, status, and exception state are also stated in text. |
| 1.4.2 Audio Control | N/A | No audio. |
| 1.4.3 Contrast (Minimum) | Fixed | A1–A3. Remaining axe "incomplete" items are text over a textarea resize handle and graph labels over SVG; their colors (`ink` on white, about 15:1; `muted` on white, 5.85:1; badge `forest` on `mist`, 7.62:1) pass when computed. |
| 1.4.4 Resize Text | Pass (inferred) | Content reflows at 320 px (equivalent to 400% zoom of 1280 px) without loss; not separately tested at 200% zoom. |
| 1.4.5 Images of Text | N/A | None. |
| 1.4.10 Reflow | Fixed | A5. Rules and Marketplace already passed. |
| 1.4.11 Non-text Contrast | Fixed | A4. Focus rings use `forest` (≥ 7:1). Card and divider borders are decorative and keep the lighter `line` color. |
| 1.4.12 Text Spacing | Pass | With the WCAG overrides applied (line height 1.5, paragraph spacing 2em, letter spacing 0.12em, word spacing 0.16em), no text is newly clipped in any audited state. The 1–4 single-line names per state truncated with an ellipsis are truncated before the override; their full text is available in the entity details panel. |
| 1.4.13 Content on Hover or Focus | Pass (inspection) | Only native `title` tooltips; no author hover popups. |
| 2.1.1 Keyboard | Pass | Every control on the audited paths is reachable by Tab (11–35 stops per state) including Save/Cancel in the exception form. Graph nodes are focusable; selecting them by keyboard is provided by the equivalent Browse list. |
| 2.1.2 No Keyboard Trap | Pass | Each Tab walk completed without a trap. |
| 2.1.4 Character Key Shortcuts | Pass (inspection) | No single-character shortcuts defined by the app. |
| 2.2.1 Timing Adjustable | Pass (inspection) | No time limits; status messages persist until dismissed. |
| 2.2.2 Pause, Stop, Hide | N/A | No moving or auto-updating content beyond user-started progress. |
| 2.3.1 Three Flashes | Pass (inspection) | No flashing content. |
| 2.4.1 Bypass Blocks | Pass | Landmarks present; axe `bypass` passes. |
| 2.4.2 Page Titled | Pass | `Codifier — Codebase map`. |
| 2.4.3 Focus Order | Fixed | A13, A14. Tab order follows visual order in every audited state; focus is now managed when content is replaced or the view changes (verified with NVDA). |
| 2.4.4 Link Purpose (In Context) | Pass | Link names describe their destination. |
| 2.4.5 Multiple Ways | N/A | Single-page tool with persistent primary navigation. |
| 2.4.6 Headings and Labels | Pass (inspection) | Descriptive headings and labels. |
| 2.4.7 Focus Visible | Pass | Every Tab stop showed an outline or ring. |
| 2.4.11 Focus Not Obscured (Minimum) | Fixed | A6. |
| 2.5.1 Pointer Gestures | Pass (inspection) | Graph zoom has single-pointer buttons; no path-based gestures required. |
| 2.5.2 Pointer Cancellation | Pass (inspection) | Native click (up-event) activation. |
| 2.5.3 Label in Name | Fixed | A8. |
| 2.5.4 Motion Actuation | N/A | No motion input. |
| 2.5.7 Dragging Movements | Exception (equivalent) | Graph panning and node dragging are optional; zoom/fit buttons and the Browse list provide the same information without dragging. |
| 2.5.8 Target Size (Minimum) | Fixed / Exception | A7. The native checkbox (13×13 px) is unstyled and sized by the browser (user-agent exception). Graph edge labels (36×11 px) have equivalent full-size relationship buttons in entity details (equivalent exception). |
| 3.1.1 Language of Page | Pass | `lang="en"`. |
| 3.1.2 Language of Parts | N/A | Single language. |
| 3.2.1 On Focus | Pass (inspection) | Focus never changes context. |
| 3.2.2 On Input | Pass (inspection) | Inputs do not submit or navigate on change. |
| 3.2.3 Consistent Navigation | Pass (inspection) | Same header navigation on every view. |
| 3.2.4 Consistent Identification | Pass (inspection) | Repeated controls share names. |
| 3.2.6 Consistent Help | N/A | No help mechanism is offered. |
| 3.3.1 Error Identification | Pass (inspection) | Errors are described in text in an `alert` region. |
| 3.3.2 Labels or Instructions | Pass | axe label rules pass; helper text under fields. |
| 3.3.3 Error Suggestion | Pass (inspection) | Agent errors are mapped to actionable messages (for example "Wait for or cancel the running analysis"). |
| 3.3.4 Error Prevention (Legal, Financial, Data) | Pass (inspection) | Not legal or financial; destructive-looking actions (restore, revoke) use an explicit confirm step and are reversible by design. |
| 3.3.7 Redundant Entry | Pass (inspection) | The reviewer name is remembered across exception forms within the page. |
| 3.3.8 Accessible Authentication (Minimum) | Pass (inspection) | The token field allows paste and password managers; no cognitive test. |
| 4.1.2 Name, Role, Value | Fixed | A9, A11. |
| 4.1.3 Status Messages | Fixed | A12. The earlier "Pass (inspection)" was wrong: the markup looked right but NVDA showed messages were not announced. Now verified with NVDA. |

## Screen-reader testing

Environment: NVDA 2026.2 (installed from NV Access with winget), Microsoft Edge 156.0.4314.58, Windows 11, default NVDA settings except first-run dialogs and say-all-on-page-load disabled. Run with `node .claude/skills/run-codifier/driver.mjs --flow screenreader`, which starts NVDA with speech logging, drives the explorer by keyboard in a visible Edge window, and compares what NVDA spoke during each step with expected phrases (`screenreader-report.json`, `nvda.log`).

Final run: 18/18 steps announced as expected.

| Step | NVDA announced |
|---|---|
| Agent address field | "Agent address, edit" with its value |
| Tab to token field | "Agent token, edit, protected" |
| Tab to connect button | "Connect to agent, button" |
| Connect | "Agent connected", "Connected to the local agent." |
| Load saved | "Saved graph loaded from the local agent." |
| Show revision history | "Revision history region, Show revision history, button" |
| History opens | "Graph revisions, newest first, list with 2 items" |
| Restore button | "Restore this revision, button, collapsed" |
| Activate restore | "Confirm restore of revision 1, button" |
| Tab | "Cancel, button" |
| Cancel | "Restore this revision, button, collapsed" |
| Rules navigation | "banner landmark, Primary navigation landmark, Rules, button" |
| Open Rules | "main landmark, Architecture rules region, Architecture rules, heading level 1" |
| Record exception | "list with 1 item, Record exception, button" |
| Open the form | "Record exception form landmark", "Your name, edit, required, blank" |
| Rationale field | "Why is this finding acceptable?, edit, required, multi line, blank" |
| Save | "Exception recorded. The finding stays listed with your rationale; the graph was not changed.", then "Revoke exception, button" |

The first NVDA run found A12–A14; all three were fixed and re-verified. Limits of this testing: key presses come from Playwright and reach the browser without passing through NVDA, so it verifies focus-mode announcements (focus changes, activation, live regions) but not NVDA browse-mode commands (headings with H, arrow-key reading, elements list). One stray "document … unknown" announcement observed during development came from the test calling `focus()` programmatically, not from the app; the final run drives Cancel by keyboard and has none.

## Open items

1. Browse-mode reading with NVDA (headings, landmarks, arrow keys) by a person, and VoiceOver + Safari and JAWS passes.
2. Keep the audit current: re-run `--flow a11y` for UI changes and record new results here.

Updated 2026-11-02 (Phase 8): 1.4.12 tested and passing; React Flow controls naming fixed.
