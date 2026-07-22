# Session Handoff

Use this before closing the terminal, switching branches, or compacting a long
conversation.

## Current Goal

- `project-bootstrap` завершен: поддерживать готовую базу monorepo и перейти к
  следующей feature после ее явного определения.

## Current Branch

- `master`

## Current Feature Directory

- `specs/001-project-bootstrap`

## Done

- Все задачи `T001-T044` выполнены и отмечены в `tasks.md`.
- Создан monorepo на pnpm с Node.js 24.x, Expo React Native mobile app и
  NestJS API.
- Настроены PostgreSQL, Redis и локальный Mosquitto MQTT emulator через
  `infra/compose.yaml`.
- Выбраны Prisma ORM и Vitest; добавлены lint, typecheck, test и build-команды.
- Добавлены безопасный `.env.example`, Prisma migration flow, healthcheck и
  `verify:start` с лимитом ответа `/health` менее 5 секунд.
- Обновлены onboarding repo map, local development docs и bootstrap quickstart.
- Бизнес-функции, OTP, платежи, баланс, выдача воды и рефералы не реализованы.

## In Progress

- Нет активной реализации; следующую feature нужно сначала описать через
  Spec Kit.

## Blocked

- Нет блокирующих проблем для API и JavaScript-проверок.

## Next Single Diff

- Определить следующую MVP feature и обновить соответствующие `spec.md`,
  `plan.md` и `tasks.md`; EAS Build и бизнес-функции остаются отдельными
  будущими изменениями.

## Validation Already Run

- `pnpm install --frozen-lockfile`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test` (API: 8/8, mobile: 1/1)
- `pnpm build:api`
- `pnpm build:mobile:js`
- `pnpm db:migrate`
- `pnpm check:env`
- `pnpm check:repo`
- `pnpm verify:start` against the local Compose stack
- `pnpm mobile:doctor` and `pnpm mobile:prebuild`
- `git diff --check`

## Validation Still Needed

- Нет обязательных проверок для завершенного bootstrap.
- При изменении окружения повторить `pnpm mobile:doctor` и `pnpm verify:start`.

## Files To Read On Resume

- `AGENTS.md`
- `.codex/docs/context-policy.md`
- `.codex/docs/ai-style-memory.md`
- `.codex/docs/session-handoff.md`
- `.specify/memory/constitution.md`
- `specs/000-project-onboarding/repo-map.md`
- `specs/001-project-bootstrap/spec.md`
- `specs/001-project-bootstrap/plan.md`
- `specs/001-project-bootstrap/tasks.md`
- `specs/001-project-bootstrap/quickstart.md`
- `package.json`
- `docs/local-development.md`

## Notes

- Репозиторий требует Node.js `>=24 <25`; текущая локальная shell-сессия ранее
  показывала Node.js `22.18.0`, поэтому pnpm может выводить engine warning.
- Native iOS/Android builds требуют локальных Xcode/CocoaPods или Android
  SDK/adb; Expo JavaScript export работает без них. EAS Build пока не настроен
  root-командами.
- Локальный `.env` и состояние Docker-сервисов не являются частью репозитория;
  production credentials не используются.
