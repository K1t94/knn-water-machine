# Machine integration contract

Статус: проектный контракт, без реализации. Wire-поля и topics ниже взяты из ERP analysis; отсутствующие в ERP поля не объявляются согласованным протоколом.

## Архитектура

```ts
interface MachineGateway {
  checkReady(machineId: string): Promise<MachineReadiness>;
  requestDispense(command: DispenseCommand): Promise<DispenseCommandResult>;
  onEvent(handler: (event: MachineEvent) => Promise<void>): void;
  reconcile(machineId: string, sessionId?: string): Promise<ReconciliationResult>;
}

class MqttMachineGateway implements MachineGateway {
  // MQTT transport, routing, serialization and reconnect only.
}
```

Gateway не знает о пользователе, балансе или provider. Он переводит команду в ERP-совместимый `sell/v1/req` и сообщает доменному слою response, sale и readiness.

## Topics

| Направление | Topic | Основание |
|---|---|---|
| NestJS → machine | `cmd/{modem_sn}/sell/v1/req` | Команда `sell`, найдено в ERP. |
| machine → NestJS | `cmd/{modem_sn}/sell/v1/res` | Ответ команды, найдено в ERP. |
| machine → NestJS | `dt/{modem_sn}/sale/v1` | Факт продажи/выдачи, найдено в ERP. |
| machine → NestJS | `$aws/things/{modem_sn}/shadow/name/status_v1/update` | Device state. |
| machine → NestJS | `$aws/things/{modem_sn}/shadow/name/salesready_v1/update` | Readiness. |
| machine → NestJS | `$aws/things/{modem_sn}/shadow/name/settings_v1/update` | Settings. |
| machine → NestJS | `dt/{modem_sn}/encash/v1`, `dt/{modem_sn}/logs_v1/v1`, `dt/{modem_sn}/logs/v1`, `dt/{modem_sn}/telemetry/v1` | Topics найдены, дополнительные поля не расширяем. |
| NestJS → machine | `cmd/{modem_sn}/get_time/v1/req` | Найдено в ERP. |

ERP использует broker `local-mqtt`; TLS listener 8883, client default port 1883, keepalive 10, timeout 20, QoS 0 и retain false. Production QoS/retain для отдельных topics не подтверждены.

## Команда

```ts
type DispenseCommand = {
  eventId: string;       // ERP event_id, UUID
  modemSn: string;       // topic address
  epayId: string;        // `${provider}-${providerPaymentId}`
  ttl: number;           // Unix timestamp, не duration
  sum: number;           // целое значение ERP
};
```

```json
{
  "version": "v1",
  "sn": "MODEM_SERIAL",
  "time": "ISO_TIMESTAMP",
  "eventId": "EVENT_UUID",
  "data": {
    "epayId": "wave-PROVIDER_PAYMENT_ID",
    "ttl": 1721822460,
    "sum": 1250
  }
}
```

Не добавлять в wire payload `userId`, `sessionId`, `litres`, `button` или `volume`: таких полей в ERP нет.

## События и DTO

### Response

```ts
type SellResponseEvent = {
  version: 'v1';
  sn: string;
  time: string;
  eventId: string;
  data: {
    epayId: string;
    result: 'success' | 'failure';
    errCode: '' | 'no_ready_to_sell' | 'ttl_is_expired' | 'duplicate';
    reason: string;
  };
};
```

### Sale / фактически выданный объём

```ts
type SaleEvent = {
  version: 'v1';
  sn: string;
  time: string;
  eventId: string;
  data: {
    price: number;
    litresML: number;
    sum: number;
    payMethod: 'cash' | 'epay' | 'b2b';
    epayId?: string | null;
  };
};
```

`litresML` — единственное найденное поле фактически выданного объёма. `epayId` может отсутствовать для cash/b2b. Sale дедуплицируется по `eventId`; payment ищется с ограничением по тому же автомату.

### Readiness

Из ERP известны только `is_ready_to_sell`, `is_sales_possible`, `is_no_water`, `not_ready_to_sell_reason`. Полный shadow DTO не найден и здесь не расширяется.

## Физическая кнопка и DispenseSession

В ERP не найден topic, DTO или command физической кнопки. В MVP сессия ожидает кнопку не более 1 минуты:

1. NestJS создаёт `DispenseSession` и отправляет только совместимую команду `sell`.
2. Gateway не выдумывает button topic; его можно добавить после подтверждения firmware-контракта.
3. Через 60 секунд без подтверждённого старта session становится `EXPIRED`; `sell` не повторяется.
4. Уже пришедший sale event не отменяется timeout-ом; используется `eventId`/`epayId`.

Состояния ниже принадлежат orchestration-слою NestJS, не MQTT:

| `DispenseSession` | Смысл |
|---|---|
| `CREATED` | Сессия создана, команда не отправлена. |
| `WAITING_BUTTON` | Команда отправлена; окно кнопки — 60 секунд. |
| `DISPENSING` | Есть подтверждённый признак обработки выдачи; wire-признак пока неизвестен. |
| `COMPLETED` | Принят sale event. |
| `EXPIRED` | Кнопка/старт не подтверждены за минуту. |
| `FAILED` | Machine response сообщил failure. |
| `UNKNOWN` | Связь потеряна или результат неопределён. |
| `RECONCILING` | Идёт проверка после reconnect. |

Только `COMPLETED` завершает сессию фактом `litresML`. Расчёт и начисление недовыдачи — новый wallet-домен, не MQTT операция.

## No-connect и reconciliation

`MqttMachineGateway` должен:

- reconnect с повторной подпиской на известные topics;
- не повторять `sell` автоматически: ERP не доказывает, была ли первая команда принята;
- переводить затронутую session в `UNKNOWN`;
- сохранять `eventId`, `epayId` и время отправки;
- после reconnect запускать `reconcile(machineId, sessionId)`.

ERP не содержит query topic или reconciliation API. Поэтому безопасная стратегия ограничена повторным приёмом `sell/v1/res`, `sale/v1` и state-событий:

1. переподписаться;
2. принять поздний response или sale;
3. дедуплицировать по `eventId`, связать sale по `epayId`;
4. при отсутствии подтверждения оставить `UNKNOWN` и передать решение application/review слою, не запускать повторную выдачу.

Это не полный reconciliation: способ запросить историю автомата после blackout в ERP не найден и требует согласования с firmware.

