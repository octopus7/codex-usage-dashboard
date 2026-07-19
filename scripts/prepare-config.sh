#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -f wrangler.jsonc ]]; then
  echo "wrangler.jsonc가 이미 존재합니다. 기존 D1 설정을 보존하기 위해 변경하지 않았습니다."
  exit 0
fi

cp wrangler.example.jsonc wrangler.jsonc
echo "wrangler.example.jsonc → wrangler.jsonc 복사가 완료되었습니다."
echo "신규 설치: npm run setup:db"
echo "기존 D1: npx wrangler d1 list 후 wrangler.jsonc에 database_id를 입력하세요."
