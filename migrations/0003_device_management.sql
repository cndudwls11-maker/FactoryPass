CREATE TABLE IF NOT EXISTS qr_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_code TEXT NOT NULL COLLATE NOCASE UNIQUE,
  name TEXT NOT NULL,
  location TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'disabled' CHECK(status IN ('active','disabled')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_qr_devices_status ON qr_devices(status);

CREATE TABLE IF NOT EXISTS qr_device_usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES qr_devices(id) ON DELETE CASCADE,
  used_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  activity TEXT NOT NULL CHECK(activity IN ('scan','heartbeat')),
  outcome TEXT NOT NULL CHECK(outcome IN ('success','failure')),
  employee_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_qr_device_usage_device_time ON qr_device_usage_logs(device_id,used_at DESC);