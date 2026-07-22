---
name: speckit-codex-mode
description: Explains and enforces Codex subscription/API/model mode policy for this project. Use when the user asks about subscription mode, API mode, model choice, token usage, or context pressure.
---

# Spec Kit Codex Mode

## Purpose

Help the user choose the correct Codex launch mode, model mode, and context strategy.

## Key Rules

- Subscription vs API mode is selected when Codex starts.
- Do not silently switch to Platform API billing.
- If current auth mode is wrong, ask the user to restart Codex using:
  - `.codex/bin/codex-subscription`
  - `.codex/bin/codex-api`
- Use subscription mode by default.
- Use API mode only when the user explicitly asks for it or confirms fallback after subscription limits are exhausted.

## Model Routing Guidance

Use the cheapest/smallest adequate mode:

- Simple edit, docs, typo, small refactor:
  - fast model
  - low reasoning
  - concise output
- Normal feature or bug fix:
  - standard coding model
  - medium reasoning
- Architecture, migration, auth, security, cross-module refactor:
  - strong coding model
  - high reasoning
  - require plan and validation

If the current session is not using the right model/settings, stop and tell the user exactly what to switch before continuing.

## Context Rules

Before reading files:

1. Read `specs/000-project-onboarding/repo-map.md`.
2. List candidate files.
3. Read only relevant files.
4. Do not read `skills-templates/` unless the user explicitly asks for a skill.
5. Keep outputs short.
