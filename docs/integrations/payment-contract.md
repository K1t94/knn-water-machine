# Payment integration contract

Статус: проектный контракт, без реализации. Источник ERP-совместимости — `docs/integrations/erp-analysis.md` и read-only исходники Python ERP.

## Границы

Контракт сохраняет wire-поведение ERP: Wave и Orange Money присылают уведомление, NestJS проверяет его, создаёт внутреннюю запись платежа и передаёт команду `sell` через `MachineGateway`. Пользовательский баланс, кошелёк и начисление литров отсутствуют в ERP-платеже и являются отдельным доменным слоем нового приложения.

## Провайдеры

```ts
interface PaymentProvider {
  readonly name: 'wave' | 'orange';
  verifyWebhook(input: VerifyWebhookInput): Promise<VerifiedWebhook>;
  parseWebhook(input: unknown): ParsedProviderPayment;
  refund?(payment: PaymentRecord): Promise<RefundResult>;
}

interface WavePaymentProvider extends PaymentProvider {
  readonly name: 'wave';
  searchDevice(input: unknown): Promise<WaveSearchResult>;
  refund(payment: PaymentRecord): Promise<RefundResult>;
}

interface OrangeMoneyPaymentProvider extends PaymentProvider {
  readonly name: 'orange';
  // ERP has no external Orange refund operation.
}
```

Provider не меняет баланс и не реализует выдачу. Это границы адаптеров, а не указание немедленно создавать классы.

## ERP-совместимая модель

| Поле | Источник/правило |
|---|---|
| `provider` | `wave` или `orange`. |
| `paymentId` | Внешний ID; ERP уникализирует пару `(provider, paymentId)`. |
| `amount`, `currency` | Поля callback; ERP передаёт сумму как целое MQTT `sum`. |
| `deviceId` | Wave `custom_fields.device_number` или Orange mapping. |
| `eventId` | UUID корреляции команды `sell`. |
| `result` | ERP-значения `success` или `failure`. |
| `errorCode` | В частности `no_ready_to_sell`, `ttl_is_expired`, `duplicate`, `timeout`. |
| `saleId` | Ссылка на sale после `dt/{sn}/sale/v1`. |
| `expiresAt` | Срок для expired/refund worker; при `sale_timeout` ERP фактически прибавляет 24 часа. |
| `isRefunded` | ERP boolean-флаг. |
| `extra` | Provider payload для refund worker; secrets в него не включаются. |

`userId`, `walletTransactionId`, `idempotencyKey` и package/litre fields отсутствуют в ERP. Если они нужны MVP, это новые связи NestJS, не compatibility DTO.

## Создание платежа

ERP не имеет отдельного публичного create endpoint. `PaymentService.acceptProviderPayment()` вызывается после webhook:

1. определить provider и проверить его подпись;
2. распарсить provider payment ID, amount, currency и device ID;
3. атомарно найти или создать запись по `(provider, paymentId)`;
4. для нового платежа создать `eventId` и `epayId = {provider}-{paymentId}`;
5. передать `sell` в `MachineGateway` и сохранить response.

Повтор callback не создаёт запись и не публикует второй `sell`. Конфликт суммы, валюты или автомата отклоняется без нового запуска.

## Webhook adapters

### Wave

- Endpoint: `POST /wave/webhook`.
- Тип: `merchant.payment_received`.
- Проверка: HMAC-SHA256 по `timestamp + raw_body`.
- Device: `data.custom_fields.device_number`.
- Payment ID: `id`; amount/currency: `data.amount`/`data.currency`.
- `POST /wave/search` — отдельная readiness-проверка `is_ready_to_sell` и `is_sales_possible`, не payment status.

### Orange Money

- Endpoint: `POST /orange/callback`.
- Проверка: Authorization с configured `ORANGE_SIGNATURE`.
- Принимается только `status == SUCCESS`.
- Device: `partner.id` через Orange merchant mapping.
- Payment ID: `transactionId`; amount/currency: `amount.value`/`amount.unit`.

## Статус и состояния

Provider status polling и отдельный `GET payment status` в ERP не найдены. `PaymentService.getStatus()` возвращает внутреннюю запись и сохраняет исходные `result/errorCode`.

| NestJS state | ERP-основание | Комментарий |
|---|---|---|
| `PENDING` | Запись создана, response не завершён | Новое явное состояние. |
| `SUCCEEDED` | `result=success` | Не означает фактический объём. |
| `FAILED` | `result=failure` | Причина в `errorCode`. |
| `UNKNOWN` | Потеря связи/неопределённость | Новое MVP-состояние; без повторной оплаты/выдачи. |
| `CANCELLED` | Эквивалента нет | Только orchestration отмена session, не provider refund. |
| `REFUNDED` | `isRefunded=true` | Для ERP гарантирован только Wave path. |

## Refund

ERP worker обрабатывает expired payment. Wave вызывает `POST https://api.wave.com/v1/transactions/{payment_id}/refund` и ожидает HTTP 200. Orange `refund_money` — `pass`: вызова нет, но worker ошибочно может поставить `is_refunded=true`.

В NestJS `refund()` опционален и не должен считать Orange refund успешным без подтверждённого API. MVP возвращает недовыданный объём на внутренний баланс, а не деньги на Wave/Orange; это wallet-операция.

## Идемпотентность и безопасность

- Базовый ключ ERP: `(provider, paymentId)`.
- MQTT correlation: `eventId`; machine payment correlation: `epayId`.
- Sale дедуплицируется по event ID, затем payment связывается по `epayId` и `deviceId`.
- Webhook сначала аутентифицируется, затем обрабатывается транзакционно.
- Повторный валидный webhook возвращает тот же результат и не публикует повторный `sell`.
- Raw payload не выдаётся наружу; `extra` не содержит authorization/signature/secrets.

