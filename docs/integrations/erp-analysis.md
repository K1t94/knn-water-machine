# Анализ ERP-интеграций платежей и автоматов

Дата анализа: 2026-07-24  
Референс: `/Users/k1t94/Work/Projects/kaynann/erp-reference`  
Режим: только чтение исходников. Команды запуска приложения, миграции, запись в БД и вызовы внешних систем не выполнялись.

## 1. Краткий вывод

ERP реализует входящие уведомления Wave и Orange Money, сохраняет платёж, отправляет автомату MQTT-команду `sell`, ждёт MQTT-ответ автомата и затем связывает платёж с асинхронным событием продажи. Фактически выданный объём приходит в поле `litresML` события продажи.

В ERP не обнаружены:

- связь платежа с конечным пользователем;
- пользовательский баланс/кошелёк литров;
- отдельная команда ожидания или подтверждения физической кнопки;
- отдельный серверный endpoint отмены платежа;
- протокол reconciliation после reconnect/no-connect.

Это существенно отличается от MVP нового приложения: там предусмотрены WalletTransaction, резерв литров, кнопка с таймаутом 60 секунд, `UNKNOWN/NO_CONNECT`, идемпотентное начисление недовыдачи и отсутствие возврата денег на внешний платёжный инструмент.

## 2. Найденные модули

| Модуль | Назначение |
|---|---|
| `/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/model/payments.py` | Модель платежа: provider, внешний payment_id, amount/currency, result/error_code, event_id, device_id, sale_id, expires_at, is_refunded, extra. Ограничение уникальности — `(provider, payment_id)`. |
| `/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/schema/payments.py` | MQTT-схемы запроса/ответа `sell`, включая `epayId`, `ttl`, `errCode`, `result`. |
| `/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/repository/payments.py` | Чтение и изменение платежей. |
| `/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/service/payments/payments.py` | Создание платежа, публикация команды, ожидание ответа, подтверждение, link с продажей, истечение и refund-флаги. |
| `/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/service/payments/utils.py` | Формирование `epayId` как `{provider}-{payment_id}` и извлечение исходного ID. |
| `/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/admin/v1/endpoints/merchant/wave.py` | Wave webhook и search/check готовности автомата. |
| `/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/service/merchant/wave.py` | QR Wave и внешний refund API. |
| `/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/shared/wave_sdk/schema.py` | Схемы Wave webhook/search. |
| `/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/shared/wave_sdk/validator.py` | Проверка HMAC-подписи Wave. |
| `/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/admin/v1/endpoints/merchant/orange.py` | Orange callback. |
| `/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/service/merchant/orange.py` | Связь Orange merchant-кода с автоматом; `refund_money` фактически `pass`. |
| `/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/shared/orange_sdk/schema.py` | Схемы Orange callback. |
| `/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/shared/orange_sdk/dependencies.py` | Проверка Orange Authorization. |
| `/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/device/topics/payments.py` | Приём MQTT-ответа автомата на `sell`. |
| `/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/device/topics/sale.py` | Приём MQTT-факта продажи/выдачи и link платежа с продажей. |
| `/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/messaging/sales.py` | Альтернативная AMQP-обработка того же sale-события. |
| `/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/schema/device_events.py` | Схема sale-события: price, litresML, sum, payMethod, epayId. |
| `/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/workers/payment_refunder/refunder.py` | Периодический поиск истёкших платежей и вызов provider refund. |
| `/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/shared/mqtt/service.py` | MQTT-клиент, reconnect и listener. |
| `/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/shared/mqtt/controller.py` | JSON-сериализация, TLS и publish. |
| `/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/shared/mqtt/router.py` | Декораторы topic и маршрутизация подписок. |
| `/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/device/topics/state.py` | Обновление состояния автомата, включая ready/sales possible. |

Тестовые сценарии, подтверждающие контракты: `tests/payments/`, `tests/merchant/`, `tests/mqtt/`, `tests/sales/`, `tests/webhooks/` в ERP.

## 3. Платёжная последовательность

### Wave

1. Wave вызывает `POST /wave/webhook`.
2. ERP проверяет подпись HMAC по timestamp и raw body.
3. Из `data.custom_fields.device_number` находится автомат.
4. Для `merchant.payment_received` вызывается общий `payment_request(provider="wave", ...)`.
5. Платёж сохраняется, ему назначается UUID `event_id`; `epayId` получает вид `wave-{provider_payment_id}`.
6. ERP публикует команду автомату и ждёт ответ максимум `PAYMENT_TTL_SEC` секунд.
7. Успешный ответ обновляет payment result. Ошибочный ответ сохраняет `error_code` и приводит к ошибке запроса.
8. Позже sale-событие с тем же `epayId` создаёт продажу и связывает её с платежом.

