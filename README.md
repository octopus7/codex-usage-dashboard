# Codex 5h · Week 사용량 대시보드

Cloudflare 서비스만 사용해 구성한 Codex 사용량 대시보드입니다.

5시간 사용량과 주간 사용량은 **서로 독립된 시계열**로 D1에 저장됩니다. 두 값은 다른 시각과 다른 주기로 전송할 수 있으며, 화면에서는 같은 시간축에 두 선으로 함께 표시됩니다.

- 증가하거나 같은 값: 기록 시점 사이를 직선으로 연결
- 값 감소: 사용량 리셋으로 판단하고 이전 점과 새 점 사이의 선을 끊음
- 마지막 기록 이후: 선택 범위 끝까지 마지막 값을 수평 유지
- Y축: 좌우 모두 `0% · 25% · 50% · 75% · 100%` 고정

관리 기능에는 사전 `ADMIN_TOKEN`이 필요하지 않습니다. 처음 배포된 빈 D1에서는 비밀번호 설정 창이 자동으로 열립니다. 입력한 비밀번호의 **PBKDF2-SHA-256 해시와 salt만 D1에 저장**되며, 이후에는 관리자 로그인과 HttpOnly 세션 쿠키를 사용합니다.

## 구성

```text
외부 수집기
  ├─ 5h 변경 시 POST /api/usage
  └─ week 변경 시 POST /api/usage
              │ Bearer INGEST_TOKEN
              ▼
Cloudflare Worker API
              ▼
Cloudflare D1
  ├─ codex_usage
  ├─ admin_credentials
  ├─ admin_sessions
  └─ admin_login_attempts

브라우저
  ├─ Workers Static Assets
  ├─ 공개 조회와 5h·week 동시 그래프
  └─ 비밀번호 로그인 후 수동 추가·삭제
```

사용 서비스:

- **Workers Static Assets**: HTML, CSS, JavaScript
- **Cloudflare Worker**: 조회·수집·관리자 인증·추가·삭제 API
- **Cloudflare D1**: 사용량, 비밀번호 해시, 관리자 세션 저장

## 주요 기능

- 외부 수집용 `POST /api/usage`
- `5h`와 `week`를 서로 다른 시점에 단독 전송
- 시간 범위: **1시간, 6시간, 12시간, 1일, 2일, 1주, 2주, 4주**
- 이전·다음 구간 이동과 모바일 좌우 스와이프
- 5h·week 동시 직선 그래프
- 사용량이 감소하는 리셋 구간 자동 단절
- 사용률(%) 전용 그래프
- 범례에서 각 선 표시·숨김
- `externalId`와 `Idempotency-Key`를 이용한 중복 방지
- 최초 접속 시 관리자 비밀번호 설정
- HttpOnly·SameSite 세션 쿠키
- 익명 사용자에게 수동 추가 버튼, 관리 열, 삭제 버튼을 노출하지 않음
- 익명 수동 추가·삭제 API 요청도 `401`로 차단
- 비밀번호 로그인 5회 실패 시 15분 잠금

## 프로젝트 구조

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
│   └── API.md
├── .dev.vars.example
├── package.json
├── wrangler.example.jsonc
└── wrangler.jsonc  # 로컬에서 생성, Git 제외
```

## 준비물

- Cloudflare 계정
- Node.js 22 이상
- npm
- Cloudflare 계정에 Worker와 D1을 생성할 권한

## 새로 설치하기

### 1. 압축 해제와 패키지 설치

```bash
unzip codex-usage-dashboard-repository.zip
cd codex-usage-dashboard-repository

cp wrangler.example.jsonc wrangler.jsonc
npm install
```

### 2. Cloudflare 로그인

```bash
npx wrangler login
```

### 3. D1 생성과 바인딩 추가

```bash
npm run setup:db
```

이 명령은 다음 설정으로 D1을 생성하고 `wrangler.jsonc`에 바인딩을 추가합니다.

```text
데이터베이스 이름: codex-usage-db
Worker 바인딩: DB
위치 힌트: apac
```

완료 후 `wrangler.jsonc`에는 다음과 비슷한 설정이 추가됩니다.

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "codex-usage-db",
    "database_id": "..."
  }
]
```

