This project supports two Codex auth modes:

1. ChatGPT/Codex subscription mode
2. Platform API-key mode

These modes are selected when Codex starts. A running Codex session cannot reliably switch between them by editing project files.

## Launch Modes

Use one of the project launchers:

- `.codex/bin/codex-subscription`
- `.codex/bin/codex-api`

Use subscription mode by default. Use API mode only when the user explicitly asks for API billing or subscription limits are exhausted.

## Model Modes

Default mode should conserve tokens.

Recommended behavior:

- Fast/simple work:
  - low reasoning
  - concise output
  - minimal file reads
- Standard feature work:
  - medium reasoning
  - one feature phase at a time
- Deep/high-risk work:
  - high reasoning
  - only after a repo map and relevant spec/plan/tasks exist

If the current model or reasoning level is not appropriate, stop and ask the user to switch modes before continuing.

## Billing Safety

Never silently switch to Platform API billing.

Before using API mode, confirm that the user understands Platform API billing may incur usage-based charges.

## Context Safety

Do not load all Spec Kit files, all skills, or all docs.

Read only the files needed for the current command or feature phase.
