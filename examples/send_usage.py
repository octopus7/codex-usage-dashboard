#!/usr/bin/env python3
"""외부 수집기에서 5h 또는 week 사용량을 독립 전송하는 표준 라이브러리 예제."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Codex 사용량 전송")
    parser.add_argument("usage_type", choices=("5h", "week"), help="독립 시계열 종류")
    parser.add_argument("used_percent", type=float, help="사용률(%)")
    parser.add_argument(
        "--recorded-at",
        type=int,
        default=None,
        help="Unix timestamp(초). 생략하면 현재 시각",
    )
    parser.add_argument("--source", default="external-collector")
    parser.add_argument("--note", default="Python 예제 전송")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    base_url = os.environ.get("DASHBOARD_URL", "").rstrip("/")
    token = os.environ.get("INGEST_TOKEN", "")

    if not base_url or not token:
        print("DASHBOARD_URL과 INGEST_TOKEN 환경변수가 필요합니다.", file=sys.stderr)
        return 2

    recorded_at = args.recorded_at or int(time.time())
    external_id = f"{args.usage_type}-{recorded_at}"
    payload = {
        "usageType": args.usage_type,
        "recordedAt": recorded_at,
        "usedPercent": args.used_percent,
        "source": args.source,
        "externalId": external_id,
        "note": args.note,
    }

    request = urllib.request.Request(
        f"{base_url}/api/usage",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Idempotency-Key": external_id,
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            print(response.read().decode("utf-8"))
            return 0
    except urllib.error.HTTPError as error:
        print(error.read().decode("utf-8"), file=sys.stderr)
        return 1
    except urllib.error.URLError as error:
        print(f"전송 실패: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
