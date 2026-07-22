# Repo Map

Краткая карта репозитория KAYNANN Water Vending MVP. Источник продуктовых границ — `specs/000-project-onboarding/intake.md` и актуальные feature-specs.

> Статус: bootstrap создан. Карта отражает фактическую структуру и команды текущего MVP.

## Stack

- TypeScript.
- Mobile: React Native 0.81 on Expo SDK 54, iOS и Android.
- Backend: NestJS 11 on Node.js 24.x LTS.
- Data: PostgreSQL 17, Prisma 6 migrations.
- Local messaging: Redis 7 and Mosquitto 2 MQTT emulator.
- Tooling: pnpm 10.15.1 workspace; Vitest 3; ESLint 9; Prettier 3.
- Scope: connectivity/bootstrap only; no OTP, payments, balance, dispensing, referrals, or external providers.

## Top-Level Layout

```text
.
├── AGENTS.md                         # правила работы Codex
├── .codex/                           # политика контекста и запуск Codex
├── .specify/                         # Spec Kit templates и constitution
├── .agents/skills/                   # подключённые skills
├── specs/                            # onboarding и отдельные feature-specs
│   └── 000-project-onboarding/
│       ├── intake.md
│       └── repo-map.md
├── apps/
│   ├── mobile/                       # Expo app; manifest and entry: apps/mobile/
│   │   ├── index.ts                  # Expo registration entry point
│   │   ├── src/App.tsx               # baseline screen
│   │   └── __tests__/App.test.tsx    # mobile smoke test
│   └── api/                          # NestJS API; manifest and entry: apps/api/
│       ├── src/config/               # validated env loading/redacted diagnostics
│       ├── src/health/               # bounded dependency probes and GET /health
│       ├── test/                     # API contract and startup smoke tests
│       └── prisma/                   # schema and migrations
├── infra/                            # Compose and Mosquitto emulator config
├── docs/local-development.md         # local setup, toolchain, and validation
├── scripts/                          # startup, safety, and mobile prerequisite checks
├── .env.example                      # safe local placeholders only
└── package.json                      # root workspace scripts
```

Не создавать общий `shared`-пакет без конкретного переиспользуемого контракта. Backend остаётся владельцем бизнес-правил, баланса и финансовых операций.

## Important Entry Points

- `AGENTS.md` — постоянные правила для агента.
- `specs/000-project-onboarding/intake.md` — назначение, границы MVP и открытые входные данные.
- `specs/<feature>/spec.md` — продуктовые требования конкретной feature.
- `specs/<feature>/plan.md` — утверждённое техническое решение feature.
- `specs/<feature>/tasks.md` — порядок реализации feature.
- `apps/mobile/index.ts` — Expo registration entry point; `apps/mobile/src/App.tsx` — baseline screen.
- `apps/api/src/main.ts` — NestJS HTTP API bootstrap and lifecycle.
- `apps/api/src/app.module.ts` — backend composition root.
- `apps/api/src/health/health.controller.ts` — public `GET /health`, 200/503 contract.
- `apps/api/prisma/schema.prisma` — Prisma datasource/generator; migrations in `apps/api/prisma/migrations/`.
- `infra/compose.yaml` — PostgreSQL, Redis, Mosquitto services and healthchecks.
- `infra/mosquitto/mosquitto.conf` — anonymous local MQTT listener only; no vending topics.

## Future Feature Areas

- `auth`, `users`, `legal` — телефон, OTP, токены, завершение регистрации только после принятия актуальных legal-документов.
- `machines`, `map`, `qr` — перечень автоматов, статусы, геопоиск, QR/manual machine ID.
- `wallet`, `wallet-transactions` — баланс в целых миллилитрах, аудит, бонусные и купленные литры, запрет отрицательного баланса.
- `package-catalog`, `payments` — пакеты 20/50/100 л, Wave/Orange Money, подписанные webhooks и идемпотентность.
- `dispense-sessions`, `machine-gateway` — резерв, физическая кнопка до 60 секунд, MQTT, фактический объём, недовыдача и reconciliation.
- `referrals` — промокоды, deep links, eligibility, приветственные и реферальные бонусы.
- `history`, `profile`, `notifications` — история операций, настройки пользователя и четыре push-сценария.

В mobile группировать код по тем же пользовательским областям, но не дублировать backend business rules на клиенте.

## Test Layout

- `apps/api/test/health.e2e-spec.ts` — public health contract tests.
- `apps/api/test/startup.smoke-spec.ts` — configuration, redaction, and bounded startup smoke tests.
- `apps/mobile/__tests__/App.test.tsx` — baseline Expo render test.

These are future product areas, not implemented by the bootstrap. Обязательные сценарии будущих feature: OTP + legal; повторный webhook; конкурентное списание; таймаут кнопки; недовыдача; повтор MQTT-события; `UNKNOWN/NO_CONNECT`; реферальный бонус и ограничения промокода.

## Validation Commands

Фактические root-команды из `package.json`:

```sh
pnpm install --frozen-lockfile
pnpm services:up
pnpm services:down
pnpm db:migrate
pnpm dev
pnpm dev:api
pnpm dev:mobile
pnpm verify:start
pnpm lint
pnpm typecheck
pnpm test
pnpm build:api
pnpm build:mobile:js
pnpm mobile:doctor
pnpm mobile:prebuild
pnpm check:env
pnpm check:repo
```

`pnpm verify:start` запускает сервисы, поднимает API через `dev:api` и
проверяет `GET /health`: HTTP 200, все три dependency status `up`, лимит 5
секунд. При недоступной зависимости ожидается HTTP 503 без зависания.

## Ignore By Default

- `.speckit-codex-boilerplate/` и `skills-templates/`, если задача не относится к их обновлению.
- `node_modules/` и зависимости.
- build output Android/iOS/Node.js.
- coverage output, caches и logs.
- generated OpenAPI/ORM/native artifacts.
- `.env*`, credentials, signing keys и сертификаты; допускается чтение только `.env.example`.
- старые `specs/`, не связанные с текущей feature.
- lockfile, кроме задач по зависимостям.

## Risky Areas

- Платежи, wallet ledger и конкурентные изменения баланса.
- Идемпотентность webhook, MQTT, начисления, списания и dispense command.
- MQTT-контракт, blackout, неупорядоченные события и reconciliation `UNKNOWN/NO_CONNECT`.
- Таймаут физической кнопки, недовыдача и возврат литров без внешнего денежного refund.
- Различия iOS/Android: deep links, camera/location/push permissions и background behavior.
- Миграции данных, production secrets и любые действия с реальными merchant/store accounts.

Для изменений в этих областях сначала читать актуальные `spec.md`, `plan.md`, связанные тесты и контракт внешней интеграции. Не изменять бизнес-правила по предположению.

## Update Rule

Обновлять карту после bootstrap и при изменении архитектуры, entry points, workspace layout или validation commands. Не обновлять её для обычных изменений внутри feature.
