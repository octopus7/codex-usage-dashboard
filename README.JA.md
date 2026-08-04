[English](README.md) | [한국어](README.KO.md) | **日本語**

# Codex 5h・Week 使用量ダッシュボード

Cloudflare のサービスのみで構成された Codex 使用量ダッシュボードです。

5時間使用量と週間使用量は、**互いに独立した時系列**として D1 に保存されます。2つの値は異なる時刻・周期で送信でき、画面上では同じ時間軸に2本の線として表示されます。

- 増加または同じ値：次の記録時点まで前の値を水平に維持
- 値の減少：使用量のリセットと判断し、前後の点を線で結ばない
- 最後の記録以降：選択範囲の終端まで最後の値を水平に維持
- Y軸：左右とも `0% · 25% · 50% · 75% · 100%` に固定

管理機能に事前設定された `ADMIN_TOKEN` は不要です。初回デプロイ時の空の D1 では、パスワード設定ダイアログが自動的に開きます。入力したパスワードの **PBKDF2-SHA-256 ハッシュと salt のみを D1 に保存**し、以降は管理者ログインと HttpOnly セッションクッキーを使用します。

## 構成

```text
外部コレクター
  ├─ 5h 変更時に POST /api/usage
  └─ week 変更時に POST /api/usage
              │ Bearer INGEST_TOKEN
              ▼
Cloudflare Worker API
              ▼
Cloudflare D1
  ├─ codex_usage
  ├─ admin_credentials
  ├─ admin_sessions
  └─ admin_login_attempts

ブラウザー
  ├─ Workers Static Assets
  ├─ 公開履歴と 5h・week 同時グラフ
  └─ パスワードログイン後の手動追加・削除

RSS リーダー
  └─ GET /rss.xml → week の値が実際に変化した時点のみ受信
```

使用するサービス：

- **Workers Static Assets**：HTML、CSS、JavaScript
- **Cloudflare Worker**：照会・収集・管理者認証・追加・削除 API
- **Cloudflare D1**：使用量、パスワードハッシュ、管理者セッションの保存

## 主な機能

- 外部収集用 `POST /api/usage`
- 週間使用量の変更値専用 `GET /rss.xml`
- `5h` と `week` を異なる時点に個別送信
- 時間範囲：**1時間、6時間、12時間、1日、2日、1週間、2週間、4週間**
- 前後の区間への移動とモバイルでの左右スワイプ
- 5h・week 同時ステップ形式グラフ
- 使用量が減少するリセット区間を自動的に分断
- 使用率（%）専用グラフ
- 凡例から各線の表示・非表示を切り替え
- `externalId` と `Idempotency-Key` による重複防止
- 初回アクセス時の管理者パスワード設定
- HttpOnly・SameSite セッションクッキー
- 匿名ユーザーには手動追加ボタン、管理列、削除ボタンを表示しない
- 匿名での手動追加・削除 API リクエストも `401` で拒否
- パスワードログインに5回失敗すると15分間ロック

## 週間使用量 RSS

RSS リーダーに次の URL を登録します。

```text
https://<ダッシュボードのアドレス>/rss.xml
```

フィードには `week` 使用量の最新変更50件のみが含まれます。各項目のタイトルと説明には `42.5` のような数値だけが入り、送信元・メモ・メタデータと `5h` 使用量は含まれません。前の記録と同じ数値が連続して保存されている場合、その記録は省略されます。値が変化した後で以前の数値に戻った記録は、実際の変更として含まれます。

## プロジェクト構成

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
└── wrangler.jsonc  # ローカルで生成、Git 対象外
```

## 必要なもの

- Cloudflare アカウント
- Node.js 22 以降
- npm
- Cloudflare アカウントで Worker と D1 を作成する権限

## 新規インストール

### 1. アーカイブの展開とパッケージのインストール

```bash
unzip codex-usage-dashboard-repository.zip
cd codex-usage-dashboard-repository

