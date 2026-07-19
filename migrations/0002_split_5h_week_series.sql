PRAGMA foreign_keys = OFF;

CREATE TABLE codex_usage_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usage_type TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  used_amount REAL NOT NULL,
  limit_amount REAL,
  input_tokens INTEGER,
  cached_input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  cost_usd REAL,
  source TEXT NOT NULL DEFAULT 'external',
  external_id TEXT,
  note TEXT,
  metadata_json TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),

  CHECK (usage_type IN ('5h', 'week')),
  CHECK (recorded_at > 0),
  CHECK (used_amount >= 0),
  CHECK (limit_amount IS NULL OR limit_amount > 0),
  CHECK (input_tokens IS NULL OR input_tokens >= 0),
  CHECK (cached_input_tokens IS NULL OR cached_input_tokens >= 0),
  CHECK (output_tokens IS NULL OR output_tokens >= 0),
  CHECK (total_tokens IS NULL OR total_tokens >= 0),
  CHECK (cost_usd IS NULL OR cost_usd >= 0),
  UNIQUE (usage_type, source, external_id)
);

-- 구버전에는 사용량 종류가 없으므로 기존 행은 5h로 분류합니다.
INSERT INTO codex_usage_v2 (
  id,
  usage_type,
  recorded_at,
  used_amount,
  limit_amount,
  input_tokens,
  cached_input_tokens,
  output_tokens,
  total_tokens,
  cost_usd,
  source,
  external_id,
  note,
  metadata_json,
  created_at,
  updated_at
)
SELECT
  id,
  '5h',
  recorded_at,
  used_amount,
  CASE WHEN limit_amount IS NOT NULL AND limit_amount <= 0 THEN NULL ELSE limit_amount END,
  input_tokens,
  cached_input_tokens,
  output_tokens,
  total_tokens,
  cost_usd,
  source,
  external_id,
  note,
  metadata_json,
  created_at,
  updated_at
FROM codex_usage;

DROP TABLE codex_usage;
ALTER TABLE codex_usage_v2 RENAME TO codex_usage;

CREATE INDEX idx_codex_usage_type_recorded_at
  ON codex_usage(usage_type, recorded_at);

CREATE INDEX idx_codex_usage_recorded_at
  ON codex_usage(recorded_at);

CREATE INDEX idx_codex_usage_type_source_recorded_at
  ON codex_usage(usage_type, source, recorded_at);

PRAGMA foreign_keys = ON;
