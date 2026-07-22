# Project Intake

Заполнено на основании ТЗ «Мобильное приложение для покупки воды через сеть автоматов KAYNANN», версия 0.12 / MVP от 21 июля 2026 года.

## Project Identity

- Project name: KAYNANN Water Vending MVP.
- Business purpose: дать пользователю возможность зарегистрироваться по номеру телефона, получить или купить литры воды, выбрать водомат по QR-коду либо на карте, запустить выдачу после физического подтверждения на автомате и оплатить фактически выданный объём.
- Primary users: клиенты сети водоматов KAYNANN с устройствами iOS или Android; со стороны эксплуатации — сервисы KAYNANN и сотрудники, контролирующие платежи, автоматы и спорные операции через логи и технические инструменты. Отдельная административная панель в MVP не входит.
- Production criticality: высокий. Система управляет платежами, внутренним балансом в литрах и физической выдачей воды. Критичны защита от двойного списания и повторной выдачи, идемпотентность финансовых и MQTT-событий, аудит операций и безопасная обработка неопределённых статусов.

## Stack

- Languages: TypeScript; SQL для миграций и диагностических запросов.
- Frameworks: React Native для мобильного приложения; NestJS для backend API.
- Package manager: уточнить на этапе bootstrap; предпочтительно единый package manager для mobile и backend.
- Runtime: Node.js для backend и инструментов сборки; точную LTS-версию закрепить на этапе bootstrap. Актуальные поддерживаемые версии iOS и Android уточнить перед релизом.
- Database/storage: PostgreSQL; безопасное хранилище access/refresh tokens на мобильном устройстве; объектное хранилище в MVP не требуется, если не появятся пользовательские медиафайлы.
- Messaging/cache/search: Redis; очередь фоновых задач; MQTT для связи с автоматами через отдельный MachineGateway-адаптер. Полнотекстовый или векторный поиск не требуется.
- Frontend: отдельного web-приложения и административной панели в MVP нет. Swagger/OpenAPI используется как технический интерфейс backend.
- Mobile: React Native + TypeScript + Mobx + RxJS + Axios-observable; навигация; QR/камера; карта и геолокация; deep links; FCM/APNs push; safe areas; управление разрешениями; безопасное хранение токенов.
- Infrastructure: окружения local/test/production; TLS; секреты вне репозитория; PostgreSQL, Redis и фоновые workers; CI для lint/typecheck/tests/build; тестовые Android/iOS-сборки. Конкретный облачный провайдер, контейнерная платформа и схема деплоя пока не утверждены.

## Architecture

- Main app entry points: iOS/Android mobile application; NestJS HTTP API; payment webhooks Wave и Orange Money; MQTT consumer/producer MachineGateway; background worker; push notification worker.
- Main modules/packages: auth/OTP; users/profile; legal-consent; machines/map; QR; wallet/balance; wallet-transactions/audit; package-catalog; payments; dispense-sessions; MachineGateway/MQTT; referrals; operation-history; notifications; configuration/observability. Финальное разбиение по пакетам закрепить в technical plan.
- External integrations: SMS/OTP provider; Wave; Orange Money; MQTT broker и API/репозиторий автоматов; FCM; APNs; картографический и геолокационный сервис; Apple/Google build and distribution services.
- Auth model: авторизация по номеру телефона и OTP; access/refresh tokens; rate limit и лимиты попыток. Регистрация считается завершённой только после подтверждения OTP и принятия актуальных legal-документов. Версия, дата и факт согласия должны сохраняться.
- Data ownership boundaries: PostgreSQL является источником истины для пользователей, legal-согласий, каталога пакетов, внутреннего баланса, WalletTransaction, платежей, dispense sessions, реферальных связей и истории. Платёжный провайдер является источником подтверждения внешнего платежа через валидный подписанный webhook. Автомат/MQTT является источником факта физически выданного объёма. Баланс хранится в целых миллилитрах; отрицательный баланс запрещён. Денежные значения хранятся в минимальных единицах валюты, без float.
- Background workers/jobs: отправка push; обработка безопасных повторов внешних операций; истечение 60-секундного ожидания физической кнопки; reconciliation операций UNKNOWN/NO_CONNECT после восстановления связи; обработка MQTT-событий; напоминание об отсутствии покупок. Retry разрешён только для идемпотентных и безопасных операций.

## Commands