`POST /wave/search` проверяет подпись, автомат, state, `is_ready_to_sell` и `is_sales_possible`; при успехе возвращает подтверждённые custom fields. Это проверка готовности перед оплатой, а не создание внутреннего платежа.

### Orange Money

1. Orange вызывает `POST /orange/callback`.
2. Проверяется Authorization с настроенным значением и статус callback (`SUCCESS`).
3. `partner.id` преобразуется через merchant mapping в device ID.
4. Вызывается тот же `payment_request(provider="orange", ...)`, после чего поток MQTT и sale такой же, как у Wave.

### Создание и статус

Отдельного публичного `create payment` endpoint в найденном merchant API нет: запись платежа создаётся как побочный эффект входящего Wave webhook или Orange callback. Отдельного публичного `get payment status` endpoint также не найдено. Статус хранится в `PaymentModel.result/error_code`, а ожидание ответа выполняется внутри `payment_request`.

## 4. API endpoints

| Метод и путь | Назначение |
|---|---|
| `POST /wave/webhook` | Входящий Wave `merchant.payment_received`; создаёт payment и запускает `sell`. |
| `POST /wave/search` | Wave-проверка автомата перед оплатой. |
| `POST /orange/callback` | Входящий Orange callback; создаёт payment и запускает `sell`. |
| `GET /{device_id}/merchant` | Настройки merchant-провайдеров автомата. |
| `GET /{device_id}/merchant/{provider}` | Настройка конкретного provider. |
| `POST /{device_id}/merchant/{provider}` | Активировать provider. |
| `DELETE /{device_id}/merchant/{provider}` | Деактивировать provider. |
| `POST /{device_id}/merchant/orange/register` | Зарегистрировать Orange QR/PDF для автомата. |
| `GET /{device_id}/merchant/{provider}/qr-code` | Получить QR-код provider. |
| `/webhooks` под settings/event-logs | CRUD конфигураций исходящих webhook событий; точный общий prefix задаётся внешним router. |

Исходящие HTTP-вызовы: Wave refund — `POST https://api.wave.com/v1/transactions/{payment_id}/refund`. Orange refund HTTP-вызова в ERP нет.

## 5. MQTT: broker, topics и payload

### Подключение и broker

Источники: `/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/shared/mqtt/{service,controller,dependencies}.py`, `ci/app/etc/mqtt/mosquitto.conf`, `ci/app/etc/mqtt/acl.conf`, `ci/app/docker-compose.yml`.

В docker-compose broker называется `local-mqtt`; наружу заявлены порты 1883 и 8883. TLS listener использует client certificate и ACL. ERP-клиент по умолчанию использует port 1883, keepalive 10 секунд, client timeout 20 секунд; при наличии сертификатов включает TLS. MQTT publish по умолчанию — QoS 0, retain false.

### Найденные topics

| Направление | Topic |
|---|---|
| ERP → автомат, команда оплаты/старта продажи | `cmd/{modem_sn}/sell/v1/req` |
| Автомат → ERP, ответ на команду | `cmd/{modem_sn}/sell/v1/res` |
| Автомат → ERP, фактическая продажа/выдача | `dt/{modem_sn}/sale/v1` |
| Автомат → ERP, состояние | `$aws/things/{modem_sn}/shadow/name/status_v1/update` |
| Автомат → ERP, готовность продаж | `$aws/things/{modem_sn}/shadow/name/salesready_v1/update` |
| Автомат → ERP, настройки | `$aws/things/{modem_sn}/shadow/name/settings_v1/update` |
| Автомат → ERP, encash/log/telemetry | `dt/{modem_sn}/encash/v1`, `dt/{modem_sn}/logs_v1/v1`, `dt/{modem_sn}/logs/v1`, `dt/{modem_sn}/telemetry/v1` |
| ERP → автомат, время | `cmd/{modem_sn}/get_time/v1/req` |

ERP разрешает `readwrite #` для identities `Cloud` и `Device` в локальном ACL, то есть ACL не ограничивает topics по отдельным шаблонам.

### Санитизированные payload-примеры

Запрос ERP → автомат:

```json
{
  "version": "v1",
  "sn": "MODEM_SERIAL",
  "time": "2026-07-24T12:00:00Z",
  "eventId": "EVENT_UUID",
  "data": {
    "epayId": "wave-PROVIDER_PAYMENT_ID",
    "ttl": 1721822460,
    "sum": 1250
  }
}
```