### 4. 운영 D1 마이그레이션

```bash
npm run db:migrate:remote
```

새 데이터베이스에는 다음 마이그레이션이 순서대로 적용됩니다.

```text
0001_initial.sql
0002_split_5h_week_series.sql
0003_admin_password_sessions.sql
0004_percent_only_usage.sql
```

### 5. 최초 배포

```bash
npm run deploy
```

출력되는 `workers.dev` 주소를 기록합니다.

### 6. 외부 수집 토큰 등록

관리자 로그인 비밀번호와 별개로, 외부 수집기가 데이터를 넣을 때 사용할 Worker Secret을 등록합니다.

```bash
openssl rand -hex 32
npx wrangler secret put INGEST_TOKEN
```

생성한 토큰은 외부 수집기에만 보관하고 HTML이나 `public/app.js`에 넣지 마세요.

**`ADMIN_TOKEN`은 사용하지 않습니다.**

### 7. 최초 관리자 비밀번호 설정

배포된 대시보드 주소를 엽니다.

1. D1에 관리자 비밀번호가 없으면 설정 창이 자동으로 열립니다.
2. 10자 이상의 비밀번호를 두 번 입력합니다.
3. **비밀번호 저장**을 누릅니다.
4. 비밀번호 해시가 D1에 저장되고 현재 브라우저는 자동 로그인됩니다.
5. 로그인 후에만 **사용량 추가**, 표의 **관리** 열과 **삭제** 버튼이 나타납니다.

중요: 최초 비밀번호 설정에는 사전 관리자 비밀키가 없습니다. 새 배포에서는 먼저 설정 API를 호출한 사람이 관리자가 될 수 있으므로 **배포 직후 직접 접속해 바로 설정**하세요. 공개 전에 Cloudflare Access로 임시 보호하는 방식도 사용할 수 있습니다.

## 관리자 인증 동작

### 익명 사용자

- 그래프와 사용량 기록 조회 가능
- 관리자 로그인 버튼 표시
- 사용량 추가 버튼 숨김
- 표의 관리 열 숨김
- 삭제 버튼을 DOM에 생성하지 않음
- 수동 추가·삭제 API를 직접 호출해도 `401` 반환

### 관리자

- 비밀번호 로그인 성공 시 HttpOnly 세션 쿠키 발급
- 세션 유효시간 7일
- `SameSite=Strict`, HTTPS 배포에서는 `Secure` 적용
- D1에는 원본 세션 토큰 대신 SHA-256 해시 저장
- 로그아웃 시 해당 세션을 D1에서 삭제하고 쿠키 제거

### 로그인 실패 제한

같은 클라이언트에서 15분 안에 비밀번호를 5회 틀리면 15분 동안 로그인이 잠깁니다. 성공적으로 로그인하면 실패 기록은 삭제됩니다.

## 외부에서 독립 전송

환경변수:

```bash
export DASHBOARD_URL="https://codex-usage-dashboard.<계정>.workers.dev"
export INGEST_TOKEN="<Worker Secret으로 설정한 값>"
```

### 5시간 사용량만 전송

```bash
bash examples/send_usage.sh 5h 42.5
```

전송 예시:

```json
{
  "usageType": "5h",
  "recordedAt": 1784340000,
  "usedPercent": 42.5,
  "source": "external-collector",
  "externalId": "5h-1784340000"
}
```

### 주간 사용량을 다른 시점에 전송

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

두 요청의 전송 시각과 주기는 서로 독립적입니다.

### Python 예제

```bash
python3 examples/send_usage.py 5h 42.5
python3 examples/send_usage.py week 68.2
```

### curl 직접 호출

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

전체 API 규격은 ZIP 안의 `docs/API.md`를 참고하세요.

## 전송 데이터 형식

사용률 퍼센트만 저장합니다. `usedPercent`는 필수이며 `0` 이상 `100` 이하만 허용합니다. 한도, 사용량 원본, 토큰, 비용 필드는 DB에 저장하지 않습니다.

