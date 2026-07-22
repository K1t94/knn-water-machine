# Data Model: Project Bootstrap Foundation

This feature does not introduce MVP business entities. The following technical entities exist only to define safe startup and validation boundaries.

## Environment Contract

- `NODE_ENV`: `development`, `test`, or `production`; validated against the allowed set.
- `API_PORT`: local HTTP port; validated as an integer in the configured range.
- `DATABASE_URL`: local PostgreSQL connection string; required by the API runtime and never returned in responses/logs.
- `REDIS_URL`: local Redis connection string; required by the API runtime and never returned in responses/logs.
- `MQTT_URL`: local broker URL; required for connectivity checks and never returned in responses/logs.
- `MQTT_CLIENT_ID`: non-secret local client identifier; validated as non-empty.

Production credentials, provider keys, signing material, certificates, and webhook secrets are not part of this model.

## Service Dependency Status

- `name`: one of `postgres`, `redis`, `mqtt`.
- `status`: `up` or `down`.
- `latencyMs`: optional bounded integer for diagnostics.
- `errorCode`: optional stable non-secret diagnostic code.

The response may include dependency names and statuses only. It must not include URLs, usernames, passwords, raw driver errors, or environment values.

## Healthcheck Result

- `status`: `ok` when all required dependencies are available; `degraded` or `failed` otherwise.
- `service`: API service identifier.
- `version`: application version or build identifier safe for exposure.
- `dependencies`: allow-listed `Service Dependency Status` entries.

No user, session, payment, balance, machine-dispense, or referral records are created by this feature.