Ответ автомат → ERP:

```json
{
  "version": "v1",
  "sn": "MODEM_SERIAL",
  "time": "2026-07-24T12:00:02Z",
  "eventId": "RESPONSE_EVENT_UUID",
  "data": {
    "epayId": "wave-PROVIDER_PAYMENT_ID",
    "result": "success",
    "errCode": "",
    "reason": ""
  }
}
```

Факт выдачи:

```json
{
  "version": "v1",
  "sn": "MODEM_SERIAL",
  "time": "2026-07-24T12:01:10Z",
  "eventId": "SALE_EVENT_UUID",
  "data": {
    "price": 100,
    "litresML": 11500,
    "sum": 1150,
    "payMethod": "epay",
    "epayId": "wave-PROVIDER_PAYMENT_ID"
  }
}
```

`litresML` — единственное найденное поле фактически выданного объёма. В ERP не найдено отдельного поля/события физической кнопки.

## 6. Таблица статусов

| Область | Значения/коды | Поведение ERP |
|---|---|---|
| Payment result | `success`, `failure` | Записывается после MQTT response; failure выбрасывает service error. |
| MQTT error | ``, `no_ready_to_sell`, `ttl_is_expired`, `duplicate` | Сохраняется как `error_code`; пустой код соответствует успешному ответу. |
| Внутренний timeout | `timeout` | Ожидание MQTT истекло; payment получает failure/timeout, наружу возвращается unavailable. |
| Refund lifecycle | `expired`, `expired-no-extra`, `expired-refund-error`, `expired-no-provider`; `is_refunded=true` | Worker помечает причину истечения или refund. Это не нормализованная публичная state machine. |
| Wave webhook type | `merchant.payment_received` | Только этот тип описан схемой callback. |
| Orange callback status | `SUCCESS` | Любой другой статус отклоняется BadRequest. |
| Device readiness | `is_ready_to_sell`, `is_sales_possible`, `is_no_water`, `not_ready_to_sell_reason` | Используется Wave search и state processing, не является payment status. |

## 7. Refund и отмена

Истёкшие платежи обрабатывает `/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/workers/payment_refunder/refunder.py`: worker опрашивает expired payment, затем вызывает provider. При Wave отправляется внешний refund с Bearer API key и ожидается HTTP 200. При отсутствии extra, неизвестном provider или исключении записывается соответствующая expired-ошибка.

Есть важное противоречие: `OrangeProvider.refund_money` в `/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/service/merchant/orange.py` — `pass`. Worker всё равно трактует отсутствие исключения как успешный refund и выставляет `is_refunded=true`, хотя фактического возврата Orange не выполняется.

Отдельный endpoint отмены платежа не найден. Если sale уже существует, worker логирует это и возвращает без очистки expiration; такой платёж потенциально может повторно попадать в обработку. Автоматического возврата денег в новом MVP, согласно requirements, быть не должно.

## 8. Связь платежа с пользователем и балансом

В `PaymentModel` нет `user_id`, wallet ID или ledger reference. Связи платежа:

- `device_id` — автомат;
- `sale_id` — итоговая продажа;
- `event_id` — MQTT correlation/idempotency UUID.

Найденное `msg_balance` относится к отображаемому сообщению/настройке автомата, а не пользовательскому кошельку. Упоминания `user_id` относятся к административному аудиту (`created_by_user_id` и подобные поля), не к платёжному владельцу. Следовательно, в ERP не найдено зачисления литров пользователю, резерва баланса, списания с баланса или возврата недовыданной разницы.

## 9. Последовательность выдачи воды

1. Callback провайдера создаёт payment и отправляет `sell` с `epayId`, суммой и TTL.
2. Автомат отвечает `sell/v1/res`; ERP ждёт этот ответ и обновляет payment.
3. Внутренний код ERP не содержит отдельной команды «ждать кнопку». Вероятно, firmware интерпретирует `sell` и само управляет выдачей, но исходники firmware в референсе не найдены.
4. Автомат публикует `dt/{sn}/sale/v1` после выдачи.
5. ERP создаёт idempotent sale по `eventId`, записывает `litresML`, сумму и способ оплаты.
6. Если `epayId` найден, sale связывается с payment через `sale_id`; expiration очищается.

При неизвестном автомате или ошибке обработки событие логируется и не ретраится в MQTT handler. В AMQP-варианте часть ошибок отклоняется с `requeue=false`.

## 10. Таймауты, no-connect и повторная обработка

