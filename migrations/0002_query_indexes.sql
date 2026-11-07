CREATE INDEX IF NOT EXISTS idx_users_department ON users(department);
CREATE INDEX IF NOT EXISTS idx_attendance_user_date ON attendance_records(user_id,work_date);
CREATE INDEX IF NOT EXISTS idx_attendance_edit_record ON attendance_edit_logs(record_id,created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);