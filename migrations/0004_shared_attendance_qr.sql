PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS shared_qr_control (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  generation INTEGER NOT NULL DEFAULT 0,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT OR IGNORE INTO shared_qr_control(id,enabled,generation) VALUES(1,0,0);

CREATE TABLE IF NOT EXISTS shared_qr_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  generation INTEGER NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS shared_qr_display_keys (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_shared_qr_display_keys_expiry
  ON shared_qr_display_keys(expires_at,revoked_at);

CREATE INDEX IF NOT EXISTS idx_shared_qr_sessions_expiry
  ON shared_qr_sessions(expires_at,revoked_at);

CREATE TABLE IF NOT EXISTS shared_qr_claims (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES shared_qr_sessions(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL,
  claimed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  request_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_shared_qr_claims_active_user
  ON shared_qr_claims(user_id) WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_shared_qr_claims_session
  ON shared_qr_claims(session_id,user_id);

CREATE TABLE IF NOT EXISTS attendance_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK(event_type IN ('in','out')),
  occurred_at TEXT NOT NULL,
  work_date TEXT NOT NULL,
  shared_qr_session_id TEXT REFERENCES shared_qr_sessions(id) ON DELETE SET NULL,
  claim_id TEXT NOT NULL UNIQUE REFERENCES shared_qr_claims(id),
  request_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS attendance_event_state (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_type TEXT CHECK(last_type IN ('in','out')),
  last_at TEXT,
  revision INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_attendance_events_user_time
  ON attendance_events(user_id,occurred_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_events_work_date
  ON attendance_events(work_date,user_id,event_type);

-- Seed one state row per employee, preferring the newest new-style event when
-- present and otherwise deriving it from the unchanged legacy attendance row.
INSERT OR IGNORE INTO attendance_event_state(user_id,last_type,last_at,revision)
SELECT u.id,
       CASE WHEN e.event_type IS NOT NULL AND (a.check_in IS NULL OR e.occurred_at>=COALESCE(a.check_out,a.check_in)) THEN e.event_type
            WHEN a.check_out IS NOT NULL THEN 'out'
            WHEN a.check_in IS NOT NULL THEN 'in'
            WHEN e.event_type IS NOT NULL THEN e.event_type
            ELSE NULL END,
       CASE WHEN e.event_type IS NOT NULL AND (a.check_in IS NULL OR e.occurred_at>=COALESCE(a.check_out,a.check_in)) THEN e.occurred_at
            ELSE COALESCE(a.check_out,a.check_in,e.occurred_at) END,
       0
FROM users u
LEFT JOIN attendance_records a ON a.id=(
  SELECT id FROM attendance_records
  WHERE user_id=u.id AND COALESCE(check_out,check_in) IS NOT NULL
  ORDER BY COALESCE(check_out,check_in) DESC,id DESC LIMIT 1
)
LEFT JOIN attendance_events e ON e.id=(
  SELECT id FROM attendance_events
  WHERE user_id=u.id ORDER BY occurred_at DESC,id DESC LIMIT 1
)
WHERE u.role='employee';

CREATE TRIGGER IF NOT EXISTS trg_attendance_event_state_bootstrap
AFTER INSERT ON shared_qr_claims
WHEN NOT EXISTS(SELECT 1 FROM attendance_event_state WHERE user_id=NEW.user_id)
BEGIN
  INSERT INTO attendance_event_state(user_id,last_type,last_at,revision)
  SELECT NEW.user_id,
         CASE WHEN a.check_out IS NOT NULL THEN 'out' WHEN a.check_in IS NOT NULL THEN 'in' ELSE NULL END,
         COALESCE(a.check_out,a.check_in),
         0
  FROM users u LEFT JOIN attendance_records a ON a.user_id=u.id
  WHERE u.id=NEW.user_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_attendance_event_state_insert
AFTER INSERT ON attendance_events
BEGIN
  INSERT INTO attendance_event_state(user_id,last_type,last_at,revision)
  VALUES(NEW.user_id,NEW.event_type,NEW.occurred_at,1)
  ON CONFLICT(user_id) DO UPDATE SET last_type=excluded.last_type,last_at=excluded.last_at,revision=attendance_event_state.revision+1;
END;

CREATE TRIGGER IF NOT EXISTS trg_attendance_record_state_insert
AFTER INSERT ON attendance_records
WHEN NEW.check_in IS NOT NULL
BEGIN
  INSERT INTO attendance_event_state(user_id,last_type,last_at,revision)
  VALUES(NEW.user_id,CASE WHEN NEW.check_out IS NULL THEN 'in' ELSE 'out' END,COALESCE(NEW.check_out,NEW.check_in),1)
  ON CONFLICT(user_id) DO UPDATE SET last_type=excluded.last_type,last_at=excluded.last_at,revision=attendance_event_state.revision+1
  WHERE attendance_event_state.last_at IS NULL OR attendance_event_state.last_at<=excluded.last_at;
END;

CREATE TRIGGER IF NOT EXISTS trg_attendance_record_state_update
AFTER UPDATE OF check_in,check_out ON attendance_records
BEGIN
  INSERT INTO attendance_event_state(user_id,last_type,last_at,revision)
  SELECT NEW.user_id,
         CASE WHEN NEW.check_out IS NOT NULL THEN 'out' WHEN NEW.check_in IS NOT NULL THEN 'in' ELSE NULL END,
         COALESCE(NEW.check_out,NEW.check_in),1
  WHERE NEW.check_in IS NOT NULL
  ON CONFLICT(user_id) DO UPDATE SET last_type=excluded.last_type,last_at=excluded.last_at,revision=attendance_event_state.revision+1
  WHERE attendance_event_state.last_at IS NULL OR attendance_event_state.last_at<=excluded.last_at;
END;

CREATE TABLE IF NOT EXISTS attendance_event_edit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES attendance_events(id) ON DELETE CASCADE,
  editor_id INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_attendance_event_edit_event
  ON attendance_event_edit_logs(event_id,created_at);

CREATE TRIGGER IF NOT EXISTS trg_shared_qr_control_stop
AFTER UPDATE OF enabled,generation ON shared_qr_control
WHEN NEW.enabled=0 OR NEW.generation<>OLD.generation
BEGIN
  UPDATE shared_qr_sessions
  SET revoked_at=NEW.updated_at
  WHERE revoked_at IS NULL;
END;