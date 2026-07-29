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
- Current implemented scope: bootstrap plus Phone OTP Authentication through
  OTP, fake SMS delivery, legal-gated registration, access/refresh sessions,
  refresh rotation/replay detection, and mobile session restoration.

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
│   │   ├── src/App.tsx               # mobile composition and navigation entry
│   │   ├── src/auth/                 # MobX/RxJS OTP and registration flows
│   │   ├── src/api/                  # cold Observable HTTP adapters
│   │   └── __tests__/                # mobile smoke/test harness
│   └── api/                          # NestJS API; manifest and entry: apps/api/
│       ├── src/auth/                 # OTP routing and registration completion
│       ├── src/otp/                  # Senegal parsing and Redis OTP state machine
│       ├── src/sms/                  # provider-neutral SMS port and adapters
│       ├── src/legal/                # current documents and acceptances
│       ├── src/sessions/             # session credentials and persistence
│       ├── src/users/                # user persistence
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
- `apps/mobile/index.ts` — Expo registration entry point;
  `apps/mobile/src/App.tsx` — auth composition and navigation entry.
- `apps/mobile/src/auth/` — presentation-oriented screens, MobX state, and
  private RxJS application orchestration.
- `apps/mobile/src/api/auth-api.ts` — cold Observable authentication API
  boundary.
- `apps/api/src/main.ts` — NestJS HTTP API bootstrap and lifecycle.
- `apps/api/src/app.module.ts` — backend composition root.
- `apps/api/src/auth/`, `apps/api/src/otp/`, `apps/api/src/sessions/`,
  `apps/api/src/legal/`, and `apps/api/src/sms/` — Phone OTP Authentication
  application and infrastructure boundaries.
- `apps/api/src/health/health.controller.ts` — public `GET /health`, 200/503 contract.
- `apps/api/prisma/schema.prisma` — Prisma datasource/generator; migrations in `apps/api/prisma/migrations/`.
- `infra/compose.yaml` — PostgreSQL, Redis, Mosquitto services and healthchecks.
- `infra/mosquitto/mosquitto.conf` — anonymous local MQTT listener only; no vending topics.

## Feature Areas

- `auth`, `otp`, `sessions`, `sms`, `users`, `legal` — текущая feature
  регистрации и входа по телефону. Orange остаётся provider adapter и не
  импортируется бизнес-логикой.

## Future Feature Areas

- `machines`, `map`, `qr` — перечень автоматов, статусы, геопоиск, QR/manual machine ID.
- `wallet`, `wallet-transactions` — баланс в целых миллилитрах, аудит, бонусные и купленные литры, запрет отрицательного баланса.
- `package-catalog`, `payments` — пакеты 20/50/100 л, Wave/Orange Money, подписанные webhooks и идемпотентность.
- `dispense-sessions`, `machine-gateway` — резерв, физическая кнопка до 60 секунд, MQTT, фактический объём, недовыдача и reconciliation.
- `referrals` — промокоды, deep links, eligibility, приветственные и реферальные бонусы.
- `history`, `profile`, `notifications` — история операций, настройки пользователя и четыре push-сценария.

В mobile группировать код по тем же пользовательским областям, но не дублировать backend business rules на клиенте.

## Test Layout

- `apps/api/src/**/**.spec.ts` — unit and module-local integration tests.
- `apps/api/test/*contract-spec.ts` — public HTTP contract tests.
- `apps/api/test/health.e2e-spec.ts` — public health contract tests.
- `apps/api/test/startup.smoke-spec.ts` — configuration, redaction, and bounded startup smoke tests.
- `apps/mobile/src/**/*.spec.{ts,tsx}` — MobX store, RxJS flow, storage, and API tests.
- `apps/mobile/__tests__/` — Expo render and test-harness tests.

Обязательные сценарии будущих feature вне текущей Phone OTP Authentication:
повторный webhook; конкурентное списание; таймаут кнопки; недовыдача; повтор
MQTT-события; `UNKNOWN/NO_CONNECT`; реферальный бонус и ограничения промокода.

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
