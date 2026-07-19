PRAGMA foreign_keys = OFF;

CREATE TABLE codex_usage_percent_only (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usage_type TEXT NOT NULL CHECK (usage_type IN ('5h', 'week')),
  recorded_at INTEGER NOT NULL,
  used_percent REAL NOT NULL CHECK (used_percent >= 0),
  source TEXT NOT NULL DEFAULT 'external',
  external_id TEXT,
  note TEXT,
  metadata_json TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (usage_type, source, external_id)
);

INSERT INTO codex_usage_percent_only (
  id, usage_type, recorded_at, used_percent, source, external_id, note,
  metadata_json, created_at, updated_at
)
SELECT
  id,
  usage_type,
  recorded_at,
  CASE
    WHEN limit_amount IS NOT NULL AND limit_amount > 0
      THEN (used_amount / limit_amount) * 100.0
    ELSE used_amount
  END,
  source, external_id, note, metadata_json, created_at, updated_at
FROM codex_usage;

DROP TABLE codex_usage;
ALTER TABLE codex_usage_percent_only RENAME TO codex_usage;

CREATE INDEX idx_codex_usage_recorded_at ON codex_usage(recorded_at);
CREATE INDEX idx_codex_usage_type_recorded_at ON codex_usage(usage_type, recorded_at);

PRAGMA foreign_keys = ON;
