# Context Policy

The goal is to keep Codex useful on large projects without loading the whole
repo into every turn.

## Default Context Budget

- Start with files directly related to the task.
- Prefer `rg` and file lists before opening source files.
- Read manifests/config first when the issue involves tooling.
- Read tests before changing behavior.
- Summarize large files instead of pasting them into chat.
- Keep durable facts in this repository's files, not in conversation history.

## Context Layers

1. `AGENTS.md`: stable project behavior and guardrails.
2. `.specify/memory/constitution.md`: non-negotiable project principles.
3. `.codex/docs/ai-style-memory.md`: confirmed local style.
4. `specs/<feature>/`: current feature requirements, plan, and tasks.
5. `.codex/docs/session-handoff.md`: current working state.
6. Relevant source/test/config files for the current diff.

## Large Project Rules

- Build or update `specs/000-project-onboarding/repo-map.md` before deep work.
- For unfamiliar areas, ask Codex to list candidate files before reading them.
- Use `/mention` for exact files when the needed context is known.
- Use `/compact` after long implementation runs.
- Use `/status` when context usage feels high.
- Use `/resume` to return to saved sessions when available.
- Use `/diff` before summarizing or committing.

## What Not To Keep In Context

- Full dependency directories.
- Build output.
- Coverage output.
- Long logs unless the exact error is needed.
- Generated files unless they are the source of truth.
- Old feature specs that are not relevant to the current task.

## Handoff Rule

Before a long pause, fill `.codex/docs/session-handoff.md` with the current
goal, next diff, validation state, and exact files to read on resume.

