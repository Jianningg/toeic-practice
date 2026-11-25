CREATE TABLE reminders (
  id TEXT PRIMARY KEY,
  subscription TEXT NOT NULL,
  time TEXT NOT NULL,
  timezone TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  last_sent TEXT NOT NULL DEFAULT '',
  tested_at INTEGER NOT NULL DEFAULT 0
);
