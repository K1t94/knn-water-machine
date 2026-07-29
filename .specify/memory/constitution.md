<!--
Sync Impact Report
- Version change: 1.0.0 -> 1.1.0
- Modified principles: none
- Added principles: IX. Frontend Reactive Architecture
- Added sections: none
- Removed sections: none
- Templates reviewed:
  - ✅ .specify/templates/plan-template.md: Constitution Check already derives
    feature gates from this file; no structural change required.
  - ✅ .specify/templates/spec-template.md: remains technology-agnostic; no
    change required.
  - ✅ .specify/templates/tasks-template.md: already requires foundational
    dependencies and story-local tests; no structural change required.
  - ✅ .specify/templates/commands/: no conflicting frontend architecture
    guidance found.
- Runtime guidance updated:
  - ✅ AGENTS.md
  - ✅ specs/002-phone-otp-auth/plan.md
  - ✅ specs/002-phone-otp-auth/research.md
  - ✅ specs/002-phone-otp-auth/tasks.md
  - ✅ specs/002-phone-otp-auth/quickstart.md
- Deferred follow-ups: none
-->
# Project Constitution

## Core Principles

### I. One Logical Diff At A Time

Implementation work must be scoped to one logical diff whenever feasible. Broad
rewrites, architecture changes, schema changes, dependency changes, and security
changes require explicit approval.

### II. Validate Inputs At Boundaries

Every external input must be validated at the boundary appropriate for the
framework: controller DTO, request schema, command parser, form validator, or
equivalent.

### III. Shape Public Outputs Explicitly

Public responses and exported data must include only intentional fields. Secret,
internal, credential, token, or private fields must never be exposed.

### IV. Schema Changes Use Migrations

Persistent schema changes must be made through migrations or the project's
equivalent migration mechanism. Automatic synchronization is not a real workflow
for shared environments.

### V. Security-Sensitive Behavior Is High Risk

Auth, authorization, session, token, credential, and secret-handling changes
must be reviewed carefully and validated with the smallest useful checks.

### VI. Minimal Validation After Each Change

Each logical diff must run the smallest relevant validation command. Missing
validation scripts must be reported instead of replaced with invented commands.

### VII. Durable Style Memory Is Human-Guided

Style memory lives in `.codex/docs/ai-style-memory.md` and is updated only when
the user explicitly says `promote this to style`.

### VIII. Context Is A Resource

Agents must inspect only relevant files, summarize large context, use handoff
files for long sessions, and avoid loading unrelated old work.

### IX. Frontend Reactive Architecture

The React Native application must use MobX as the single owner of observable
application, session, and screen state. Derived state and state transitions must
use MobX computed values and actions. RxJS must orchestrate asynchronous event
flows when they require cancellation, concurrency control, time-based behavior,
retry policy, or composition of multiple event sources.

React components may observe MobX stores but must remain presentation-oriented;
they must not own long-lived RxJS subscriptions or expose RxJS subjects through
component props. Stores or application services that create subscriptions must
provide an explicit disposal lifecycle. The same state must not be represented
independently in React state, MobX, and RxJS. API and storage adapters must remain
independent of React components, and server-provided authentication, OTP,
session, and legal state remains authoritative.

## Workflow

1. Analyze relevant context.
2. State assumptions and a short numbered plan.
3. Implement one logical diff.
4. Run minimal validation.
5. Summarize changed files, validation, and residual risk.

## Governance

This constitution guides planning, task breakdown, implementation, and review.
Project-specific rules may extend it but should not weaken the core principles.

**Version**: 1.1.0 | **Ratified**: 2026-07-29 | **Last Amended**: 2026-07-29
