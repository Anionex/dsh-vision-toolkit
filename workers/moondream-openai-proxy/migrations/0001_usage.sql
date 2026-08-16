CREATE TABLE IF NOT EXISTS usage_daily (
  day TEXT NOT NULL,
  client_hash TEXT NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count > 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (day, client_hash)
) WITHOUT ROWID;
