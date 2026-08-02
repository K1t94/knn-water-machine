# AGENTS.md

## Purpose

This file defines how Codex should behave in this repository. Keep it concise,
project-specific, and stable.

## Default Behavior

- Be concise by default.
- Start non-trivial work with repo analysis and a short numbered plan.
- Make one logical diff at a time.
- Prefer small, reviewable changes over broad rewrites.
- After each diff, run only the smallest relevant validation commands.
- Explain tradeoffs briefly when they matter.
- If requirements are ambiguous, ask before making architectural assumptions.
- Do not create or switch branches unless the user explicitly requests it.

## Repo Scan Policy

When starting a task, inspect only what is relevant.

Read first when relevant:

- package or build manifest files
- lockfiles when dependency/debug work is needed
- Docker or container files
- TypeScript/build/test config
- source files for the touched area
- tests for the touched area
- migrations or schema files
- README and env templates
- `.codex/docs/context-policy.md`
- `.codex/docs/ai-style-memory.md`
- `.specify/memory/constitution.md`
- current feature files under `specs/`

Ignore by default:

- dependencies
- build output
- coverage output
- VCS internals
- logs
- generated artifacts
- large binaries and media unless directly relevant

Do not dump huge files. Summarize structure first.

## Architecture Rules

- Follow existing project architecture before introducing new patterns.
- Keep controllers/handlers thin where the framework supports that shape.
- Put business logic in services or equivalent domain modules.
- Use explicit request validation at system boundaries.
- Use explicit response shaping for public outputs.
- Never expose secrets, credentials, tokens, internal session data, or private
  fields.
- Do not introduce schema changes without calling them out explicitly.
- Prefer migrations over automatic schema synchronization.
- Avoid broad abstractions until a real repeated pattern exists.

## Validation Rules

Use the smallest command that reduces risk for the current diff.

Examples:

- config/docs only: readback or targeted lint if configured
- TypeScript backend code: build or targeted typecheck
- tests changed: targeted test file first
- schema changed: build plus migration command if environment is available
- frontend changed: targeted build/lint plus visual check if UI behavior changed

If a command is missing, say so instead of inventing it.

## Context And Memory Rules

- Read `.codex/docs/context-policy.md` before large or long-running tasks.
- Read `.codex/docs/ai-style-memory.md` before non-trivial edits.
- Do not update style memory unless the user explicitly says: `promote this to style`.
- Use `.codex/docs/session-handoff.md` before closing a session or switching tasks.
- Keep persistent facts in files, not in chat.

## Change Workflow

1. Analyze relevant context.
2. Present a short numbered plan.
3. Ask approval before broad architecture, dependency, schema, auth, security, or
   destructive changes.
4. Implement one logical diff.
5. Run minimal validation.
6. Summarize changed files, validation, and remaining risk.
7. Recommend the next diff only after finishing the current one.

## Review Guidelines

When reviewing changes, prioritize:

- correctness
- auth and authorization safety
- validation completeness
- response/data exposure
- schema and migration safety
- deterministic data access
- missing tests
- unrelated edits

High severity:

- auth bypass
- secret leak
- broken token/session behavior
- schema-damaging change
- unsafe destructive command

## Requirements Source

- `docs/mvp-requirements.md` is the source of truth for MVP product requirements.
- For each new feature specification, read only the sections relevant to the current feature.
- Do not load the entire requirements document unless cross-feature consistency must be checked.
- Feature-specific decisions in an approved `specs/<feature>/spec.md` may clarify the MVP requirements but must not silently contradict them.
- Any conflict or required scope change must be reported before implementation.

