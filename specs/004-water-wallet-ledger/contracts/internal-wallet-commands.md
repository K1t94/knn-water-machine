# Internal Wallet Command Contract

These contracts are trusted NestJS application APIs exported by `WalletModule`.
They are not HTTP routes and are not callable directly by the mobile app.

## Shared Types

```ts
type WalletOperationKind = string;
type WalletOperationSource = string;

interface WalletCommandBase {
    userId: string;
    businessEventKey: string;
    amountMl: bigint;
    operationKind: WalletOperationKind;
    source: WalletOperationSource;
    occurredAt: Date;
}

interface WalletCreditCommand extends WalletCommandBase {}
interface WalletDebitCommand extends WalletCommandBase {}

interface WalletCompensationCommand extends WalletCommandBase {
    operationKind: 'COMPENSATION';
    compensatesEntryId: string;
}

interface WalletCommandResult {
    entryId: string;
    balanceAfterMl: bigint;
    idempotentReplay: boolean;
}
```

`operationKind` and `source` are stable uppercase snake-case classifiers of at
most 64 characters. Each future caller defines a closed local vocabulary and
maps it into these strings. Provider payloads, money, price, currency, machine
commands, and arbitrary metadata are not accepted.

## Service API

```ts
interface WalletCommands {
    credit(input: WalletCreditCommand): Promise<WalletCommandResult>;
    debit(input: WalletDebitCommand): Promise<WalletCommandResult>;
    compensate(input: WalletCompensationCommand): Promise<WalletCommandResult>;
}
```

Each method is atomic. A fulfilled result means both the projection change and
one immutable ledger entry committed, or that an identical committed entry was
found for a retry. A rejected result means neither a new projection change nor a
new entry is visible.

## Retry Equivalence

An event is the same retry only when all of these equal the stored entry:

- user ID;
- business event key;
- implied direction;
- amount in millilitres;
- operation kind;
- source;
- effective timestamp;
- compensation origin, including both being absent.

The same key with any differing fact is a conflict. The original result remains
unchanged.

## Typed Outcomes

| Code                                 | Meaning                                                                                  | Retryable by same command                      |
| ------------------------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `WALLET_INVALID_AMOUNT`              | Amount is non-positive, out of `bigint` range, fractional, or supplied as an unsafe type | No                                             |
| `WALLET_INVALID_EVENT`               | Key, kind, source, timestamp, or owner syntax is invalid                                 | No                                             |
| `WALLET_USER_INELIGIBLE`             | User is absent or not eligible for wallet mutation                                       | No without state change                        |
| `WALLET_INSUFFICIENT_BALANCE`        | Debit predicate did not match current balance                                            | No without a new credit                        |
| `WALLET_BALANCE_LIMIT_EXCEEDED`      | Credit would overflow the supported range                                                | No                                             |
| `WALLET_EVENT_CONFLICT`              | Existing business key has different immutable facts                                      | No                                             |
| `WALLET_INVALID_COMPENSATION_ORIGIN` | Origin is absent, belongs to another user, or is not a debit                             | No                                             |
| `WALLET_TEMPORARILY_UNAVAILABLE`     | Transaction could not complete because storage is unavailable                            | Yes, with the identical business key and facts |

Infrastructure exceptions, SQLSTATE values, Prisma errors, constraint names,
and database records do not escape this boundary.

## Compensation Semantics In Feature 004

- Compensation is always a positive credit and always appends a new entry.
- The referenced origin must be a committed debit for the same user.
- The origin is never modified.
- Distinct compensation business keys may reference the same debit.
- This contract does not calculate under-delivery, impose a cumulative cap,
  decide expiry, or allocate source buckets. Future callers must define those
  policies before invoking the wallet.

## Caller Obligations

- Generate the business key from a stable durable business event before the
  first attempt and reuse it after timeouts.
- Never perform an external network call inside a wallet transaction.
- Validate caller-specific authorization and classifier allowlists before the
  command.
- Treat `idempotentReplay=true` as the original success, not as a new operation.
- Do not expose the business key or internal result fields through public DTOs.
