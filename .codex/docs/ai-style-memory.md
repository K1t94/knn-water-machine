# AI Style Memory

This file stores confirmed coding and communication preferences for this
repository.

Update this file only when the user explicitly says:
`promote this to style`

## Confirmed Preferences

### Architecture

- Prefer existing local patterns before adding new abstractions.
- Keep each diff focused on one logical change.
- Keep public request and response contracts explicit.
- Prefer an Observable-first reactive architecture in frontend code. API and
  storage adapters expose cold RxJS `Observable` contracts; keep Promises to a
  minimum and confine unavoidable native Promise APIs such as `fetch` and
  SecureStore to infrastructure boundaries through `defer`/`from`.
- Compose asynchronous frontend workflows with RxJS operators and cancellation
  through subscription teardown rather than converting Observable flows back
  into Promise-based application services.

### Validation

- Run the smallest relevant validation command after each diff.
- State when a useful validation command is missing.

### Communication

- Be concise by default.
- Expand only when asked.
- Call out assumptions before implementation.

## Pending Observations

Use this section for temporary style observations. Move an item to confirmed
preferences only after the user says `promote this to style`.

- 
