# Typed Machine Selection Handoff

## Purpose

This contract is application navigation state produced only after successful
selection revalidation. It is not an API credential, reservation, purchase,
wallet operation, dispense session, or authorization to command a machine.

```ts
export type MachineSelectionHandoff = Readonly<{
  machineId: string;
  machineRevision: string;
  price: Readonly<{
    amountPerLiter: string;
    currency: string;
  }>;
  availability: 'ONLINE';
  validatedAt: string;
}>;
```

## Producer Rules

- Produce the value only from HTTP `200` returned by
  `POST /v1/machines/{machineId}/selection-revalidation`.
- Require the server result to match the active session epoch, active card
  `machineId`, and current confirmation request generation.
- Accept only `availability: ONLINE` with a valid exact price/currency.
- Use `exhaustMap` plus a disabled/loading UI gate so repeated taps create one
  navigation handoff.
- Replace, never merge, an older selection context.

## Consumer Rules

- Treat every field as display/navigation context, not proof of current state.
- A future purchase flow must revalidate `machineId` and `machineRevision` before
  creating any value-affecting operation.
- Never infer an internal identifier, MQTT topic, machine command, or reservation
  from this object.
- Clear the object on logout, account replacement, session invalidation, or
  discovery workflow disposal.

## Obsolescence

`machineRevision` changes when selection-relevant catalog/evidence data changes.
`validatedAt` is informational and supports UX/diagnostics; it does not extend
backend freshness. A revision mismatch or expired backend availability must fail
closed during the next authoritative operation.
