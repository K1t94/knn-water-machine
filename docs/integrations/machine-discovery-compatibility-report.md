# Machine discovery compatibility report

## 1. Scope and provenance

Отчёт подготовлен для будущей feature `006-machine-discovery-and-selection` по
read-only reference repository:

- repository: `/Users/k1t94/Work/Projects/kaynann/erp-reference`;
- branch: `main`;
- commit: `5471a447c8f4454a4bdc8b4f53b5cf6e2afaee1e`;
- дата проверки: 2026-08-13.

Проверены только модели, migrations, HTTP-схемы и endpoints, device lookup,
MQTT/status processing, релевантные тесты, текущее MVP-ТЗ, NestJS backend,
React Native mobile и существующие integration artifacts. ERP migrations и
production-команды не запускались. Секреты и реальные персональные данные не
извлекались.

## 2. Executive summary

ERP можно использовать как источник концептуальной модели аппарата, location,
цены и технической готовности. Напрямую использовать его API в mobile нельзя:

- найденные `/v1/devices` и `/v1/locations` являются административными и
  защищены ERP JWT;
- device response раскрывает внутренние IDs, serials, платы, raw settings,
  raw state и последнюю продажу;
- в ERP нет consumer-safe machine discovery API, radius/nearest geo query,
  пагинации каталога или публичного status enum `online/service/offline`;
- в ERP не найден QR-контракт идентификации автомата. Найденные QR endpoints
  относятся к merchant QR платёжных провайдеров, а не к QR приложения;
- формат координат хранится как JSON-пара, но порядок координат и bounds не
  определены;
- ERP содержит два источника настроек (`settings` и `settings_current`) и не
  определяет, какой price показывать клиенту.

Следовательно, feature 006 должна вводить собственный consumer-safe контракт
NestJS и mobile flow. До `$speckit-specify` требуется согласовать QR/public ID,
источник и способ синхронизации каталога, status mapping/freshness, семантику
цены и порядок координат.

## 3. Фактическая модель ERP

### 3.1 Аппарат и идентификаторы

`DeviceModel` содержит:

- внутренний integer `id`, наследуемый от базовой модели;
- уникальный UUID;
- уникальный индексированный `device_sn`;
- nullable `last_activity_at` и nullable связь с location;
- отдельные configured settings, current reported settings и state.