cp wrangler.example.jsonc wrangler.jsonc
npm install
```

### 2. Cloudflare へログイン

```bash
npx wrangler login
```

### 3. D1 の作成とバインディングの追加

```bash
npm run setup:db
```

このコマンドは次の設定で D1 を作成し、`wrangler.jsonc` にバインディングを追加します。

```text
データベース名: codex-usage-db
Worker バインディング: DB
ロケーションヒント: apac
```

完了後、`wrangler.jsonc` に次のような設定が追加されます。

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "codex-usage-db",
    "database_id": "..."
  }
]
```

### 4. 本番 D1 のマイグレーション

```bash
npm run db:migrate:remote
```

新しいデータベースには、次のマイグレーションが順番に適用されます。

```text
0001_initial.sql
0002_split_5h_week_series.sql
0003_admin_password_sessions.sql
0004_percent_only_usage.sql
```

### 5. 初回デプロイ

```bash
npm run deploy
```

出力された `workers.dev` の URL を控えておきます。

### 6. 外部収集トークンの登録

管理者ログインパスワードとは別に、外部コレクターがデータを登録するときに使う Worker Secret を設定します。

```bash
openssl rand -hex 32
npx wrangler secret put INGEST_TOKEN
```

生成したトークンは外部コレクターにだけ保存し、HTML や `public/app.js` には入れないでください。

**`ADMIN_TOKEN` は使用しません。**

### 7. 初期管理者パスワードの設定

デプロイしたダッシュボードの URL を開きます。

1. D1 に管理者パスワードがなければ、設定ダイアログが自動的に開きます。
2. 10文字以上のパスワードを2回入力します。
3. **パスワードを保存**を選択します。
4. パスワードハッシュが D1 に保存され、現在のブラウザーは自動的にログインします。
5. ログイン後にのみ、**使用量を追加**、表の **管理** 列、**削除** ボタンが表示されます。

重要：初期パスワード設定には事前共有の管理者シークレットがありません。新規デプロイでは最初に設定 API を呼び出した人が管理者になれるため、**デプロイ直後に自分でアクセスしてすぐ設定**してください。公開前に Cloudflare Access で一時的に保護する方法もあります。

## 管理者認証の動作

### 匿名ユーザー

- グラフと使用量履歴を閲覧可能
- 管理者ログインボタンを表示
- 使用量追加ボタンは非表示
- 表の管理列は非表示
- 削除ボタンを DOM に生成しない
- 手動追加・削除 API を直接呼び出しても `401` を返す

### 管理者

- パスワードログイン成功時に HttpOnly セッションクッキーを発行
- セッション有効期間は7日
- `SameSite=Strict`、HTTPS デプロイでは `Secure` を適用
- D1 には元のセッショントークンではなく SHA-256 ハッシュを保存
- ログアウト時に該当セッションを D1 から削除してクッキーを除去

### ログイン失敗制限

同じクライアントで15分以内にパスワードを5回間違えると、15分間ログインがロックされます。ログインに成功すると失敗履歴は削除されます。

## Raspberry Pi 無人収集エンドポイント

`POST /api/usagefrompi` は `POST /api/usage` と同じデータ形式と保存ロジックを使用しますが、認証なしでデータを受け取ります。デフォルトでは無効で、GitHub Actions の production environment variable `USAGEFROMPI_ENABLED` を `true` に設定したデプロイでのみ有効になります。無効な状態では `404` を返します。

```http
POST /api/usagefrompi
Content-Type: application/json
```

## 外部から個別に送信

環境変数：

```bash
export DASHBOARD_URL="https://codex-usage-dashboard.<アカウント>.workers.dev"
export INGEST_TOKEN="<Worker Secret に設定した値>"
```

### 5時間使用量のみ送信

```bash
bash examples/send_usage.sh 5h 42.5
```

送信例：

```json
{
  "usageType": "5h",
  "recordedAt": 1784340000,
  "usedPercent": 42.5,
  "source": "external-collector",
  "externalId": "5h-1784340000"
}
```

### 週間使用量を別の時点で送信

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

2つのリクエストの送信時刻と周期は互いに独立しています。

