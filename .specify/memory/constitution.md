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

## Workflow

1. Analyze relevant context.
2. State assumptions and a short numbered plan.
3. Implement one logical diff.
4. Run minimal validation.
5. Summarize changed files, validation, and residual risk.

## Governance

This constitution guides planning, task breakdown, implementation, and review.
Project-specific rules may extend it but should not weaken the core principles.

**Version**: 1.0.0 | **Ratified**: YYYY-MM-DD | **Last Amended**: YYYY-MM-DD