```json
{
  "usageType": "week",
  "recordedAt": "2026-07-18T12:00:00+09:00",
  "usedPercent": 61.3,
  "source": "collector",
  "externalId": "week-20260718-120000"
}
```

`usedAmount`와 `limitAmount`는 더 이상 API 입력으로 받지 않습니다. 수집기는 계산을 마친 `usedPercent`만 보내야 합니다.

## 그래프 동작

예시:

```text
10:00  5h   32%
10:37  5h   38%
12:15  5h   47%
13:00  5h    4%  ← 리셋
14:00  5h   12%

10:15  week 55%
14:05  week 61%
```

표시 원칙:

```text
5h    32% ╱ 38% ╱ 47%       4% ╱ 12%
                         ↑ 감소 구간은 연결하지 않음
week       55% ╱──────────────────── 61%
```

- 이전 값보다 크거나 같은 새 값은 두 기록 시점 사이를 대각선으로 연결합니다.
- 새 값이 이전 값보다 작으면 리셋으로 간주하고 이전 점과 새 점 사이에 선을 그리지 않습니다.
- `usedPercent`가 감소하면 리셋으로 판단합니다.
- 마지막 기록 뒤에는 선택 범위 끝까지 마지막 값을 수평으로 유지합니다.
- 선택 범위 시작 전에 마지막 값이 있으면 범위 시작점의 기준값으로 사용합니다. 첫 범위 내 값이 더 낮으면 역시 연결하지 않습니다.
- 긴 기간을 버킷으로 줄일 때도 리셋 직전 점과 감소한 새 점을 함께 보존해 단절 위치가 사라지지 않게 합니다.

| 화면 범위 | 시리즈별 버킷 |
|---|---:|
| 1시간 | 1분 |
| 6시간 | 5분 |
| 12시간 | 10분 |
| 1일 | 20분 |
| 2일 | 30분 |
| 1주 | 2시간 |
| 2주 | 4시간 |
| 4주 | 8시간 |

## 기존 ZIP에서 업그레이드

기존 이중 시계열 버전을 이미 배포했다면 먼저 백업합니다.

```bash
npx wrangler d1 export DB \
  --remote \
  --output=codex-usage-before-password-auth.sql
```

새 ZIP의 파일로 프로젝트를 교체한 뒤 실행합니다.

```bash
npm install
npm run db:migrate:remote
npm run deploy
```

`0003_admin_password_sessions.sql`이 관리자 비밀번호와 세션 테이블을 추가합니다. 기존 사용량 데이터는 변경하지 않습니다.

업그레이드 후 페이지를 열면 최초 비밀번호 설정 창이 나타납니다. 이전 버전의 `ADMIN_TOKEN`은 새 코드에서 참조하지 않습니다.

## 로컬 개발

```bash
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

`.dev.vars`에는 로컬 테스트용 `INGEST_TOKEN`만 둡니다. 로컬 D1과 운영 D1의 비밀번호·세션은 서로 독립적입니다.

## 관리자 비밀번호를 잊은 경우

비밀번호 원문은 복구할 수 없습니다. 운영 D1에서 관리자 세션과 자격 증명을 삭제한 뒤 새 비밀번호를 설정합니다.

```bash
npx wrangler d1 execute DB \
  --remote \
  --command "DELETE FROM admin_sessions"

npx wrangler d1 execute DB \
  --remote \
  --command "DELETE FROM admin_credentials WHERE id = 1"
```

페이지를 새로 열면 최초 비밀번호 설정 창이 다시 나타납니다.

## 백업

```bash
npx wrangler d1 export DB \
  --remote \
  --output=codex-usage-backup.sql
