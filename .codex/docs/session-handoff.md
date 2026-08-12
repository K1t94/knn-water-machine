# Session Handoff

Use this before closing the terminal, switching branches, or compacting a long
conversation.

## Current Goal

- Доработать `005-referral-program` по обновленным `spec.md`, `plan.md` и
  `tasks.md`; Phase 1-6 завершены.

## Current Branch

- `master`

## Current Feature Directory

- `specs/005-referral-program`

## Done

- Задачи Phase 1-6 (`T001-T069`) выполнены и отмечены в `tasks.md`.
- Mobile получает server-authoritative referral availability через публичный
  app-config adapter; MobX владеет состоянием, RxJS отменяет устаревшие запросы.
- Referral UI, registration promo input и deep-link context скрываются или
  очищаются при unknown/disabled state.
- Post-registration apply-code UI, API client operations и eligibility state
  удалены; signed-in referral links игнорируются.
- `FEATURE_DISABLED` очищает referral state и блокирует возврат данных из
  устаревших in-flight запросов.
- При enabled state сохранены просмотр, копирование и share referral code/link.
- Referral summary считает только доставленные inviter credits владельца;
  welcome history не влияет на totals.
- Owner-scoped cursor history проверена на 250 строках и остается неизменной
  после 100 циклов disable/re-enable.
- Активный referral screen полностью подавляет content/actions при disabled и
  не принимает устаревшую страницу после очистки состояния.

## In Progress

- Нет незавершенных задач Phase 6.

## Blocked

- Нет блокеров.

## Next Single Diff

- Начать Phase 7 с задач T070-T072: доказать отсутствие runtime eligibility
  references и выполнить безопасную contract migration.

## Validation Already Run

- Phase 5 mobile suite: 30 test files, 124 tests passed.
- `pnpm --filter @kaynann/mobile typecheck`
- `pnpm --filter @kaynann/mobile lint`
- `pnpm --filter @kaynann/mobile build:js`
- `git diff --check`
- Phase 6 API query suite: 4 tests passed.
- Phase 6 PostgreSQL repository suite: 3 tests passed, включая 250 записей и
  100 циклов disable/re-enable.
- Phase 6 mobile referral screen suite: 5 tests passed.
- Targeted API/mobile ESLint passed.
- API и mobile typecheck пройдены для итогового Phase 6 diff.

## Validation Still Needed

- Ручная проверка enabled/disabled UI, deep links, copy/share и активного
  referral route на iOS/Android device или simulator.

## Files To Read On Resume

- `AGENTS.md`
- `.codex/docs/context-policy.md`
- `.codex/docs/ai-style-memory.md`
- `.codex/docs/session-handoff.md`
- `.specify/memory/constitution.md`
- `specs/005-referral-program/spec.md`
- `specs/005-referral-program/plan.md`
- `specs/005-referral-program/tasks.md`
- `specs/005-referral-program/data-model.md`
- `specs/005-referral-program/research.md`
- `package.json`

## Notes

- Не изменять пользовательский файл `.codex/.codex/logs/codex-tui.log`.
- Build output `dist/mobile` не отслеживается git.