[//]: # '## ERP reference repository'
[//]: #
[//]: # 'The Python ERP repository is available at:'
[//]: #
[//]: # '`../erp-reference`'
[//]: #
[//]: # 'It is a read-only reference implementation.'
[//]: #
[//]: # 'Rules:'
[//]: #
[//]: # '- Never modify, format, rename, delete or create files inside erp-reference.'
[//]: # '- Never run database migrations or production commands from erp-reference.'
[//]: # '- Never copy secrets, API keys, passwords or personal data.'
[//]: # '- Do not port Python code line by line.'
[//]: # '- Extract business behavior, API contracts, MQTT topics, payloads,'
[//]: # '  statuses and error-handling rules.'
[//]: # '- Implement equivalent behavior through NestJS adapters.'
[//]: # '- If the ERP behavior is ambiguous, document the ambiguity instead of guessing.'
[//]: # '- Before implementation, create a compatibility report with exact source'
[//]: # '  file references.'

## UI Development and Mockups

When implementing or modifying the user interface, always use the PNG mockups
located in `docs/design/mockups/` as the primary visual reference.

Before implementing a screen:

1. Find the corresponding mockup in `docs/design/mockups/`.
2. Open and visually inspect the image.
3. Analyze the screen structure, visual hierarchy, spacing, element sizes,
   colors, typography, button states, cards, and navigation.
4. Start implementation only after reviewing the mockup.
5. After implementation, compare the result with the mockup and fix noticeable
   visual differences.

Screen-to-mockup mapping:

- Welcome — `docs/design/mockups/01_welcome_hd.png`
- Home — `docs/design/mockups/02_home_hd.png`
- Machine selection — `docs/design/mockups/03_machine_selection_hd.png`
- Machine details and purchase — `docs/design/mockups/04_machine_purchase_hd.png`
- Balance top-up — `docs/design/mockups/05_balance_top_up_hd.png`
- Referral program — `docs/design/mockups/06_referral_program_hd.png`
- Phone number login — `docs/design/mockups/07_login_hd.png`
- OTP verification — `docs/design/mockups/08_otp_verification_hd.png`
- Legal document acceptance — `docs/design/mockups/09_terms_hd.png`
- QR scanner — `docs/design/mockups/10_qr_scanner_hd.png`
- Payment result — `docs/design/mockups/11_payment_result_hd.png`
- Profile — `docs/design/mockups/12_profile_hd.png`

### Requirement Priority

The mockups define only the visual direction, including layout, styling,
navigation, visual hierarchy, and element placement.

The sources of truth for business logic, copy, supported functionality, and user
flows are, in order of priority:

1. The current feature specification in `specs/`.
2. `docs/mvp-requirements.md`.
3. Other up-to-date project documentation.
4. The mockups, only after the requirements above.

If a mockup conflicts with the current requirements, implement the requirements
while preserving the visual style and layout principles of the mockup.

Do not copy outdated or illustrative data from the mockups without validating it:

- MTN Mobile Money.
- Phone numbers with the `+233` country code.
- Addresses in Ghana.
- Illustrative prices or currencies.
- The fixed `128 L` balance.
- User names and other sample values.

Use real data received from the API or neutral placeholders.

### Frontend State Architecture

- Use MobX for React Native application state, screen state, computed state,
  and state transitions.
- Use RxJS for asynchronous workflows that require cancellation, concurrency
  control, timers, retry policies, or event composition.
- Keep React Native components presentation-oriented and wrap components that
  read observable state with `observer`.
- Do not put long-lived RxJS subscriptions or public RxJS subjects in screen
  components.
- Stores and reactive application services that subscribe to streams must expose
  an explicit `dispose()` lifecycle.
- Do not represent the same state independently in React state, MobX, and RxJS.
- Keep API and SecureStore access behind typed adapters.
- Treat server-provided authentication, OTP, session, and legal state as
  authoritative.

### General UI Rules

- Do not embed an entire mockup in the application as an image.
- Implement the UI using native React Native components.
- Extract repeated interface elements into reusable components.
- Use shared design tokens for colors, spacing, border radii, typography,
  shadows, and other common visual properties.
- Support Safe Area, different iOS and Android screen sizes, and the system
  keyboard.
- Interactive elements must support the appropriate states:
  `default`, `pressed`, `disabled`, `loading`, `success`, and `error`.
- Do not copy pixel dimensions directly without checking responsive behavior.
- Preserve the visual hierarchy and relative proportions shown in the mockups.
- If a required state or screen is missing from the mockups, consult the
  requirements instead of inventing new business logic based on the images.

<!-- SPECKIT START -->

For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
at specs/003-eslint-rules/plan.md
<!-- SPECKIT END -->
