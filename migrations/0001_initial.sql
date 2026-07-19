PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS codex_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recorded_at INTEGER NOT NULL,
  used_amount REAL NOT NULL DEFAULT 0,
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

  CHECK (recorded_at > 0),
  CHECK (used_amount >= 0),
  CHECK (limit_amount IS NULL OR limit_amount >= 0),
  CHECK (input_tokens IS NULL OR input_tokens >= 0),
  CHECK (cached_input_tokens IS NULL OR cached_input_tokens >= 0),
  CHECK (output_tokens IS NULL OR output_tokens >= 0),
  CHECK (total_tokens IS NULL OR total_tokens >= 0),
  CHECK (cost_usd IS NULL OR cost_usd >= 0),
  UNIQUE (source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_codex_usage_recorded_at
  ON codex_usage(recorded_at);

CREATE INDEX IF NOT EXISTS idx_codex_usage_source_recorded_at
  ON codex_usage(source, recorded_at);
