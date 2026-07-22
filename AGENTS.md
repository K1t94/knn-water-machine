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

