# Data Model: Water Wallet And Immutable Ledger

## Proposed Prisma Shape

This is the concrete planning target. Migration generation may adjust physical
constraint names, but not the documented invariants.

```prisma
enum WalletDirection {
  CREDIT
  DEBIT
}

model User {
  // existing fields
  waterWallet WaterWallet?
}

model WaterWallet {
  userId     String   @id @db.Uuid
  balanceMl  BigInt   @default(0)
  createdAt  DateTime @default(now()) @db.Timestamptz(3)
  updatedAt  DateTime @updatedAt @db.Timestamptz(3)

  user       User                @relation(fields: [userId], references: [id], onDelete: Restrict)
  entries    WalletLedgerEntry[]
}

model WalletLedgerEntry {
  id                  String          @id @default(uuid()) @db.Uuid
  sequence            BigInt          @unique @default(autoincrement())
  walletUserId        String          @db.Uuid
  businessEventKey    String          @unique @db.VarChar(200)
  direction           WalletDirection
  amountMl            BigInt
  operationKind       String          @db.VarChar(64)
  source              String          @db.VarChar(64)
  balanceAfterMl      BigInt
  occurredAt          DateTime        @db.Timestamptz(3)
  createdAt           DateTime        @default(now()) @db.Timestamptz(3)
  compensatesEntryId  String?         @db.Uuid

  wallet              WaterWallet     @relation(fields: [walletUserId], references: [userId], onDelete: Restrict)
  compensatesEntry    WalletLedgerEntry?  @relation("WalletCompensation", fields: [compensatesEntryId], references: [id], onDelete: Restrict)
  compensations       WalletLedgerEntry[] @relation("WalletCompensation")

  @@index([walletUserId, sequence(sort: Desc)])
  @@index([compensatesEntryId])
}
```

## Entity Invariants

### WaterWallet

- There is at most one physical wallet row per registered user because `userId`
  is both primary key and foreign key.
- Absence of the row means logical balance zero and empty history.
- Creation requires an existing `ACTIVE` owner locked for the command
  transaction; unknown or ineligible users receive no wallet or ledger row.
- `balanceMl` is an exact integer in
  `0..9_223_372_036_854_775_807`.
- A physical wallet is created only in a successful command transaction; a
  failed command may leave an empty zero row after rollback only if creation was
  in a different committed transaction, which the selected implementation does
  not do.
- `updatedAt` changes in the same conditional SQL statement as `balanceMl`.

### WalletLedgerEntry

- `id` is stable public identity. It is never reused and is safe to expose.
- `sequence` is unique append-order infrastructure used only for pagination. It
  may have gaps and is never public or included in reconciliation arithmetic.
- `businessEventKey` is private, global, immutable, and unique.
- `amountMl` is a positive magnitude. `direction` determines its sign.
- `balanceAfterMl` is non-negative and equals the projection returned by the
  same mutation statement. It helps audit the append path but does not replace
  signed-ledger reconciliation.
- `operationKind` and `source` contain stable public categories, not raw provider
  payloads or correlation metadata.
- `occurredAt` is the trusted business-effective time; `createdAt` is database
  record time. Public ordering uses `sequence`, not either timestamp alone.
- A compensation has `direction=CREDIT` and a non-null origin that resolves to a
  same-owner debit. A non-compensation kind must not carry an origin.
- No normal application path updates or deletes an entry.

## Migration-Only PostgreSQL Guarantees

Prisma cannot express all checks or the immutable trigger. The migration adds
named constraints equivalent to:

```sql
CHECK ("balanceMl" >= 0)
CHECK ("amountMl" > 0)
CHECK ("balanceAfterMl" >= 0)
CHECK (char_length("businessEventKey") BETWEEN 3 AND 200)
CHECK ("businessEventKey" ~ '^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9._~-]{1,167}$')
CHECK ("operationKind" ~ '^[A-Z][A-Z0-9_]{1,63}$')
CHECK ("source" ~ '^[A-Z][A-Z0-9_]{1,63}$')
CHECK (
  ("operationKind" = 'COMPENSATION' AND "direction" = 'CREDIT' AND "compensatesEntryId" IS NOT NULL)
  OR
  ("operationKind" <> 'COMPENSATION' AND "compensatesEntryId" IS NULL)
)
```

Application/domain validation mirrors these checks to produce stable errors.
The migration also creates a trigger function and a `BEFORE UPDATE OR DELETE`
trigger that raises a deterministic SQL exception on `WalletLedgerEntry`.

The self-reference cannot prove same-owner or debit-origin semantics with a
simple check constraint. The repository validates those facts inside the same
transaction. The original row is immutable, so the validated facts cannot later
change.

## Signed Reconciliation

For each owner:

```text
reconciledBalanceMl = SUM(
  CREDIT entry.amountMl,
  -DEBIT entry.amountMl
)
```

An empty sum is zero. Acceptance tests assert:

```text
WaterWallet.balanceMl = reconciledBalanceMl >= 0
latest committed entry.balanceAfterMl = WaterWallet.balanceMl
```

`balanceAfterMl` for historical entries is not recomputed when later operations
append. No user-facing endpoint exposes a repair operation. A future operational
repair must append an authorized compensating entry rather than edit history.

## Internal Command Data

Common immutable input:

| Field                | Type                | Rule                                                           |
| -------------------- | ------------------- | -------------------------------------------------------------- |
| `userId`             | UUID string         | Existing eligible user; never caller-selected over public HTTP |
| `businessEventKey`   | string              | Global namespaced key, max 200, stable across retry            |
| `amountMl`           | TypeScript `bigint` | `1..BIGINT_MAX`; never `number`                                |
| `operationKind`      | string              | Upper snake case, max 64, caller allowlisted                   |
| `source`             | string              | Upper snake case, max 64, caller allowlisted                   |
| `occurredAt`         | `Date`              | Valid trusted effective time                                   |
| `compensatesEntryId` | UUID string         | Required only for compensation                                 |

Idempotent equivalence compares all listed facts plus the implied direction.
An equivalent retry returns the original `id` and `balanceAfterMl`; it does not
append a row or change timestamps.

## Public Read Models

### Balance

| Field           | JSON type       | Notes                                              |
| --------------- | --------------- | -------------------------------------------------- |
| `balanceMl`     | string          | Canonical non-negative decimal integer             |
| `balanceLiters` | string          | Derived exact decimal with three fractional digits |
| `observedAt`    | RFC 3339 string | Server observation time                            |

### History entry

| Field           | JSON type           | Notes                          |
| --------------- | ------------------- | ------------------------------ |
| `id`            | UUID string         | Stable public identity         |
| `direction`     | `CREDIT` or `DEBIT` | Arithmetic direction           |
| `amountMl`      | string              | Exact positive decimal integer |
| `operationKind` | string              | Public category                |
| `source`        | string              | User-understandable category   |
| `occurredAt`    | RFC 3339 string     | Effective time                 |
| `recordedAt`    | RFC 3339 string     | Ledger append time             |

Owner, business key, sequence, resulting balance, compensation link, and Prisma
storage fields are intentionally absent.

## Cursor Model

The opaque cursor is base64url-encoded versioned JSON:

```json
{ "v": 1, "beforeSequence": "12345" }
```

The decoder accepts only the exact version/shape, a positive canonical decimal
sequence, and a bounded encoded length. The repository query is:

```text
WHERE walletUserId = authenticatedUserId
  AND sequence < beforeSequence (when present)
ORDER BY sequence DESC
TAKE limit + 1
```

The extra row determines `hasMore`; `nextCursor` contains the last returned
entry's sequence and is null when no further row exists.
