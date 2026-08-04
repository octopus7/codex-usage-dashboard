**English** | [한국어](README.KO.md) | [日本語](README.JA.md)

# Codex 5h · Week Usage Dashboard

A Codex usage dashboard built entirely with Cloudflare services.

The 5-hour and weekly usage values are stored in D1 as **independent time series**. They can be sent at different times and intervals, while the dashboard displays both lines on the same time axis.

- Increasing or unchanged values: hold the previous value flat until the next record
- Decreasing values: treat as a usage reset and break the line between the old and new points
- After the last record: extend the last value horizontally to the end of the selected range
- Y-axis: fixed at `0% · 25% · 50% · 75% · 100%` on both sides

Administrative features do not require a preconfigured `ADMIN_TOKEN`. On the first deployment with an empty D1 database, the password setup dialog opens automatically. Only a **PBKDF2-SHA-256 hash and salt of the password are stored in D1**; subsequent access uses administrator login and an HttpOnly session cookie.

## Architecture

```text
External collector
  ├─ POST /api/usage when 5h changes
  └─ POST /api/usage when week changes
              │ Bearer INGEST_TOKEN
              ▼
Cloudflare Worker API
              ▼
Cloudflare D1
  ├─ codex_usage
  ├─ admin_credentials
  ├─ admin_sessions
  └─ admin_login_attempts

Browser
  ├─ Workers Static Assets
  ├─ Public history and combined 5h/week chart
  └─ Manual add/delete after password login

RSS reader
  └─ GET /rss.xml → receive only actual changes to the week value
```

Services used:

- **Workers Static Assets**: HTML, CSS, and JavaScript
- **Cloudflare Worker**: query, ingestion, administrator authentication, add, and delete APIs
- **Cloudflare D1**: usage data, password hashes, and administrator sessions

## Features

- `POST /api/usage` for external ingestion
- `GET /rss.xml` dedicated to weekly usage changes
- Send `5h` and `week` independently at different times
- Time ranges: **1 hour, 6 hours, 12 hours, 1 day, 2 days, 1 week, 2 weeks, 4 weeks**
- Previous/next range navigation and mobile horizontal swipe
- Combined step-style chart for 5h and week
- Automatic line breaks across usage-reset intervals
- Percentage-only usage chart
- Show or hide each line from the legend
- Deduplication using `externalId` and `Idempotency-Key`
- Administrator password setup on first access
- HttpOnly and SameSite session cookies
- Manual add button, management column, and delete buttons are hidden from anonymous users
- Anonymous manual add/delete API requests are also rejected with `401`
- 15-minute lockout after five failed password logins

## Weekly Usage RSS

Add the following URL to your RSS reader:

```text
https://<dashboard-address>/rss.xml
```

The feed contains only the latest 50 changes to `week` usage. Each item's title and description contain only a number such as `42.5`; source, note, metadata, and `5h` usage are excluded. Consecutive records with the same value as the preceding record are omitted. A value that changes and later returns to an earlier value is included because it is an actual change.

## Project Structure

```text
.
├── public/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── src/
│   └── worker.js
├── migrations/
│   ├── 0001_initial.sql
│   ├── 0002_split_5h_week_series.sql
│   ├── 0003_admin_password_sessions.sql
│   └── 0004_percent_only_usage.sql
├── examples/
│   ├── send_usage.py
│   └── send_usage.sh
├── docs/
│   ├── API.md
│   ├── API.KO.md
│   └── API.JA.md
├── .dev.vars.example
├── package.json
├── wrangler.example.jsonc
└── wrangler.jsonc  # generated locally, excluded from Git
```

## Prerequisites

- A Cloudflare account
- Node.js 22 or later
- npm
- Permission to create Workers and D1 databases in the Cloudflare account

## Fresh Installation

### 1. Extract the archive and install packages

```bash
unzip codex-usage-dashboard-repository.zip
cd codex-usage-dashboard-repository

cp wrangler.example.jsonc wrangler.jsonc
npm install
```

### 2. Log in to Cloudflare

```bash
npx wrangler login
```

### 3. Create D1 and add the binding

```bash
npm run setup:db
```

This command creates D1 with the following settings and adds its binding to `wrangler.jsonc`:

```text
Database name: codex-usage-db
Worker binding: DB
Location hint: apac
```