```

## 보안 권장 사항

- 배포 직후 관리자 비밀번호를 설정하세요.
- 관리자 비밀번호와 `INGEST_TOKEN`을 서로 다르게 사용하세요.
- `INGEST_TOKEN`을 정적 파일이나 Git 저장소에 넣지 마세요.
- 외부 수집기는 `externalId` 또는 `Idempotency-Key`를 사용하세요.
- 조회 내용도 비공개여야 한다면 Cloudflare Access를 추가하세요.
- 삭제는 되돌릴 수 없으므로 D1을 정기적으로 백업하세요.
- 공용 컴퓨터에서는 작업 후 반드시 로그아웃하세요.

## 자주 쓰는 명령

새 설치:

```bash
npm install
npx wrangler login
npm run setup:db
npm run db:migrate:remote
npm run deploy
npx wrangler secret put INGEST_TOKEN
```

업데이트:

```bash
npm install
npm run db:migrate:remote
npm run deploy
```

검사:

```bash
npm run check
```

## 공식 문서

- Workers Static Assets: https://developers.cloudflare.com/workers/static-assets/
- D1 시작하기: https://developers.cloudflare.com/d1/get-started/
- D1 마이그레이션: https://developers.cloudflare.com/d1/reference/migrations/
- Workers Secrets: https://developers.cloudflare.com/workers/configuration/secrets/


## Git 저장소로 운영하기

이 배포판은 `wrangler.jsonc`를 Git에서 제외합니다. 이 파일에는 비밀값은 없지만 계정별 D1 `database_id`가 들어가므로, 새 ZIP이나 다른 브랜치가 운영 설정을 덮지 않도록 로컬 파일로 유지합니다.

최초 클론 직후:

```bash
cp wrangler.example.jsonc wrangler.jsonc
npm install
```

신규 D1을 만들 때:

```bash
npm run setup:db
npm run db:migrate:remote
npm run deploy
```

이미 존재하는 D1에 연결할 때:

```bash
npx wrangler d1 list
nano wrangler.jsonc
```

`wrangler.jsonc`의 최상위 객체에 다음 바인딩을 넣습니다.

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "codex-usage-db",
    "database_id": "wrangler d1 list에서 확인한 UUID"
  }
]
```

연결 확인:

```bash
npx wrangler d1 execute DB \
  --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

일상적인 저장소 업데이트:

```bash
git pull
npm install
npm run check
npm run db:migrate:remote
npm run deploy
```

`wrangler.jsonc`, `.dev.vars`, `.env`, `~/.config/codex-collector/env`는 커밋하지 않습니다. `INGEST_TOKEN`은 Cloudflare Worker Secret과 수집기 머신에만 저장합니다.

## Raspberry Pi / SSH에서 Wrangler 로그인

라즈베리파이에서 실행:

```bash
npx wrangler login
```

다른 PC 브라우저에서 승인한 뒤 `localhost` 콜백 페이지가 열리지 않으면, 브라우저 주소창의 콜백 URL 전체를 복사합니다.

예:

```text
http://localhost:8976/oauth/callback?code=...&state=...
```

라즈베리파이의 두 번째 SSH 창에서 그대로 호출합니다.

```bash
curl 'http://localhost:8976/oauth/callback?code=...&state=...'
```

로그인 확인:

```bash
npx wrangler whoami
```

## 기존 배포 업데이트

기존 프로젝트에서 코드만 교체하거나 Git으로 업데이트한 뒤, 운영 중인 `wrangler.jsonc`를 그대로 유지하고 실행합니다.

```bash
npm install
npm run check
npm run db:migrate:remote
npm run deploy
```

`0004_percent_only_usage.sql`은 기존 `used_amount`/`limit_amount` 데이터를 `used_percent`로 변환한 후 불필요한 DB 열을 제거합니다.

배포 확인:

```bash
source ~/.config/codex-collector/env
curl -i "$DASHBOARD_URL/api/health"
```

`HTTP 200`과 `"ok": true`가 나오면 정상입니다. API가 500이면:

```bash
npx wrangler tail
```

을 실행한 상태에서 다른 터미널에서 `/api/health`를 다시 호출해 실제 예외를 확인합니다.

## 그래프 축과 연결 규칙

- Y축 범위는 데이터와 관계없이 항상 `0%`부터 `100%`
- 보조 눈금은 `25%`, `50%`, `75%`
- 같은 눈금을 그래프 왼쪽과 오른쪽에 모두 표시
- 값이 증가하거나 같으면 측정점 사이를 직선으로 연결
- 다음 측정값이 이전보다 작으면 리셋으로 간주하여 그 구간은 연결하지 않음
- `5h`와 `week`의 리셋 여부는 각 시계열에서 독립적으로 판단
