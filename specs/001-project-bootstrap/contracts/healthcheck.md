# Healthcheck Contract

## Endpoint

`GET /health`

## Response-Time Budget

- The endpoint MUST complete within 5 seconds when all dependencies are healthy.
- The endpoint MUST return its HTTP `503` failure response within 5 seconds when a required dependency is unavailable or unreachable.
- Dependency probes MUST use bounded timeouts and MUST NOT wait indefinitely on a network connection.

## Success

- HTTP `200`
- `status` is `ok`
- All required local dependencies are represented with `status: up`

Example shape:

```json
{
  "status": "ok",
  "service": "kaynann-api",
  "version": "<safe-build-id>",
  "dependencies": {
    "postgres": { "status": "up" },
    "redis": { "status": "up" },
    "mqtt": { "status": "up" }
  }
}
```

## Failure

- HTTP `503` when one or more required dependencies are unavailable.
- `status` is `degraded` or `failed`.
- Each unavailable dependency exposes only a stable `errorCode`, not a raw driver error or connection string.

## Security Rules

- Never return `DATABASE_URL`, `REDIS_URL`, `MQTT_URL`, credentials, tokens, private keys, stack traces, or raw connection errors.
- Keep the endpoint unauthenticated for local readiness checks, but expose no business or user data.
- Keep response fields explicitly shaped; do not serialize configuration or exception objects.
