# Session Handoff

Use this before closing the terminal, switching branches, or compacting a long
conversation.

## Current Goal

- Реализовать `002-phone-otp-auth` по утвержденным `spec.md`, `plan.md` и
  `tasks.md`; Phase 1-5 завершены.

## Current Branch

- `master`

## Current Feature Directory

- `specs/002-phone-otp-auth`

## Done

- Задачи Phase 1-5 (`T001-T086`) выполнены и отмечены в `tasks.md`.
- Реализованы OTP challenge, Redis atomicity и anti-abuse из предыдущих фаз.
- Добавлены заменяемый `SmsProvider` и `FakeSmsProvider`.
- Реализованы registration authorization, legal version validation,
  атомарное создание пользователя, legal acceptance и initial session.
- Pending promo переносится только как неприменяемый registration context.
- Mobile registration flow использует MobX для состояния, RxJS для
  orchestration и SecureStore для registration authorization.
- Реализованы access/refresh sessions, rotation lineage, replay detection,
  отдельные device sessions и logout текущего устройства.
- Mobile session flow восстанавливает сессию через SecureStore, автоматически
  ротирует refresh token и хранит access token только в памяти.
- OpenAPI обновлен для OTP, registration, legal и session endpoints.

## In Progress

- Нет незавершенных задач Phase 5.

## Blocked

- Нет блокеров. Live Orange credentials не требуются до отдельного
  post-credential acceptance этапа.

## Next Single Diff

- Начать Phase 6 с `OrangeSmsProvider`, OAuth token cache и mock HTTP API
  (`T087-T103`). Live credentials для этого не требуются.

## Validation Already Run

- `pnpm lint`
- `pnpm typecheck`
- `pnpm build:api`
- `pnpm build:mobile:js`
- `pnpm --filter @kaynann/api test` (102 passed, 20 feature-gated skipped)
- Redis registration integration (8/8 with `RUN_REDIS_INTEGRATION=1`)
- PostgreSQL persistence constraints (6/6 against local Compose PostgreSQL)
- Registration transaction/concurrency integration (7/7)
- OTP and registration HTTP contracts (19/19)
- `pnpm --filter @kaynann/mobile test` (65/65)
- Phase 5 API session tests (23/23, включая PostgreSQL concurrency/replay)
- Phase 5 mobile session tests (21/21)
- `pnpm --filter @kaynann/api openapi:check`
- `git diff --check`

## Validation Still Needed

- Native visual acceptance of phone, OTP, legal, session restoration,
  stale-legal routing and logout on iOS/Android remains a manual device check.
- Live Orange OAuth, Sender Name, balance, delivery and DLR checks remain in
  the post-credential phase.

## Files To Read On Resume

- `AGENTS.md`
- `.codex/docs/context-policy.md`
- `.codex/docs/ai-style-memory.md`
- `.codex/docs/session-handoff.md`
- `.specify/memory/constitution.md`
- `specs/002-phone-otp-auth/spec.md`
- `specs/002-phone-otp-auth/plan.md`
- `specs/002-phone-otp-auth/tasks.md`
- `specs/002-phone-otp-auth/data-model.md`
- `specs/002-phone-otp-auth/research.md`
- `package.json`

## Notes

- Не изменять пользовательское удаление
  `docs/speckit-prompts/otpspecify-prompt.txt`.
- Локальные PostgreSQL, Redis и MQTT контейнеры запущены; production
  credentials не использовались.