- Install: определить после создания workspace и выбора package manager; ожидаемый формат — одна команда установки зависимостей из корня репозитория.
- Start dev: определить на этапе bootstrap; должен запускать mobile, API и необходимые локальные сервисы понятными отдельными командами.
- Build: определить на этапе bootstrap; отдельные сборки backend, Android и iOS.
- Unit tests: определить на этапе bootstrap; обязательны тесты критической бизнес-логики.
- Integration/e2e tests: определить на этапе bootstrap; обязательны сценарии OTP + legal, подписанного webhook, повторного webhook, баланса, недовыдачи, таймаута кнопки, NO_CONNECT, повторного MQTT-события и реферального бонуса.
- Lint: определить на этапе bootstrap; команда должна работать из корня репозитория.
- Typecheck: определить на этапе bootstrap; отдельная проверка mobile и backend либо общая workspace-команда.
- Migrations: определить после выбора ORM; миграции должны быть версионируемыми и воспроизводимыми.
- Docker/local services: PostgreSQL, Redis и MQTT broker/emulator для локальной разработки; точные команды и compose-файл определить на этапе bootstrap.

## Rules And Risks

- Files/directories to ignore: `node_modules/`, build artifacts, Android/iOS generated build directories, coverage, caches, IDE metadata, локальные выгрузки логов, `skills-templates/`; старые specs читать только когда они относятся к текущей feature.
- Generated files: lockfile изменяется только package manager; ORM client/schema artifacts, OpenAPI-generated clients, native build outputs и coverage не редактировать вручную. Точный список обновить после выбора инструментов.
- Sensitive files: `.env*` с реальными значениями, API keys, OTP/SMS credentials, Wave/Orange merchant credentials, webhook secrets, MQTT credentials/certificates, FCM service-account files, APNs keys, signing certificates и store credentials. В репозитории хранить только безопасный `.env.example`.
- Known fragile areas: незафиксированный MQTT-контракт; blackout и reconciliation; UNKNOWN/NO_CONNECT; повторные и неупорядоченные webhook/MQTT-события; конкурентные списания баланса; таймаут физической кнопки 60 секунд; недовыдача и возврат литров; приоритет списания бонусных литров перед купленными; регистрация только после OTP + legal; реферальные ограничения; deep links; разрешения камеры/геолокации/push; различия iOS/Android; внешние платежные sandbox/production API.
- Required approval before: изменение бизнес-правил баланса, платежей, недовыдачи, возврата или реферальной программы; добавление MTN Mobile Money; изменение прошивки/протокола автомата; добавление административной панели; возврат денег на внешний платёжный инструмент; изменение состава MVP; выбор платного внешнего сервиса; production deploy; применение необратимой миграции; использование реальных merchant, signing или store credentials.

## Current Goal

- What should be changed: создать с нуля MVP KAYNANN как React Native-приложение для iOS/Android и NestJS backend. Реализовать OTP + legal, баланс в литрах, QR и карту автоматов, покупку и пакетное пополнение через Wave/Orange Money, 60-секундное ожидание физической кнопки, учёт фактической выдачи через MQTT, возврат недовыданных литров на баланс, историю, профиль, реферальную программу и четыре push-сценария. Работу выполнять отдельными feature-specs, а не одной общей feature.
- What is explicitly out of scope: MTN Mobile Money; прошивка автомата; административная панель; редактор и сегментация рассылок; внутренняя лента уведомлений; сложная аналитика; регистрация merchant-аккаунтов; возврат денег на внешний Wave/Orange; удаление аккаунта; публикация под аккаунтами заказчика без предоставленных доступов; deferred deep linking и сохранение промокода после установки из магазина; отдельная дизайн-система и несколько UX-концепций.
- Expected validation: одинаковое основное поведение на тестовых iOS/Android устройствах; успешный end-to-end поток на тестовых платежах и тестовом либо реальном автомате; Swagger/OpenAPI; миграции; unit/integration/e2e для критических сценариев; отсутствие двойного списания, двойного начисления и автоматической повторной выдачи; понятные логи и метрики платежей, MQTT, UNKNOWN-сессий и возвратов; тестовые Android/iOS-сборки.

## Open Inputs Before Integration Work

- Боевые и тестовые доступы Wave и Orange Money.
- Выбранный SMS/OTP-провайдер и его тестовые доступы.
- Валюта, цены пакетов 20/50/100 литров и размеры скидок.
- Размер приветственного и реферального бонусов.
- Финальные тексты и версии legal-документов.
- Перечень автоматов, координаты, адреса, цены и статусы.
- MQTT broker, topics, payload, QoS, статусы и правила reconciliation.
- Подтверждение сохранения факта выдачи автоматом при blackout.
- Картографический провайдер.
- Аккаунты Apple/Google, bundle/application identifiers и signing-доступы для сборок и публикации.
