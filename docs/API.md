# API 사용법

기본 주소 예시:

```text
https://codex-usage-dashboard.<계정>.workers.dev
```

## 인증 구분

| 용도 | 인증 방식 |
|---|---|
| 공개 기간 조회 | 인증 없음 |
| 외부 수집 `POST /api/usage` | `INGEST_TOKEN` Bearer 토큰 |
| 관리자 상태·설정·로그인·로그아웃 | 같은 출처의 브라우저 요청 |
| 관리자 수동 추가·삭제 | HttpOnly 관리자 세션 쿠키 |

관리자 비밀번호를 Worker Secret으로 미리 등록하지 않습니다. 최초 설정 API가 D1에 비밀번호 해시를 저장합니다.

## 서비스 상태

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

## 관리자 인증 API

### 상태 확인

```http
GET /api/admin/status
```

최초 상태:

```json
{
  "ok": true,
  "configured": false,
  "authenticated": false,
  "sessionExpiresAt": null,
  "passwordMinLength": 10
}
```

로그인 상태에서는 `configured`와 `authenticated`가 모두 `true`입니다.

### 최초 비밀번호 설정

관리자 비밀번호가 아직 없을 때 한 번만 성공합니다.

```http
POST /api/admin/setup
Content-Type: application/json
Origin: https://현재-대시보드-주소
```

```json
{
  "password": "10자 이상의 비밀번호"
}
```

성공 시 비밀번호 해시를 저장하고 바로 관리자 세션 쿠키를 발급합니다. 비밀번호 원문은 D1에 저장하지 않습니다.

이미 설정된 경우 `409 admin_already_configured`를 반환합니다.

### 로그인

```http
POST /api/admin/login
Content-Type: application/json
Origin: https://현재-대시보드-주소
```

```json
{
  "password": "설정한 비밀번호"
}
```

성공하면 `codex_admin_session` HttpOnly 쿠키가 발급됩니다. 세션은 7일간 유효합니다.

15분 안에 5번 실패하면 15분간 `429 login_rate_limited` 응답을 반환합니다.

### 로그아웃

```http
POST /api/admin/logout
Cookie: codex_admin_session=...
Origin: https://현재-대시보드-주소
```

해당 세션을 D1에서 삭제하고 쿠키를 만료시킵니다.

## 기간 조회

```http
GET /api/usage?start=1784300400&end=1784386800&bucket=1200
```

| 쿼리 | 설명 |
|---|---|
| `start` | 조회 시작 Unix timestamp 초, 포함 |
| `end` | 조회 종료 Unix timestamp 초, 미포함 |
| `bucket` | 차트 다운샘플링 버킷 크기 초. `0`이면 원본 |

응답 예시:

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

- `series`: 유형별 차트 데이터
- `baselines`: `start` 이전 유형별 마지막 값
- `entries`: 표에 표시할 원본 데이터, 최근 순 최대 300건
- `counts`: 기간 안의 유형별 원본 행 수

프론트엔드는 증가·동일 값에서 다음 측정값까지 이전 값을 평탄하게 유지하고, 사용률이 감소한 지점은 리셋으로 판단해 선을 끊습니다.

## 외부 수집 인증

```http
Authorization: Bearer <INGEST_TOKEN>
Content-Type: application/json
```

토큰 등록:

```bash
npx wrangler secret put INGEST_TOKEN
```

## Raspberry Pi 수집 엔드포인트

`POST /api/usagefrompi`는 `POST /api/usage`와 동일한 입력 형식과 저장 처리를 사용하지만,
수집 토큰 인증 없이 동작하는 별도 엔드포인트입니다. 기본값은 비활성화이며,
GitHub Actions production environment variable `USAGEFROMPI_ENABLED`를 `true`로 설정한
배포에서만 활성화됩니다. 비활성화된 상태에서는 `404`를 반환합니다.

```http
POST /api/usagefrompi
Content-Type: application/json
```

## 단건 데이터 전송

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
  "note": "선택 값",
  "metadata": {
    "collectorVersion": "1.0.0"
  }
}
```

`usageType`은 `5h` 또는 `week`입니다.

`recordedAt` 형식:

- Unix timestamp 초
- Unix timestamp 밀리초
- ISO 8601 문자열

사용량은 퍼센트로 전송합니다.

```json
{
  "usedPercent": 42.5
}
```

D1에는 `used_percent`만 저장됩니다. `usedPercent`는 0 이상 100 이하만 허용하며, 한도·원본 사용량·입력/출력 토큰·비용은 저장하거나 입력받지 않습니다.

`source + usageType + externalId` 조합은 유일합니다. 같은 조합을 다시 보내면 새 행을 만들지 않고 기존 행을 갱신합니다. 단건 요청에서 `externalId`가 없으면 `Idempotency-Key` 헤더를 대신 사용할 수 있습니다.

## 여러 건 전송

최대 100건입니다.

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

배열 자체를 요청 본문으로 보내도 됩니다.

## 관리자 수동 추가

```http
POST /api/usage/manual
Content-Type: application/json
Cookie: codex_admin_session=...
Origin: https://현재-대시보드-주소
```

본문 형식은 외부 수집 요청과 같습니다. 로그인하지 않으면 `401 admin_login_required`입니다.

## 삭제

```http
DELETE /api/usage/123
Cookie: codex_admin_session=...
Origin: https://현재-대시보드-주소
```

삭제는 되돌릴 수 없습니다. 로그인하지 않으면 `401 admin_login_required`입니다.

## curl로 관리자 흐름 시험

브라우저가 아닌 curl로 시험할 때는 쿠키 파일을 사용하고 `Origin`을 실제 대시보드 주소와 같게 설정합니다.

```bash
BASE_URL="https://codex-usage-dashboard.<계정>.workers.dev"

curl -c admin-cookies.txt \
  -X POST "$BASE_URL/api/admin/login" \
  -H "Origin: $BASE_URL" \
  -H "Content-Type: application/json" \
  -d '{"password":"설정한 비밀번호"}'
```

```bash
curl -b admin-cookies.txt \
  -H "Origin: $BASE_URL" \
  -X DELETE "$BASE_URL/api/usage/123"
```