Основание: [device.py](/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/model/device.py#L144),
[initial migration](/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/migration/versions/b1e9dc75f883_initial.py#L153).

Связь `location_id` не уникальна и nullable. Следовательно, модель допускает
несколько аппаратов в одной location и аппарат без location. Автомат без
location существует в каталоге администратора, но lookup не возвращает его как
успешный результат.

Ни integer ID, ни serial/modem serial нельзя автоматически считать публичным
mobile identifier. UUID технически подходит как стабильная основа, но ERP не
объявляет его QR/public contract.

### 3.2 Location и координаты

Location содержит уникальное `name`, country, city, district, address,
support number, трёхсимвольную currency, nullable cluster, description и
nullable `coords`, сохранённые в JSON: [location.py](/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/model/location.py#L16).

HTTP schema ограничивает координаты парой чисел, но не задаёт порядок
`latitude/longitude`, диапазоны или геодезическую систему:
[location schema](/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/schema/location.py#L28).

Фильтр location поддерживает текстовый поиск и facets по country/city/district,
currency, support number и cluster. Device filter ищет только по `device_sn` и
фильтрует по location. Distance, radius, bounding box и nearest ordering в этих
фильтрах отсутствуют: [location filter](/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/model/location.py#L48),
[device filter](/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/model/device.py#L210).

Изначально cluster был строкой. Поздняя migration создала нормализованную
таблицу, перенесла существующие значения и заменила строку FK:
[cluster migration](/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/migration/versions/10e5369386ca_clusters_support.py#L22).
Cluster может быть полезен для внутренней группировки, но MVP не требует его в
публичной карточке.

### 3.3 Цена и данные карточки

Configured и reported settings имеют nullable integer `price` и nullable
`is_sales_allowed`: [device settings model](/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/model/device.py#L22),
[device settings schema](/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/schema/device.py#L26).
Currency хранится на location, а не на аппарате.

ERP не фиксирует в модели:

- является ли `price` стоимостью одного литра;
- хранится ли цена в minor units;
- должен ли клиент использовать `settings.price` или
  `settings_current.price`;
- fallback при отсутствующей цене/currency;
- фото аппарата или набор доступных объёмов.

Sale event и sale response подтверждают наличие `price`, `litresML`, `sum` и
currency в продажах, но это исторические данные продажи, а не consumer catalog
contract: [device_events.py](/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/schema/device_events.py#L13),
[sales.py](/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/schema/sales.py#L34).

### 3.4 State и доступность

ERP state содержит nullable технические признаки, включая
`is_sales_possible`, `is_ready_to_sell`, `is_no_water` и свободный текст
`not_ready_to_sell_reason`: [device state model](/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/model/device.py#L102).
Новый аппарат может иметь state object со всеми такими полями `null`, что
зафиксировано тестами: [device service test](/Users/k1t94/Work/Projects/kaynann/erp-reference/tests/device/test_device_service.py#L61).

Единственное найденное прикладное правило допуска продажи в HTTP flow Wave:
state должен существовать, а `is_ready_to_sell` и `is_sales_possible` должны
быть truthy: [wave.py](/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/admin/v1/endpoints/merchant/wave.py#L163).
Этот путь не проверяет freshness `last_activity_at`/`state.updated_at` и
`settings.is_sales_allowed`, поэтому его нельзя без отдельного решения считать
полным status mapping для MVP.

Публичной state machine `online/service/offline`, нормативного freshness
threshold и исчерпывающего mapping `not_ready_to_sell_reason` в ERP не найдено.

## 4. HTTP contracts ERP

### 4.1 Devices

Router `/devices` целиком защищён `JWTUserBearer`:
[devices router](/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/admin/v1/endpoints/devices/__init__.py#L20).

`GET /v1/devices/` возвращает административный список. DTO включает internal
ID, UUID, serial, timestamps, location, IDs и данные плат, оба набора settings,
raw state и latest sale: [devices endpoint](/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/admin/v1/endpoints/devices/devices.py#L38),
[DeviceResponse](/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/schema/device.py#L101).
Это избыточно и небезопасно для прямой выдачи mobile.

`GET /v1/devices/lookup?query=...` также требует ERP JWT и возвращает только
internal `device_id` с nested location:
[lookup endpoint](/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/admin/v1/endpoints/devices/devices.py#L111),
[lookup response](/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/schema/device.py#L125).

Lookup работает как административный текстовый alias resolver:

- сначала ищет serial с учётом, затем без учёта регистра;
- затем выделяет конечный номер из нормализованной строки;
- fuzzy-сопоставляет текст с location;
- возвращает `404` при отсутствии результата/location или низком score;
- возвращает `409` при равных лучших кандидатах.

Основание: [lookup service](/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/service/device/device.py#L222),
[lookup tests](/Users/k1t94/Work/Projects/kaynann/erp-reference/tests/device/test_device_http.py#L40).
Это полезное reference-поведение для ручного кода/поиска, но не доказательство
QR-формата.

### 4.2 Locations

Router `/locations` также целиком защищён `JWTUserBearer`:
[locations.py](/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/admin/v1/endpoints/locations.py#L46).
`GET /v1/locations/` возвращает административный список с фильтрами, а
`/aggregated` обслуживает admin facets:
[aggregated route](/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/admin/v1/endpoints/locations.py#L101),
[location list route](/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/admin/v1/endpoints/locations.py#L144).
Consumer pagination, distance и privacy projection отсутствуют.

### 4.3 Доступ и ошибки

Тесты подтверждают отказ без ERP авторизации для списка и lookup (`403`) и
отказ при невалидном token (`401`):
[device HTTP tests](/Users/k1t94/Work/Projects/kaynann/erp-reference/tests/device/test_device_http.py#L16).

Нельзя передавать ERP admin credentials в приложение или проксировать этот DTO
без явного allowlist response shaping. Рекомендуемая граница: mobile обращается
только к NestJS API с пользовательской сессией; NestJS публикует минимальную
проекцию machine discovery.

## 5. QR identification

В ERP не найден QR payload, deep-link schema или endpoint, который связывает QR
приложения с device UUID/serial/ID.

Найденные QR routes генерируют и разбирают merchant QR Orange/Wave, привязанные
к платёжному провайдеру и административному device route:
[merchant QR endpoint](/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/admin/v1/endpoints/devices/merchant.py#L218),
[Orange QR tests](/Users/k1t94/Work/Projects/kaynann/erp-reference/tests/merchant/test_orange_http.py#L88),
[Wave QR tests](/Users/k1t94/Work/Projects/kaynann/erp-reference/tests/merchant/test_wave_http.py#L16).
Они не являются QR-кодом выбора автомата и не должны переиспользоваться для
feature 006.

## 6. MQTT/status integration

ERP принимает status и sales-ready shadow updates по modem serial с QoS 1:

- `$aws/things/{modem_sn}/shadow/name/status_v1/update`;
- `$aws/things/{modem_sn}/shadow/name/salesready_v1/update`.

Оба route используют общий update flow, обновляют state/board data и журналируют
неизвестный modem: [state topics](/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/device/topics/state.py#L39),
[topic declarations](/Users/k1t94/Work/Projects/kaynann/erp-reference/knn_erp/device/topics/state.py#L133).
Тесты подтверждают обновление `state.updated_at`, readiness и обработку
sales-ready=false: [state topic tests](/Users/k1t94/Work/Projects/kaynann/erp-reference/tests/device/test_state_topic.py#L64),
[sales-ready test](/Users/k1t94/Work/Projects/kaynann/erp-reference/tests/device/test_state_topic.py#L128).

Это влияет на freshness и доступность в discovery, но mobile не должен получать
MQTT state напрямую. Нормализованный status должен вычислять backend. Текущий
проектный MQTT contract уже фиксирует найденные topics и предупреждает, что
полный readiness DTO не подтверждён:
[machine-contract.md](/Users/k1t94/Work/Projects/kaynann/knn-water-machine/docs/integrations/machine-contract.md#L22),
[readiness section](/Users/k1t94/Work/Projects/kaynann/knn-water-machine/docs/integrations/machine-contract.md#L104).

## 7. Сопоставление с MVP-ТЗ

| Требование MVP | ERP reference | Gap для feature 006 |
|---|---|---|
| QR открывает нужный автомат | QR identity contract не найден | Определить public ID, payload/deep link, validation и ошибки |
| Карта и ближайшие аппараты | Есть nullable JSON coords | Нет порядка coords, bounds, geo index, radius и nearest query |
| Поиск по адресу/району | Есть admin text/facet filters | Нужен consumer-safe search и детерминированная сортировка |
| Карточка: адрес, distance, price, status | Поля существуют раздельно | Нужна единая проекция, расчёт distance и status mapping |
| Status `online/service/offline` | Есть raw nullable flags/timestamps | Нет enum, freshness threshold и mapping причин |
| Выбор аппарата | Есть admin ID/UUID/serial | Нужен стабильный публичный ID и handoff contract |
| Работа при отказе геолокации | ERP не определяет mobile UX | Mobile должен оставить ручную карту/поиск/выбор |
| Публичность данных | Только ERP-admin JWT routes | Нужен NestJS endpoint с auth policy и allowlist fields |

Требования основания:
[MVP screens](/Users/k1t94/Work/Projects/kaynann/knn-water-machine/docs/mvp-requirements.md#L31),
[MVP architecture](/Users/k1t94/Work/Projects/kaynann/knn-water-machine/docs/mvp-requirements.md#L99),
[MVP acceptance](/Users/k1t94/Work/Projects/kaynann/knn-water-machine/docs/mvp-requirements.md#L135).

Визуально проверены mockups
[machine selection](/Users/k1t94/Work/Projects/kaynann/knn-water-machine/docs/design/mockups/03_machine_selection_hd.png),
[machine purchase](/Users/k1t94/Work/Projects/kaynann/knn-water-machine/docs/design/mockups/04_machine_purchase_hd.png) и
[QR scanner](/Users/k1t94/Work/Projects/kaynann/knn-water-machine/docs/design/mockups/10_qr_scanner_hd.png).
Они подтверждают визуальное направление карты, nearby list, карточки и scanner,
но Ghana/USD, иллюстративные цены, фильтры и purchase controls не являются
business requirements.

## 8. Текущее состояние нового проекта

NestJS сейчас подключает auth, app config, security, health, Redis,
observability, Prisma, referral, SMS и wallet. Machine/location module ещё не
подключён: [app.module.ts](/Users/k1t94/Work/Projects/kaynann/knn-water-machine/apps/api/src/app.module.ts#L4).
В текущей Prisma schema нет Machine/Device/Location read model.

Mobile main navigation содержит только Wallet и условный Referral:
[MainNavigator.tsx](/Users/k1t94/Work/Projects/kaynann/knn-water-machine/apps/mobile/src/navigation/MainNavigator.tsx#L13).
В package dependencies отсутствуют camera, location и map adapters:
[mobile package.json](/Users/k1t94/Work/Projects/kaynann/knn-water-machine/apps/mobile/package.json#L20).

Существующие specs заканчиваются feature 005 и не определяют feature 006.
Имеющиеся [ERP analysis](/Users/k1t94/Work/Projects/kaynann/knn-water-machine/docs/integrations/erp-analysis.md)
и [machine contract](/Users/k1t94/Work/Projects/kaynann/knn-water-machine/docs/integrations/machine-contract.md)
ориентированы на payment/MQTT dispense, а не на consumer discovery.

## 9. Что можно переиспользовать концептуально

- ERP UUID как кандидат для внутреннего correlation key, но не автоматически
  как публичный QR ID.
- Device-to-location relation и location address/city/district/currency.
- Coordinates после подтверждения порядка и очистки данных.
- Configured/reported price после выбора authoritative source и единиц.
- `last_activity_at`, `state.updated_at`, `is_sales_allowed`,
  `is_sales_possible`, `is_ready_to_sell`, `is_no_water` как inputs для
  backend status projection.
- ERP text lookup semantics как источник идей для ручного поиска, без
  буквального переноса fuzzy Python-кода.
- MQTT topics как источник актуализации read model, если этот integration path
  будет выбран при планировании.

Нельзя переиспользовать напрямую admin DTO, integer IDs, serial/modem serial,
board metadata, merchant QR, latest sale или ERP JWT в mobile contract.

## 10. Рекомендуемые границы feature 006

### In scope

- server-authoritative consumer machine catalog/read model;
- privacy-safe authenticated list/nearby/search, detail и QR/manual-code
  resolution contracts;
- стабильный opaque public machine identifier;
- address, coordinates, distance, normalized price/currency и derived status;
- deterministic map/list ordering and pagination;
- QR scanner и manual-code fallback;
- geolocation permission states, включая ручной просмотр/поиск при отказе;
- machine selection и typed handoff к будущему purchase flow;
- handling invalid/unknown QR, missing/invalid catalog data, unavailable
  machine, stale response and session replacement;
- unit/integration/contract/mobile tests для discovery и selection.

### Out of scope

- ERP admin CRUD и перенос ERP UI;
- merchant QR Orange/Wave;
- покупка пакетов, выбор объёма, wallet debit и dispense session;
- отправка MQTT sell command и firmware changes;
- управление merchant accounts;
- route navigation до аппарата, favorites, advanced filters и offline map cache,
  если они отдельно не добавлены в requirements;
- показ board serials, raw state, support diagnostics и sales history.

Карточка автомата в 006 должна завершаться выбором/handoff. Форма объёма и
старт выдачи принадлежат следующей purchase/dispense feature, даже если они
показаны на соседнем mockup.

## 11. Рекомендуемый целевой boundary

Mobile не должен обращаться к ERP. Рекомендуемый поток:

1. ERP или machine integration остаётся upstream источником operational data.
2. NestJS хранит/получает consumer machine read model и нормализует status.
3. NestJS выдаёт только allowlisted поля через app-session protected API.
4. Mobile MobX store владеет catalog, selected machine, permissions и UI state.
5. RxJS orchestration отменяет stale search/nearby/QR requests при новом запросе,
   logout или замене сессии.

Способ наполнения read model нельзя окончательно выбрать по ERP-коду: прямой
database access создаст сильную связь, а admin HTTP API не является consumer
contract. Нужен согласованный integration mechanism до planning.

## 12. Неоднозначности и edge cases

- QR может содержать неизвестный, malformed, удалённый или дублирующий alias.
- ERP lookup допускает ambiguous match (`409`), но QR resolution должен быть
  точным и не использовать fuzzy matching.
- Аппарат может не иметь location, coordinates, price, currency или свежего
  state.
- Несколько аппаратов могут относиться к одной location.
- `settings` и `settings_current` могут расходиться.
- State может быть формально ready, но устаревшим; activity и state timestamps
  также могут расходиться.
- Аппарат может стать unavailable между list response, QR resolve и selection.
- Два аппарата могут иметь одинаковую distance; нужен стабильный tie-breaker.
- Разрешение геолокации может быть denied, restricted или отозвано во время
  сессии.
- Search/nearby ответы могут приходить не по порядку; stale response не должен
  заменить более новый результат.
- Невалидные ERP coords не должны ломать весь catalog response.
- Distance должен вычисляться на backend или одинаково округляться по явно
  заданному правилу, иначе map/list могут расходиться.

## 13. Решения до `$speckit-specify`

Ниже вопросы в порядке блокирующего влияния. В скобках указан рекомендуемый
default, если заказчик подтверждает его.

1. **Какой QR уже физически размещён на аппаратах?** Нужны 2-3 обезличенных
   примера payload. Если QR ещё нет: использовать versioned deep link с opaque
   public machine ID, не integer ID и не serial/modem serial.
2. **Кто authoritative owner каталога и как NestJS получает изменения?**
   Рекомендация: ERP остаётся master, NestJS поддерживает consumer read model
   через отдельный authenticated integration contract/import; mobile никогда
   не получает ERP credentials.
3. **Как определить `online/service/offline`?** Рекомендация: `online` только
   при свежем state и всех разрешающих sales/readiness flags; `offline` при
   отсутствующем или просроченном heartbeat/state; `service` при свежей связи,
   но запрещённой продаже/неготовности. Нужно утвердить freshness threshold и
   mapping причин.
4. **Что именно означает ERP `price`?** Нужно подтвердить единицу, minor/major
   units, цену за литр, источник `settings` против `settings_current` и fallback.
5. **Каков порядок `coords` в фактических данных ERP?** Подтвердить
   `[longitude, latitude]` или `[latitude, longitude]`, а также допустимые bounds.
6. **Каталог доступен только зарегистрированному пользователю?** Рекомендация:
   да, все discovery endpoints требуют текущую app session; QR до auth может
   сохранить только безопасный navigation intent, но не machine data.
7. **Как показывать аппарат без coordinates/location/price?** Рекомендация:
   без location исключать из consumer catalog; без coordinates исключать с
   карты, но оставлять в текстовом списке при валидном адресе; без цены помечать
   unavailable и запрещать selection.
8. **Одна карточка соответствует аппарату или location?** ERP допускает несколько
   устройств на location. Рекомендация: одна карточка на physical device с общим
   адресом location.
9. **Параметры nearby/search:** согласовать default radius, maximum radius,
   page size, distance rounding и поведение без геолокации. Рекомендация:
   cursor pagination, sort distance ascending с public ID tie-breaker; без
   координат пользователя текстовый search и стабильная сортировка по location.
10. **Какой map provider и политика ключей/стоимости?** Это влияет на mobile
    dependencies и platform configuration, но не должно менять domain contract.

После ответов на вопросы 1-5 можно составить точный `$speckit-specify` prompt.
Остальные решения допустимо либо подтвердить сейчас, либо явно закрепить
рекомендуемыми defaults в спецификации.
