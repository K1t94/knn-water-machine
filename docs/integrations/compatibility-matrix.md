# Compatibility matrix: ERP → NestJS integration layer

Имена NestJS в таблице проектные; реализация не выполняется этим документом.

| Python ERP источник/операция | Найденное поведение | Будущий NestJS класс/метод | Совместимость и ограничения |
|---|---|---|---|
| `service/payments/payments.py::payment_request` | Создаёт PaymentModel, event UUID, `provider-payment_id`, публикует `sell`, ждёт response | `PaymentService.acceptProviderPayment()` + `MachineGateway.requestDispense()` | Сохранить provider/paymentId/amount/currency/deviceId/eventId/extra; повтор callback не публикует второй command. |
| `service/payments/payments.py::get_by_payment_id` | Ищет по provider payment ID и device; извлекает ID из `provider-id` | `PaymentRepository.findByProviderPaymentId()` | Ограничение по machine обязательно при sale. |
| `service/payments/payments.py::confirm` | Передаёт response по `epayId` ожидающему waiter | `MqttMachineGateway.handleSellResponse()` + `PaymentService.applyMachineResult()` | Обновляет result/errorCode; enum не расширять без firmware. |
| `service/payments/payments.py::link_sale` | Устанавливает `sale_id`, очищает `expires_at` | `PaymentService.linkSale()` | Только после idempotent sale и проверки device/epayId. |
| `get_next_expired_payment` | Выбирает `expires_at < now` | `PaymentExpiryService.findExpired()` | Не считать expired автоматически provider refund. |
| `expire_error` | Записывает `expired-{error}`, очищает expiration | `PaymentService.markExpired()` | Сохранить error code, не приписывать новую state machine ERP. |
| `set_refunded` | Ставит `is_refunded=true`, очищает expiration | `PaymentService.markRefunded()` | Только после подтверждённого refund. |
| `admin/.../merchant/wave.py::webhook` | HMAC, device lookup, общий payment request | `WavePaymentProvider.verifyWebhook()` + `parseWebhook()` + `PaymentWebhookService.handle()` | `POST /wave/webhook`; тип `merchant.payment_received`. |
| `admin/.../merchant/wave.py::search` | Проверяет state, `is_ready_to_sell`, `is_sales_possible` | `WavePaymentProvider.searchDevice()` + `MachineGateway.checkReady()` | Readiness, не payment status. |
| `shared/wave_sdk/validator.py` | HMAC от timestamp + raw body | `WaveWebhookSignatureVerifier.verify()` | Проверять до парсинга/пересборки body. |
| `service/merchant/wave.py::refund_money` | POST Wave `/v1/transactions/{payment_id}/refund`, ждёт 200 | `WavePaymentProvider.refund()` | Внешний refund существует только для Wave path. |
| `admin/.../merchant/orange.py::callback` | Authorization, только `SUCCESS`, partner.id → device | `OrangeMoneyPaymentProvider.verifyWebhook()` + `parseWebhook()` | `POST /orange/callback`; provider status polling не найден. |
| `shared/orange_sdk/dependencies.py` | Проверяет Authorization и configured token | `OrangeWebhookAuthGuard` | Не заменять на HMAC без решения по provider. |
| `service/merchant/orange.py::get_device_id_by_code` | Orange code → device ID | `OrangeMerchantMappingRepository.resolveDevice()` | Отдельная mapping dependency. |
| `service/merchant/orange.py::refund_money` | `pass`, HTTP-вызова нет | Orange provider без `refund()` / `UnsupportedRefund` | Не выставлять REFUNDED без внешнего подтверждения. |
| `device/topics/payments.py` | Принимает `cmd/{sn}/sell/v1/res`, подтверждает waiter | `MqttMachineGateway.handleSellResponse()` | Response не является фактом объёма. |
| `schema/payments.py::SellRequestEvent` | Envelope version/sn/time/eventId; data epayId/ttl/sum | `SellRequestDto` | Только найденные wire-поля. |
| `schema/payments.py::SellResponseEvent` | epayId/errCode/result/reason | `SellResponseDto` | Неизвестный error сохранять raw, не объявлять известным enum. |
| `service/payments/utils.py::epay_id_generator` | `{provider}-{payment_id}` | `PaymentCorrelation.epayId()` | Единый correlation для command/response/sale. |
| `device/topics/sale.py` | Sale event, idempotent sale, link payment | `MqttMachineGateway.handleSaleEvent()` + `DispenseService.recordSale()` | `litresML` — единственный найденный объём; dedupe по eventId. |
| `schema/device_events.py::SaleEventData` | price/litresML/sum/payMethod/optional epayId | `SaleEventDto` | Не добавлять user/session/button/volume. |
| `messaging/sales.py` | AMQP duplicate path; часть ошибок `requeue=false` | `SaleEventConsumer` (если AMQP сохранится) | Transport retry не заменяет бизнес-идемпотентность. |
| `device/topics/state.py` | Device state/readiness | `MqttMachineGateway.handleStateEvent()` + `MachineReadinessService` | Сохранить известные readiness fields; полный shadow неизвестен. |
| `shared/mqtt/controller.py` | JSON aliases, publish, optional TLS, QoS 0/retain false defaults | `MqttClientAdapter.publish()` | Production QoS/retain не считать согласованными. |
| `shared/mqtt/service.py` | Connect, subscribe, listener, reconnect через 2 секунды | `MqttMachineGateway.connect()/reconnect()` | Повторить subscriptions, но не command. |
| `shared/mqtt/router.py` | Topic decorators и dispatch | `MqttTopicRouter` | Проверять modem serial и валидировать DTO. |
| `workers/payment_refunder/refunder.py` | Poll expired, provider refund, event logs | `PaymentExpiryService` + `RefundOrchestrator` | MVP предпочитает wallet credit недовыдачи; provider refund — явный Wave compatibility path. |
| `service/webhook/sender.py`, `shared/webhook_sender/manager.py` | Исходящие configurable event-log webhooks | `OutboundWebhookPublisher` (опционально) | Не путать с inbound provider webhook. |
| `admin/.../devices/merchant.py` | Merchant activation, QR registration/retrieval | `MerchantConfigurationService` | Не payment create/status API. |

## Новые MVP-операции без ERP-аналога

| Операция | NestJS владелец | Почему не является ERP compatibility |
|---|---|---|
| Связать payment с user/wallet | `PaymentOwnershipService` / `WalletService` | В ERP нет user_id и wallet. |
| Зарезервировать/списать литры | `WalletLedgerService` | В ERP нет ledger и баланса. |
| Ожидать кнопку 60 секунд | `DispenseSessionService` | В ERP нет button topic/DTO. |
| `UNKNOWN/NO_CONNECT` | `DispenseSessionService` | В ERP нет business no-connect state. |
| Reconciliation после reconnect | `ReconciliationService` | В ERP нет history/query protocol. |
| Зачислить недовыдачу | `WalletLedgerService.creditShortfall()` | В ERP нет правила возврата литров. |

## Запреты на молчаливые расширения

1. Не добавлять `userId`, `sessionId`, `litres`, `button` или `volume` в существующий MQTT payload без подтверждения firmware.
2. Не считать `sell/v1/res success` доказательством фактически выданного объёма; найденный факт — `sale/v1.litresML`.
3. Не повторять `sell` после no-connect: ERP не показывает, принял ли автомат первую команду.
4. Не считать Orange refund выполненным только потому, что ERP worker не получил исключение.
5. Не использовать ERP `expires_at` как timeout кнопки: ERP TTL ожидания и 24-часовой refund срок — отдельные механизмы.