- `PAYMENT_TTL_SEC` по умолчанию в конфигурации ERP — 60 секунд; он используется для TTL payload и ожидания ответа.
- При наличии `device.settings.sale_timeout` payment получает `expires_at = now + 24 часа`, а не `now + sale_timeout`. Это отдельный срок для refund worker и потенциально неожиданное расхождение названий.
- MQTT service при `MqttError` ждёт 2 секунды и переподключается, заново применяя subscriptions.
- MQTT listener ловит исключения handler и продолжает работу.
- Дубликаты на уровне БД ограничиваются `(provider, payment_id)`; sale использует idempotent insert по event ID.
- Повторный одинаковый sale callback не должен создавать вторую продажу, но точное поведение при повторной обработке после частичного сбоя зависит от transaction boundaries.
- Явных состояний `NO_CONNECT`, `UNKNOWN`, reconciliation после reconnect, повторной команды выдачи или защиты от повторного списания в ERP не найдено.
- `duplicate` существует как MQTT `errCode`, но отдельный публичный контракт повторной обработки для провайдера не описан.

## 11. Переменные окружения

Ниже только названия, без значений:

`SECRET_KEY`, `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `ADIMIN_LISTEN_HOST`, `ADIMIN_LISTEN_PORT`, `MQTT_HOSTNAME`, `MQTT_PORT`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `MQTT_CA_PATH`, `MQTT_CERT`, `MQTT_KEY`, `REDIS_URL`, `COORDINATION_KEY_PREFIX`, `AMQP_URL`, `RABBIT_SENDER_URL`, `PAYMENT_TTL_SEC`, `WAVE_WEBHOOK_SECRET`, `WAVE_SEARCH_SECRET`, `WAVE_API_KEY`, `WAVE_BASE_URL`, `ORANGE_SIGNATURE`.

## 12. Отличия ERP от нового приложения

| Тема | ERP reference | Новое приложение/MVP |
|---|---|---|
| Владелец платежа | Device + sale; user отсутствует | Пользователь, wallet и WalletTransaction обязательны. |
| Платёж | Callback сразу запускает `sell`; отдельного create endpoint нет | NestJS создаёт платёж/сессию, проверяет webhook идемпотентно и зачисляет литры. |
| Баланс | Не найден | Баланс только в литрах, резерв/списание/возврат недовыдачи. |
| Кнопка | Не найдена в server-side ERP | Физическая кнопка, ожидание максимум 60 секунд. |
| MQTT | Реальные topics и payload частично известны | Требуется отдельный MachineGateway; контракт broker/topics/payload/QoS пока нужно подтвердить с firmware. |
| Фактический объём | `litresML` в sale event | MQTT-факт используется для расчёта недовыдачи и idempotent credit. |
| No-connect | MQTT reconnect есть, бизнес-статуса нет | `UNKNOWN/NO_CONNECT`, без повторной выдачи/оплаты, затем reconciliation. |
| Refund | Wave refund worker; Orange no-op с ошибочным успешным флагом | Внешний refund не выполняется; недовыдача возвращается литрами на внутренний баланс. |
| Повторная обработка | DB uniqueness и sale idempotency, но не полный workflow | Idempotency key для платежа, начисления, списания и команды выдачи. |

## 13. Неизвестные и противоречивые места

1. Не найден firmware/документ, который объясняет, запускает ли `sell` выдачу сразу или сначала ожидает физическую кнопку.
2. Не найден payload кнопки, acknowledgment кнопки, команда остановки или признак начала выдачи.
3. Не установлены QoS/retain для каждого production topic: общий controller по умолчанию использует QoS 0 и retain false.
4. Не описано, как автомат сохраняет sale при blackout и как backend выполняет reconciliation после reconnect.
5. ERP содержит `sale_timeout`, но `payment_request` при его наличии фиксирует срок ровно 24 часа; нужно подтвердить, намеренно ли это.
6. Orange refund реализован как no-op, однако worker считает его успешным и ставит `is_refunded=true`.
7. Если expired payment уже имеет sale, refunder не очищает expiration; возможна повторная выборка worker.
8. Wave webhook одновременно является notification и триггером MQTT выдачи; не найден отдельный этап provider payment verification/status polling.
9. Для Wave есть HMAC-проверка raw body, для Orange — статический Authorization token; это разные модели аутентификации.
10. В requirements нового приложения сказано «оплата фактически выданного объёма», а ERP отправляет автомату заранее переданную сумму и лишь позже получает итоговый `sum`; правило расчёта/корректировки в ERP не найдено.

