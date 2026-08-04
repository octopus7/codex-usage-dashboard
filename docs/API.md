**English** | [한국어](API.KO.md) | [日本語](API.JA.md)

# API Guide

Example base URL:

```text
https://codex-usage-dashboard.<account>.workers.dev
```

## Authentication by Purpose

| Purpose | Authentication method |
|---|---|
| Public range query | None |
| External ingestion `POST /api/usage` | `INGEST_TOKEN` Bearer token |
| Administrator status, setup, login, and logout | Same-origin browser request |
| Administrator manual add and delete | HttpOnly administrator session cookie |

The administrator password is not preregistered as a Worker Secret. The initial setup API stores its password hash in D1.

## Weekly Usage RSS

```http
GET /rss.xml
```

Returns the latest 50 changes in weekly (`week`) usage as RSS 2.0 without authentication. Each item's `title` and `description` contain only a number such as `42.5`. If a consecutive record has the same value as the preceding record, it is omitted from the feed. `5h` data, source, note, and metadata are not included.

## Service Health

```http
GET /api/health
```

```json
{
  "ok": true,
  "service": "codex-usage-dashboard",
  "schema": "dual-series-password-auth-v1",
  "usageTypes": ["5h", "week"],
  "now": 1784340000
}
```

## Administrator Authentication API

### Check status

```http
GET /api/admin/status
```

Initial state:

```json
{
  "ok": true,
  "configured": false,
  "authenticated": false,
  "sessionExpiresAt": null,
  "passwordMinLength": 10
}
```

When logged in, both `configured` and `authenticated` are `true`.

### Set the initial password

This succeeds only once, while no administrator password exists.

```http
POST /api/admin/setup
Content-Type: application/json
Origin: https://current-dashboard-address
```

```json
{
  "password": "a password of at least 10 characters"
}
```

On success, the API stores the password hash and immediately issues an administrator session cookie. The original password is not stored in D1.

If a password is already configured, it returns `409 admin_already_configured`.

### Log in

```http
POST /api/admin/login
Content-Type: application/json
Origin: https://current-dashboard-address
```

```json
{
  "password": "the configured password"
}
```

On success, a `codex_admin_session` HttpOnly cookie is issued. The session is valid for 7 days.

After five failures within 15 minutes, the API returns `429 login_rate_limited` for 15 minutes.

### Log out

```http
POST /api/admin/logout
Cookie: codex_admin_session=...
Origin: https://current-dashboard-address
```

Deletes the session from D1 and expires the cookie.

## Range Query

```http
GET /api/usage?start=1784300400&end=1784386800&bucket=1200
```

| Query parameter | Description |
|---|---|
| `start` | Query start as a Unix timestamp in seconds, inclusive |
| `end` | Query end as a Unix timestamp in seconds, exclusive |
| `bucket` | Chart downsampling bucket size in seconds; `0` returns raw data |

Example response:

```json
{
  "ok": true,
  "usageTypes": ["5h", "week"],
  "range": {
    "start": 1784300400,
    "end": 1784386800,
    "bucket": 1200
  },
  "series": {
    "5h": [],
    "week": []
  },
  "baselines": {
    "5h": null,
    "week": null
  },
  "summaries": {
    "5h": {},
    "week": {}
  },
  "counts": {
    "5h": 0,
    "week": 0
  },
  "entries": [],
  "totalCount": 0,
  "entriesTruncated": false
}
```

- `series`: chart data by usage type
- `baselines`: last value of each type before `start`
- `entries`: raw data for the table, newest first, up to 300 rows
- `counts`: number of raw rows of each type within the range

For increasing or unchanged values, the frontend holds the previous value flat until the next measurement. A decrease in usage is treated as a reset and breaks the line.

## External Ingestion Authentication

```http
Authorization: Bearer <INGEST_TOKEN>
Content-Type: application/json
```

Register the token:

```bash
npx wrangler secret put INGEST_TOKEN
```

## Raspberry Pi Ingestion Endpoint

`POST /api/usagefrompi` uses the same input format and storage logic as `POST /api/usage`, but is a separate endpoint that works without ingestion-token authentication. It is disabled by default and enabled only in deployments where the GitHub Actions production environment variable `USAGEFROMPI_ENABLED` is set to `true`. It returns `404` while disabled.

```http
POST /api/usagefrompi
Content-Type: application/json
```

## Send One Record

```http
POST /api/usage
Authorization: Bearer <INGEST_TOKEN>
Content-Type: application/json
Idempotency-Key: 5h-20260718-120000
```

```json
{
  "usageType": "5h",
  "recordedAt": "2026-07-18T12:00:00+09:00",
  "usedPercent": 42.5,
  "source": "collector",
  "externalId": "5h-20260718-120000",
  "note": "optional value",
  "metadata": {
    "collectorVersion": "1.0.0"
  }
}
```

`usageType` is either `5h` or `week`.

Accepted `recordedAt` formats:

- Unix timestamp in seconds
- Unix timestamp in milliseconds
- ISO 8601 string

Send usage as a percentage:

```json
{
  "usedPercent": 42.5
}
```

Only `used_percent` is stored in D1. `usedPercent` must be between 0 and 100, inclusive. Limits, raw usage, input/output tokens, and costs are neither accepted nor stored.

The combination of `source + usageType + externalId` is unique. Sending the same combination again updates the existing row instead of creating a new one. If a single-record request has no `externalId`, the `Idempotency-Key` header can be used instead.

## Send Multiple Records

The maximum is 100 records.

```json
{
  "items": [
    {
      "usageType": "5h",
      "recordedAt": 1784340000,
      "usedPercent": 42.5,
      "source": "collector",
      "externalId": "5h-a"
    },
    {
      "usageType": "week",
      "recordedAt": 1784343900,
      "usedPercent": 68.2,
      "source": "collector",
      "externalId": "week-a"
    }
  ]
}
```

You may also send the array itself as the request body.

## Administrator Manual Add

```http
POST /api/usage/manual
Content-Type: application/json
Cookie: codex_admin_session=...
Origin: https://current-dashboard-address
```

The body has the same format as an external ingestion request. Without login, the response is `401 admin_login_required`.

## Delete

```http
DELETE /api/usage/123
Cookie: codex_admin_session=...
Origin: https://current-dashboard-address
```

Deletion cannot be undone. Without login, the response is `401 admin_login_required`.

## Test the Administrator Flow with curl

When testing with curl instead of a browser, use a cookie file and set `Origin` to the actual dashboard URL.

```bash
BASE_URL="https://codex-usage-dashboard.<account>.workers.dev"

curl -c admin-cookies.txt \
  -X POST "$BASE_URL/api/admin/login" \
  -H "Origin: $BASE_URL" \
  -H "Content-Type: application/json" \
  -d '{"password":"the configured password"}'
```

```bash
curl -b admin-cookies.txt \
  -H "Origin: $BASE_URL" \
  -X DELETE "$BASE_URL/api/usage/123"
```
