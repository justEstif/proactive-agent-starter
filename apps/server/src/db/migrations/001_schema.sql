-- The whole schema: idempotent request replay, sweep runs and their tool effects.

CREATE TABLE requests (
  key TEXT PRIMARY KEY,
  route TEXT NOT NULL,
  status INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE sweeps (
  id INTEGER PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  conversation_id INTEGER NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('cron', 'manual', 'test')),
  status TEXT NOT NULL CHECK (status IN ('accepted', 'running', 'done', 'failed')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  error TEXT
);

-- One durable tool effect per (sweep, key): a replayed sweep never presents twice.
CREATE TABLE effects (
  sweep_id INTEGER NOT NULL REFERENCES sweeps(id),
  key TEXT NOT NULL,
  tool TEXT NOT NULL,
  args TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (sweep_id, key)
);