### Python の例

```bash
python3 examples/send_usage.py 5h 42.5
python3 examples/send_usage.py week 68.2
```

### curl で直接呼び出す

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

完全な API 仕様は [`docs/API.JA.md`](docs/API.JA.md) を参照してください。

## 送信データ形式

使用率のパーセント値だけを保存します。`usedPercent` は必須で、`0` 以上 `100` 以下のみ許可されます。上限、元の使用量、トークン、費用フィールドは DB に保存しません。

```json
{
  "usageType": "week",
  "recordedAt": "2026-07-18T12:00:00+09:00",
  "usedPercent": 61.3,
  "source": "collector",
  "externalId": "week-20260718-120000"
}
```

`usedAmount` と `limitAmount` は API 入力として受け付けません。コレクターは計算済みの `usedPercent` だけを送信してください。

## グラフの動作

例：

```text
10:00  5h   32%
10:37  5h   38%
12:15  5h   47%
13:00  5h    4%  ← リセット
14:00  5h   12%

10:15  week 55%
14:05  week 61%
```

表示原則：

```text
5h    32% ╱ 38% ╱ 47%       4% ╱ 12%
                         ↑ 減少区間は接続しない
week       55% ╱──────────────────── 61%
```

- 前の値以上の新しい値は、2つの記録時点を斜線で接続します。
- 新しい値が前の値より小さい場合はリセットとみなし、前後の点を線で結びません。
- `usedPercent` の減少をリセットと判断します。
- 最後の記録以降は、選択範囲の終端まで最後の値を水平に維持します。
- 選択範囲の開始前に最後の値がある場合、範囲開始点の基準値として使用します。範囲内の最初の値がより低い場合も接続しません。
- 長期間をバケットに縮小するときも、リセット直前の点と減少した新しい点の両方を保持し、分断位置が失われないようにします。

| 表示範囲 | シリーズごとのバケット |
|---|---:|
| 1時間 | 1分 |
| 6時間 | 5分 |
| 12時間 | 10分 |
| 1日 | 20分 |
| 2日 | 30分 |
| 1週間 | 2時間 |
| 2週間 | 4時間 |
| 4週間 | 8時間 |

## 既存 ZIP からのアップグレード

以前の2系列バージョンをすでにデプロイしている場合、まずバックアップします。

```bash
npx wrangler d1 export DB \
  --remote \
  --output=codex-usage-before-password-auth.sql
```

プロジェクトを新しい ZIP のファイルに置き換え、次を実行します。

```bash
npm install
npm run db:migrate:remote
npm run deploy
```

`0003_admin_password_sessions.sql` が管理者パスワードとセッションのテーブルを追加します。既存の使用量データは変更されません。

アップグレード後にページを開くと、初期パスワード設定ダイアログが表示されます。以前のバージョンの `ADMIN_TOKEN` は新しいコードでは参照されません。

## ローカル開発

```bash
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

`.dev.vars` にはローカルテスト用の `INGEST_TOKEN` だけを置きます。ローカル D1 と本番 D1 のパスワード・セッションは互いに独立しています。

## 管理者パスワードを忘れた場合

元のパスワードは復元できません。本番 D1 から管理者セッションと認証情報を削除して、新しいパスワードを設定します。

```bash
npx wrangler d1 execute DB \
  --remote \
  --command "DELETE FROM admin_sessions"

npx wrangler d1 execute DB \
  --remote \
  --command "DELETE FROM admin_credentials WHERE id = 1"
```

ページを開き直すと、初期パスワード設定ダイアログが再び表示されます。

## バックアップ

```bash
npx wrangler d1 export DB \
  --remote \
  --output=codex-usage-backup.sql
