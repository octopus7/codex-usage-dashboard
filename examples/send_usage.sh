#!/usr/bin/env bash
set -euo pipefail

: "${DASHBOARD_URL:?DASHBOARD_URL 환경변수가 필요합니다.}"
: "${INGEST_TOKEN:?INGEST_TOKEN 환경변수가 필요합니다.}"

USAGE_TYPE="${1:-5h}"
USED_PERCENT="${2:-42.5}"
NOW="${3:-$(date +%s)}"

case "$USAGE_TYPE" in
  5h|week) ;;
  *) echo "사용법: $0 <5h|week> <사용률> [Unix초]" >&2; exit 2 ;;
esac

EXTERNAL_ID="${USAGE_TYPE}-${NOW}"

curl --fail-with-body \
  --request POST \
  "${DASHBOARD_URL%/}/api/usage" \
  --header "Authorization: Bearer ${INGEST_TOKEN}" \
  --header "Content-Type: application/json" \
  --header "Idempotency-Key: ${EXTERNAL_ID}" \
  --data @- <<JSON
{
  "usageType": "${USAGE_TYPE}",
  "recordedAt": ${NOW},
  "usedPercent": ${USED_PERCENT},
  "source": "external-collector",
  "externalId": "${EXTERNAL_ID}",
  "note": "curl 독립 시계열 예제"
}
JSON
