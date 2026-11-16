CREATE TABLE IF NOT EXISTS event_state (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  payload TEXT NOT NULL,
  previous_version INTEGER,
  previous_updated_at TEXT,
  previous_payload TEXT
);
