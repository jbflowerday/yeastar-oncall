'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(config.dataDir, { recursive: true });
const db = new DatabaseSync(path.join(config.dataDir, 'oncall.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    display_name  TEXT NOT NULL DEFAULT '',
    mobile        TEXT NOT NULL DEFAULT '',
    is_admin      INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  -- A changeover is a point in time from which calls go to 'mobile'
  -- (or back to the route's normal destination when target = 'default').
  -- It stays in effect until the next changeover.
  CREATE TABLE IF NOT EXISTS changeovers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    start_at    INTEGER NOT NULL,
    target      TEXT NOT NULL CHECK (target IN ('mobile', 'default')),
    mobile      TEXT NOT NULL DEFAULT '',
    user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    note        TEXT NOT NULL DEFAULT '',
    created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_changeovers_start ON changeovers(start_at);

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS audit (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    at      INTEGER NOT NULL,
    user_id INTEGER,
    action  TEXT NOT NULL,
    detail  TEXT NOT NULL DEFAULT ''
  );
`);

// Migrations for databases created by earlier versions.
const cols = db.prepare('PRAGMA table_info(changeovers)').all().map((c) => c.name);
if (!cols.includes('series_id')) {
  db.exec('ALTER TABLE changeovers ADD COLUMN series_id TEXT');
}
db.exec('CREATE INDEX IF NOT EXISTS idx_changeovers_series ON changeovers(series_id)');

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row || row.value === null) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return fallback;
  }
}

function setSetting(key, value) {
  if (value === null || value === undefined) {
    db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  } else {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value));
  }
}

function audit(userId, action, detail = '') {
  db.prepare('INSERT INTO audit (at, user_id, action, detail) VALUES (?, ?, ?, ?)')
    .run(Date.now(), userId ?? null, action, typeof detail === 'string' ? detail : JSON.stringify(detail));
  db.prepare('DELETE FROM audit WHERE id <= (SELECT MAX(id) - 2000 FROM audit)').run();
}

module.exports = { db, getSetting, setSetting, audit };