```

## セキュリティに関する推奨事項

- デプロイ直後に管理者パスワードを設定してください。
- 管理者パスワードと `INGEST_TOKEN` には異なる値を使用してください。
- `INGEST_TOKEN` を静的ファイルや Git リポジトリに入れないでください。
- 外部コレクターでは `externalId` または `Idempotency-Key` を使用してください。
- 閲覧内容も非公開にする必要がある場合は Cloudflare Access を追加してください。
- 削除は元に戻せないため、D1 を定期的にバックアップしてください。
- 共有コンピューターでは作業後に必ずログアウトしてください。

## よく使うコマンド

新規インストール：

```bash
npm install
npx wrangler login
npm run setup:db
npm run db:migrate:remote
npm run deploy
npx wrangler secret put INGEST_TOKEN
```

更新：

```bash
npm install
npm run db:migrate:remote
npm run deploy
```

チェック：

```bash
npm run check
```

## 公式ドキュメント

- Workers Static Assets: https://developers.cloudflare.com/workers/static-assets/
- D1 入門: https://developers.cloudflare.com/d1/get-started/
- D1 マイグレーション: https://developers.cloudflare.com/d1/reference/migrations/
- Workers Secrets: https://developers.cloudflare.com/workers/configuration/secrets/

## Git リポジトリでの運用

この配布版では `wrangler.jsonc` を Git の対象外にしています。このファイルに秘密値はありませんが、アカウント固有の D1 `database_id` が含まれるため、新しい ZIP や別ブランチが本番設定を上書きしないようローカルファイルとして保持します。

初回クローン直後：

```bash
cp wrangler.example.jsonc wrangler.jsonc
npm install
```

新しい D1 を作成する場合：

```bash
npm run setup:db
npm run db:migrate:remote
npm run deploy
```

既存の D1 に接続する場合：

```bash
npx wrangler d1 list
nano wrangler.jsonc
```

`wrangler.jsonc` のトップレベルオブジェクトに次のバインディングを追加します。

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "codex-usage-db",
    "database_id": "wrangler d1 list で確認した UUID"
  }
]
```

接続の確認：

```bash
npx wrangler d1 execute DB \
  --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

通常のリポジトリ更新：

```bash
git pull
npm install
npm run check
npm run db:migrate:remote
npm run deploy
```

`wrangler.jsonc`、`.dev.vars`、`.env`、`~/.config/codex-collector/env` はコミットしません。`INGEST_TOKEN` は Cloudflare Worker Secret とコレクターマシンにだけ保存します。

## Raspberry Pi / SSH での Wrangler ログイン

Raspberry Pi で実行します。

```bash
npx wrangler login
```

別の PC のブラウザーで承認した後、`localhost` のコールバックページが開かない場合は、ブラウザーのアドレスバーからコールバック URL 全体をコピーします。

例：

```text
http://localhost:8976/oauth/callback?code=...&state=...
```

Raspberry Pi の2つ目の SSH ウィンドウから、そのまま呼び出します。

```bash
curl 'http://localhost:8976/oauth/callback?code=...&state=...'
```

ログインの確認：

```bash
npx wrangler whoami
```

## 既存デプロイの更新

既存プロジェクトのコードだけを置き換えるか Git で更新した後、本番運用中の `wrangler.jsonc` をそのまま保持して次を実行します。

```bash
npm install
npm run check
npm run db:migrate:remote
npm run deploy
```

`0004_percent_only_usage.sql` は既存の `used_amount`/`limit_amount` データを `used_percent` に変換した後、不要な DB 列を削除します。

デプロイの確認：

```bash
source ~/.config/codex-collector/env
curl -i "$DASHBOARD_URL/api/health"
```

`HTTP 200` と `"ok": true` が返れば正常です。API が 500 を返す場合：

```bash
npx wrangler tail
```

を実行した状態で、別のターミナルから `/api/health` を再度呼び出し、実際の例外を確認します。

## グラフ軸と接続規則

- Y軸の範囲はデータに関係なく常に `0%` から `100%`
- 補助目盛りは `25%`、`50%`、`75%`
- 同じ目盛りをグラフの左右両方に表示
- 値が増加または同じ場合、次の測定点まで前の値を水平に維持
- 次の測定値が前より小さい場合はリセットとみなし、その区間を接続しない
- `5h` と `week` のリセット判定は各時系列で独立