After completion, `wrangler.jsonc` contains a configuration similar to this:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "codex-usage-db",
    "database_id": "..."
  }
]
```

### 4. Migrate the production D1 database

```bash
npm run db:migrate:remote
```

The following migrations are applied to a new database in order:

```text
0001_initial.sql
0002_split_5h_week_series.sql
0003_admin_password_sessions.sql
0004_percent_only_usage.sql
```

### 5. Deploy for the first time

```bash
npm run deploy
```

Save the `workers.dev` URL printed by the command.

### 6. Register the external ingestion token

Separate from the administrator login password, register a Worker Secret for external collectors to submit data:

```bash
openssl rand -hex 32
npx wrangler secret put INGEST_TOKEN
```

Keep the generated token only in the external collector. Do not put it in HTML or `public/app.js`.

**`ADMIN_TOKEN` is not used.**

### 7. Set the initial administrator password

Open the deployed dashboard URL.

1. If D1 does not contain an administrator password, the setup dialog opens automatically.
2. Enter a password of at least 10 characters twice.
3. Select **Save password**.
4. The password hash is stored in D1 and the current browser is logged in automatically.
5. Only after login do **Add usage**, the table's **Manage** column, and **Delete** buttons appear.

Important: initial password setup has no pre-shared administrator secret. On a new deployment, the first person to call the setup API can become the administrator, so **open the dashboard and configure it immediately after deployment**. You can also protect it temporarily with Cloudflare Access before making it public.

## Administrator Authentication Behavior

### Anonymous users

- Can view charts and usage history
- See the administrator login button
- Do not see the add-usage button
- Do not see the table's management column
- Delete buttons are not created in the DOM
- Direct calls to manual add/delete APIs return `401`

### Administrators

- Receive an HttpOnly session cookie after a successful password login
- Session lifetime is 7 days
- `SameSite=Strict`, with `Secure` applied on HTTPS deployments
- D1 stores a SHA-256 hash instead of the raw session token
- Logout deletes the session from D1 and removes the cookie

### Failed login limit

Five incorrect passwords from the same client within 15 minutes lock login for 15 minutes. A successful login clears the failure records.

## Unattended Raspberry Pi Ingestion Endpoint

`POST /api/usagefrompi` uses the same data format and storage logic as `POST /api/usage`, but accepts data without authentication. It is disabled by default and is enabled only in deployments where the GitHub Actions production environment variable `USAGEFROMPI_ENABLED` is set to `true`. It returns `404` while disabled.

```http
POST /api/usagefrompi
Content-Type: application/json
```

## Independent External Submissions

Environment variables:

```bash
export DASHBOARD_URL="https://codex-usage-dashboard.<account>.workers.dev"
export INGEST_TOKEN="<value configured as the Worker Secret>"
```

### Send only 5-hour usage

```bash
bash examples/send_usage.sh 5h 42.5
```

Example payload:

```json
{
  "usageType": "5h",
  "recordedAt": 1784340000,
  "usedPercent": 42.5,
  "source": "external-collector",
  "externalId": "5h-1784340000"
}
```

### Send weekly usage at another time

```bash
bash examples/send_usage.sh week 68.2
```

```json
{
  "usageType": "week",
  "recordedAt": 1784343900,
  "usedPercent": 68.2,
  "source": "external-collector",
  "externalId": "week-1784343900"
}
```

The submission times and intervals of these two requests are independent.

### Python example

```bash
python3 examples/send_usage.py 5h 42.5
python3 examples/send_usage.py week 68.2
```

### Direct curl request

```bash
curl --fail-with-body \
  -X POST "$DASHBOARD_URL/api/usage" \
  -H "Authorization: Bearer $INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 5h-001" \
  -d '{
    "usageType": "5h",
    "recordedAt": "2026-07-18T12:00:00+09:00",
    "usedPercent": 42.5,
    "source": "collector",
    "externalId": "5h-001"
  }'
```

See [`docs/API.md`](docs/API.md) for the complete API specification.

## Submission Data Format

Only the usage percentage is stored. `usedPercent` is required and must be between `0` and `100`, inclusive. Limit, raw usage, token, and cost fields are not stored in the database.

```json
{
  "usageType": "week",
  "recordedAt": "2026-07-18T12:00:00+09:00",
  "usedPercent": 61.3,
  "source": "collector",
  "externalId": "week-20260718-120000"
}
```

`usedAmount` and `limitAmount` are no longer accepted as API inputs. Collectors must calculate and send only `usedPercent`.

## Chart Behavior

Example:

```text
10:00  5h   32%
10:37  5h   38%
12:15  5h   47%
13:00  5h    4%  ← reset
14:00  5h   12%

10:15  week 55%
14:05  week 61%
```

Rendering principles:

```text
5h    32% ╱ 38% ╱ 47%       4% ╱ 12%
                         ↑ decreasing interval is not connected
week       55% ╱──────────────────── 61%
```

- A new value greater than or equal to the previous value is connected diagonally between the two record times.
- If a new value is lower than the previous value, it is considered a reset and no line is drawn between the points.
- A decrease in `usedPercent` indicates a reset.
- After the final record, its value is held horizontally to the end of the selected range.
- If a last value exists before the selected range, it is used as the baseline at the range start. If the first in-range value is lower, the points are not connected.
- When long ranges are reduced into buckets, the point immediately before a reset and the decreased point are both preserved so the break remains visible.

| Display range | Bucket per series |
|---|---:|
| 1 hour | 1 minute |
| 6 hours | 5 minutes |
| 12 hours | 10 minutes |
| 1 day | 20 minutes |
| 2 days | 30 minutes |
| 1 week | 2 hours |
| 2 weeks | 4 hours |
| 4 weeks | 8 hours |

## Upgrading from an Existing ZIP

If an earlier dual-series version is already deployed, back it up first:

```bash
npx wrangler d1 export DB \
  --remote \
  --output=codex-usage-before-password-auth.sql
