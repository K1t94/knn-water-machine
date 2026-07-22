# Repo Map

Краткая карта репозитория KAYNANN Water Vending MVP. Источник продуктовых границ — `specs/000-project-onboarding/intake.md` и актуальные feature-specs.

> Статус: приложение ещё не создано. Структура ниже является целевой для bootstrap. После создания workspace заменить предполагаемые пути и команды фактическими.

## Stack

- TypeScript.
- Mobile: React Native, iOS и Android.
- Backend: NestJS, Node.js, Swagger/OpenAPI.
- Data: PostgreSQL; ORM будет выбран в bootstrap-spec.
- Messaging: Redis, очередь фоновых задач, MQTT через `MachineGateway`.
- Integrations: SMS/OTP, Wave, Orange Money, FCM/APNs, карты и геолокация.
- Tooling: единый workspace/monorepo; package manager, Node.js LTS и test runner будут закреплены в bootstrap-spec.

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
├── apps/                             # создать на этапе bootstrap
│   ├── mobile/                       # React Native приложение
│   └── api/                          # NestJS API и background jobs
├── packages/                         # создать только для реально общего кода
│   ├── contracts/                    # API DTO/types; без бизнес-логики
│   └── config/                       # общие настройки tooling
├── infra/                            # local services и deployment config
├── docs/                             # краткие технические решения/инструкции
└── package.json                      # root workspace scripts после bootstrap
```

Не создавать общий `shared`-пакет без конкретного переиспользуемого контракта. Backend остаётся владельцем бизнес-правил, баланса и финансовых операций.

## Important Entry Points

- `AGENTS.md` — постоянные правила для агента.
- `specs/000-project-onboarding/intake.md` — назначение, границы MVP и открытые входные данные.
- `specs/<feature>/spec.md` — продуктовые требования конкретной feature.
- `specs/<feature>/plan.md` — утверждённое техническое решение feature.
- `specs/<feature>/tasks.md` — порядок реализации feature.
- `apps/mobile/` — точные React Native entry points записать после выбора React Native CLI/Expo и bootstrap.
- `apps/api/src/main.ts` — ожидаемая точка запуска NestJS HTTP API; подтвердить после bootstrap.
- `apps/api/src/app.module.ts` — ожидаемый composition root backend; подтвердить после bootstrap.
- `apps/api/src/migrations/` или ORM-equivalent — схема и миграции PostgreSQL; точный путь зависит от выбранного ORM.
- `infra/` — локальные PostgreSQL, Redis и MQTT broker/emulator; точные файлы записать после bootstrap.

## Feature Areas

- `auth`, `users`, `legal` — телефон, OTP, токены, завершение регистрации только после принятия актуальных legal-документов.
- `machines`, `map`, `qr` — перечень автоматов, статусы, геопоиск, QR/manual machine ID.
- `wallet`, `wallet-transactions` — баланс в целых миллилитрах, аудит, бонусные и купленные литры, запрет отрицательного баланса.
- `package-catalog`, `payments` — пакеты 20/50/100 л, Wave/Orange Money, подписанные webhooks и идемпотентность.
- `dispense-sessions`, `machine-gateway` — резерв, физическая кнопка до 60 секунд, MQTT, фактический объём, недовыдача и reconciliation.
- `referrals` — промокоды, deep links, eligibility, приветственные и реферальные бонусы.
- `history`, `profile`, `notifications` — история операций, настройки пользователя и четыре push-сценария.

В mobile группировать код по тем же пользовательским областям, но не дублировать backend business rules на клиенте.

## Test Layout

- `apps/api/src/**/*.spec.ts` — unit-тесты доменной и прикладной логики рядом с кодом либо в утверждённом bootstrap layout.
- `apps/api/test/integration/` — PostgreSQL/Redis, webhook, MQTT emulator и persistence boundaries.
- `apps/api/test/e2e/` — критические backend-сценарии через публичный API.
- `apps/mobile/src/**/*.test.ts(x)` — mobile units/components.
- `apps/mobile/e2e/` — основные iOS/Android пользовательские потоки, если выбранный toolchain поддерживает их в MVP.

Обязательные сценарии: OTP + legal; повторный webhook; конкурентное списание; таймаут кнопки; недовыдача; повтор MQTT-события; `UNKNOWN/NO_CONNECT`; реферальный бонус и ограничения промокода.

## Validation Commands

Команды ещё не существуют. В bootstrap-spec определить root scripts со стабильными именами:

- install dependencies;
- start mobile/API/local services;
- lint;
- typecheck;
- unit tests;
- integration/e2e tests;
- build API/Android/iOS;
- create/apply/rollback migrations.

После bootstrap заменить этот список точными копируемыми командами из `package.json` и инфраструктурных файлов.

## Ignore By Default

- `.speckit-codex-boilerplate/` и `skills-templates/`, если задача не относится к их обновлению.
- `node_modules/` и зависимости.
- build output Android/iOS/Node.js.
- coverage output, caches и logs.
- generated OpenAPI/ORM/native artifacts.
- `.env*`, credentials, signing keys и сертификаты; допускается чтение только безопасных example-файлов.
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
