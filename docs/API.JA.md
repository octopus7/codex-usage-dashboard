[English](API.md) | [한국어](API.KO.md) | **日本語**

# API 使用方法

ベース URL の例：

```text
https://codex-usage-dashboard.<アカウント>.workers.dev
```

## 用途別の認証

| 用途 | 認証方法 |
|---|---|
| 公開期間照会 | 認証なし |
| 外部収集 `POST /api/usage` | `INGEST_TOKEN` Bearer トークン |
| 管理者の状態・設定・ログイン・ログアウト | 同一オリジンのブラウザーリクエスト |
| 管理者による手動追加・削除 | HttpOnly 管理者セッションクッキー |

管理者パスワードを Worker Secret として事前登録する必要はありません。初期設定 API がパスワードハッシュを D1 に保存します。

## 週間使用量 RSS

```http
GET /rss.xml
```

認証なしで週間（`week`）使用量の最新変更50件を RSS 2.0 として返します。各項目の `title` と `description` には `42.5` のような数値だけが含まれます。連続する記録が直前の記録と同じ値の場合はフィードから省略され、`5h` データ、送信元、メモ、メタデータは含まれません。

## サービス状態

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

## 管理者認証 API

### 状態の確認

```http
GET /api/admin/status
```

初期状態：

```json
{
  "ok": true,
  "configured": false,
  "authenticated": false,
  "sessionExpiresAt": null,
  "passwordMinLength": 10
}
```

ログイン状態では `configured` と `authenticated` がどちらも `true` になります。

### 初期パスワードの設定

管理者パスワードがまだ存在しない場合に、一度だけ成功します。

```http
POST /api/admin/setup
Content-Type: application/json
Origin: https://現在のダッシュボードアドレス
```

```json
{
  "password": "10文字以上のパスワード"
}
```

成功するとパスワードハッシュを保存し、すぐに管理者セッションクッキーを発行します。パスワードの元の文字列は D1 に保存されません。

すでに設定されている場合は `409 admin_already_configured` を返します。

### ログイン

```http
POST /api/admin/login
Content-Type: application/json
Origin: https://現在のダッシュボードアドレス
```

```json
{
  "password": "設定したパスワード"
}
```

成功すると `codex_admin_session` HttpOnly クッキーが発行されます。セッションは7日間有効です。

15分以内に5回失敗すると、15分間 `429 login_rate_limited` レスポンスを返します。

### ログアウト

```http
POST /api/admin/logout
Cookie: codex_admin_session=...
Origin: https://現在のダッシュボードアドレス
```

該当セッションを D1 から削除し、クッキーを期限切れにします。

## 期間照会

```http
GET /api/usage?start=1784300400&end=1784386800&bucket=1200
```

| クエリ | 説明 |
|---|---|
| `start` | 照会開始の Unix タイムスタンプ（秒）、範囲に含む |
| `end` | 照会終了の Unix タイムスタンプ（秒）、範囲に含まない |
| `bucket` | チャートのダウンサンプリング用バケットサイズ（秒）。`0` の場合は元データ |

レスポンス例：

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

- `series`：種類別のチャートデータ
- `baselines`：`start` より前にある種類別の最後の値
- `entries`：表に表示する元データ。新しい順で最大300件
- `counts`：期間内にある種類別の元データ行数

フロントエンドは増加・同一の値について、次の測定値まで前の値を水平に維持します。使用率が減少した地点はリセットと判断し、線を分断します。

## 外部収集の認証

```http
Authorization: Bearer <INGEST_TOKEN>
Content-Type: application/json
```

トークンの登録：

```bash
npx wrangler secret put INGEST_TOKEN
```

## Raspberry Pi 収集エンドポイント

`POST /api/usagefrompi` は `POST /api/usage` と同じ入力形式と保存処理を使用しますが、収集トークンの認証なしで動作する別のエンドポイントです。デフォルトでは無効で、GitHub Actions の production environment variable `USAGEFROMPI_ENABLED` を `true` に設定したデプロイでのみ有効になります。無効な状態では `404` を返します。

```http
POST /api/usagefrompi
Content-Type: application/json
```

## 1件のデータを送信

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
  "note": "任意の値",
  "metadata": {
    "collectorVersion": "1.0.0"
  }
}
```

`usageType` は `5h` または `week` です。

`recordedAt` の形式：

- Unix タイムスタンプ（秒）
- Unix タイムスタンプ（ミリ秒）
- ISO 8601 文字列

使用量はパーセントで送信します。

```json
{
  "usedPercent": 42.5
}
```

D1 には `used_percent` だけが保存されます。`usedPercent` は0以上100以下のみ許可されます。上限、元の使用量、入出力トークン、費用は入力として受け付けず、保存もしません。

`source + usageType + externalId` の組み合わせは一意です。同じ組み合わせを再送信すると、新しい行を作成せず既存の行を更新します。1件のリクエストで `externalId` がない場合は、代わりに `Idempotency-Key` ヘッダーを使用できます。

## 複数件の送信

最大100件です。

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

配列自体をリクエスト本文として送ることもできます。

## 管理者による手動追加

```http
POST /api/usage/manual
Content-Type: application/json
Cookie: codex_admin_session=...
Origin: https://現在のダッシュボードアドレス
```

本文の形式は外部収集リクエストと同じです。ログインしていない場合は `401 admin_login_required` です。

## 削除

```http
DELETE /api/usage/123
Cookie: codex_admin_session=...
Origin: https://現在のダッシュボードアドレス
```

削除は元に戻せません。ログインしていない場合は `401 admin_login_required` です。

## curl で管理者フローをテスト

ブラウザーではなく curl でテストするときは、クッキーファイルを使用し、`Origin` を実際のダッシュボード URL と同じ値に設定します。

```bash
BASE_URL="https://codex-usage-dashboard.<アカウント>.workers.dev"

curl -c admin-cookies.txt \
  -X POST "$BASE_URL/api/admin/login" \
  -H "Origin: $BASE_URL" \
  -H "Content-Type: application/json" \
  -d '{"password":"設定したパスワード"}'
```

```bash
curl -b admin-cookies.txt \
  -H "Origin: $BASE_URL" \
  -X DELETE "$BASE_URL/api/usage/123"
```
