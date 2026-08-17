CREATE TABLE IF NOT EXISTS groq_key_state (
  key_slot INTEGER PRIMARY KEY CHECK (key_slot >= 0),
  active_requests INTEGER NOT NULL DEFAULT 0 CHECK (active_requests >= 0),
  cooldown_until INTEGER NOT NULL DEFAULT 0,
  lease_expires_at INTEGER NOT NULL DEFAULT 0,
  last_selected_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;

INSERT OR IGNORE INTO groq_key_state (key_slot) VALUES (0), (1), (2), (3), (4);