```

Replace the project with the files from the new ZIP, then run:

```bash
npm install
npm run db:migrate:remote
npm run deploy
```

`0003_admin_password_sessions.sql` adds the administrator password and session tables. Existing usage data is unchanged.

After the upgrade, opening the page displays the initial password setup dialog. The previous version's `ADMIN_TOKEN` is not referenced by the new code.

## Local Development

```bash
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

Keep only the local testing `INGEST_TOKEN` in `.dev.vars`. Passwords and sessions in local D1 and production D1 are independent.

## If You Forget the Administrator Password

The original password cannot be recovered. Delete the administrator sessions and credentials from production D1, then configure a new password:

```bash
npx wrangler d1 execute DB \
  --remote \
  --command "DELETE FROM admin_sessions"

npx wrangler d1 execute DB \
  --remote \
  --command "DELETE FROM admin_credentials WHERE id = 1"
```

Reopen the page to display the initial password setup dialog again.

## Backup

```bash
npx wrangler d1 export DB \
  --remote \
  --output=codex-usage-backup.sql
```

## Security Recommendations

- Set the administrator password immediately after deployment.
- Use different values for the administrator password and `INGEST_TOKEN`.
- Do not put `INGEST_TOKEN` in static files or the Git repository.
- External collectors should use `externalId` or `Idempotency-Key`.
- Add Cloudflare Access if query results must also remain private.
- Deletion cannot be undone, so back up D1 regularly.
- Always log out after working on a shared computer.

## Common Commands

Fresh installation:

```bash
npm install
npx wrangler login
npm run setup:db
npm run db:migrate:remote
npm run deploy
npx wrangler secret put INGEST_TOKEN
```

Update:

```bash
npm install
npm run db:migrate:remote
npm run deploy
```

Check:

```bash
npm run check
```

## Official Documentation

- Workers Static Assets: https://developers.cloudflare.com/workers/static-assets/
- D1 getting started: https://developers.cloudflare.com/d1/get-started/
- D1 migrations: https://developers.cloudflare.com/d1/reference/migrations/
- Workers Secrets: https://developers.cloudflare.com/workers/configuration/secrets/

## Operating from a Git Repository

This distribution excludes `wrangler.jsonc` from Git. The file contains no secret values, but it does include the account-specific D1 `database_id`, so it remains local to prevent a new ZIP or another branch from overwriting production configuration.

Immediately after the first clone:

```bash
cp wrangler.example.jsonc wrangler.jsonc
npm install
```

To create a new D1 database:

```bash
npm run setup:db
npm run db:migrate:remote
npm run deploy
```

To connect an existing D1 database:

```bash
npx wrangler d1 list
nano wrangler.jsonc
```

Add this binding to the top-level object in `wrangler.jsonc`:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "codex-usage-db",
    "database_id": "UUID shown by wrangler d1 list"
  }
]
```

Verify the connection:

```bash
npx wrangler d1 execute DB \
  --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

Routine repository update:

```bash
git pull
npm install
npm run check
npm run db:migrate:remote
npm run deploy
```

Do not commit `wrangler.jsonc`, `.dev.vars`, `.env`, or `~/.config/codex-collector/env`. Store `INGEST_TOKEN` only as a Cloudflare Worker Secret and on the collector machine.

## Wrangler Login from Raspberry Pi / SSH

Run on the Raspberry Pi:

```bash
npx wrangler login
```

If the `localhost` callback page does not open after approval in a browser on another PC, copy the entire callback URL from the browser's address bar.

Example:

```text
http://localhost:8976/oauth/callback?code=...&state=...
```

Call it unchanged from a second SSH window on the Raspberry Pi:

```bash
curl 'http://localhost:8976/oauth/callback?code=...&state=...'
```

Verify login:

```bash
npx wrangler whoami
```

## Updating an Existing Deployment

After replacing only the code in an existing project or updating it through Git, preserve the production `wrangler.jsonc` and run:

```bash
npm install
npm run check
npm run db:migrate:remote
npm run deploy
```

`0004_percent_only_usage.sql` converts existing `used_amount`/`limit_amount` data to `used_percent`, then removes the unnecessary database columns.

Verify the deployment:

```bash
source ~/.config/codex-collector/env
curl -i "$DASHBOARD_URL/api/health"
```

The deployment is healthy if it returns `HTTP 200` and `"ok": true`. If the API returns 500, run:

```bash
npx wrangler tail
```

With that command running, call `/api/health` again from another terminal to inspect the actual exception.

## Chart Axes and Connection Rules

- The Y-axis always ranges from `0%` to `100%`, regardless of the data
- Auxiliary grid lines are at `25%`, `50%`, and `75%`
- The same labels appear on both the left and right sides of the chart
- When a value increases or remains unchanged, hold the previous value flat until the next measurement
- When the next measurement is lower, treat it as a reset and do not connect that interval
- Reset detection for `5h` and `week` is independent within each time series
